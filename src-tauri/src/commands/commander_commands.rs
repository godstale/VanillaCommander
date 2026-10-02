//! 파일 커맨더 백엔드 (P11-10).
//!
//! - 사용자 UI용 파일 작업. 에이전트 허용 루트 검사는 하지 않고 canonicalize만
//!   수행한다 (D1). 에이전트 도구용 검사는 `fs_commands::resolve_and_verify_workspace_path`.
//! - 오래 걸리는 작업(copy/move/zip/unzip/stat/search)은 job으로 실행하고
//!   `fc://progress` 이벤트로 진행률·완료·충돌 질의를 발행한다.

use serde::{Deserialize, Serialize};
use tauri::Emitter;
use std::collections::HashMap;use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{mpsc, Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};

use super::fs_commands::{resolve_user_path, reveal_in_explorer};

// ---------- 공개 타입 ----------

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum FcEntryKind {
    File,
    Dir,
    Symlink,
    Other,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FcEntry {
    pub name: String,
    pub path: String,
    pub kind: FcEntryKind,
    pub size: u64,
    pub modified_ms: Option<u64>,
    pub hidden: bool,
    pub readonly: bool,
    pub symlink: bool,
    /// 시스템 폴더 쓰기 경고 (D1). 목록 조회 시에는 항상 false.
    pub warning: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FcSystemFolder {
    pub id: String,
    pub label: String,
    pub path: String,
    pub exists: bool,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ConflictPolicy {
    Ask,
    Overwrite,
    Skip,
    Rename,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ConflictDecision {
    Overwrite,
    Skip,
    Rename,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FcStatResult {
    pub paths: Vec<String>,
    pub file_count: u64,
    pub dir_count: u64,
    pub total_bytes: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FcArchiveEntry {
    pub name: String,
    pub size: u64,
    pub is_dir: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FcSearchMatch {
    pub path: String,
    pub is_dir: bool,
    pub line_number: Option<usize>,
    pub line_content: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum FcProgressEvent {
    Progress {
        job_id: String,
        done_files: u64,
        total_files: Option<u64>,
        done_bytes: u64,
        total_bytes: Option<u64>,
    },
    Done {
        job_id: String,
        result: serde_json::Value,
    },
    Error {
        job_id: String,
        message: String,
    },
    Cancelled {
        job_id: String,
    },
    Conflict {
        job_id: String,
        conflict_id: u64,
        path: String,
        suggested_name: String,
    },
    Match {
        job_id: String,
        m: FcSearchMatch,
    },
}

// ---------- 잡 레지스트리 ----------

struct JobControl {
    cancel: AtomicBool,
    conflict_tx: Mutex<mpsc::Sender<ConflictAnswer>>,
    default_decision: Mutex<Option<ConflictDecision>>,
    conflict_seq: AtomicU64,
}

struct ConflictAnswer {
    conflict_id: u64,
    decision: ConflictDecision,
    apply_to_all: bool,
}

fn jobs() -> &'static Mutex<HashMap<String, std::sync::Arc<JobControl>>> {
    static JOBS: OnceLock<Mutex<HashMap<String, std::sync::Arc<JobControl>>>> = OnceLock::new();
    JOBS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn next_job_id() -> String {
    static SEQ: AtomicU64 = AtomicU64::new(0);
    let n = SEQ.fetch_add(1, Ordering::Relaxed);
    let ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    format!("job-{}-{}", ms, n)
}

fn remove_job(job_id: &str) {
    if let Ok(mut map) = jobs().lock() {
        map.remove(job_id);
    }
}

#[tauri::command]
pub async fn fc_cancel(job_id: String) -> Result<(), String> {
    let map = jobs().lock().map_err(|e| e.to_string())?;
    let ctl = map
        .get(&job_id)
        .ok_or_else(|| format!("Unknown job: {}", job_id))?;
    ctl.cancel.store(true, Ordering::Relaxed);
    Ok(())
}

#[tauri::command]
pub async fn fc_resolve_conflict(
    job_id: String,
    conflict_id: u64,
    decision: ConflictDecision,
    apply_to_all: bool,
) -> Result<(), String> {
    let map = jobs().lock().map_err(|e| e.to_string())?;
    let ctl = map
        .get(&job_id)
        .ok_or_else(|| format!("Unknown job: {}", job_id))?;
    let tx = ctl.conflict_tx.lock().map_err(|e| e.to_string())?;
    tx.send(ConflictAnswer {
        conflict_id,
        decision,
        apply_to_all,
    })
    .map_err(|e| format!("Job is not waiting for conflict resolution: {}", e))?;
    Ok(())
}

fn cancelled(ctl: &JobControl) -> bool {
    ctl.cancel.load(Ordering::Relaxed)
}

/// 충돌 해결 대기. 취소되면 Err("cancelled")를 반환한다.
fn wait_conflict(
    ctl: &JobControl,
    rx: &mpsc::Receiver<ConflictAnswer>,
    emit: &dyn Fn(FcProgressEvent),
    job_id: &str,
    path: &Path,
) -> Result<ConflictDecision, String> {
    if let Ok(def) = ctl.default_decision.lock() {
        if let Some(d) = *def {
            return Ok(d);
        }
    }
    let conflict_id = ctl.conflict_seq.fetch_add(1, Ordering::Relaxed);
    let suggested = suggest_rename(path);
    emit(FcProgressEvent::Conflict {
        job_id: job_id.to_string(),
        conflict_id,
        path: path.to_string_lossy().into_owned(),
        suggested_name: suggested,
    });
    loop {
        match rx.recv_timeout(std::time::Duration::from_millis(200)) {
            Ok(ans) if ans.conflict_id == conflict_id => {
                if ans.apply_to_all {
                    if let Ok(mut def) = ctl.default_decision.lock() {
                        *def = Some(ans.decision);
                    }
                }
                return Ok(ans.decision);
            }
            Ok(_) => continue,
            Err(mpsc::RecvTimeoutError::Timeout) => {
                if cancelled(ctl) {
                    return Err("cancelled".to_string());
                }
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => {
                return Err("conflict channel closed".to_string());
            }
        }
    }
}

fn spawn_job<F>(emit: Box<dyn Fn(FcProgressEvent) + Send + 'static>, task: F) -> String
where
    F: FnOnce(
        String,
        std::sync::Arc<JobControl>,
        mpsc::Receiver<ConflictAnswer>,
        Box<dyn Fn(FcProgressEvent) + Send>,
    ) + Send
    + 'static,
{
    let job_id = next_job_id();
    let (tx, rx) = mpsc::channel::<ConflictAnswer>();
    let ctl = std::sync::Arc::new(JobControl {
        cancel: AtomicBool::new(false),
        conflict_tx: Mutex::new(tx),
        default_decision: Mutex::new(None),
        conflict_seq: AtomicU64::new(1),
    });
    if let Ok(mut map) = jobs().lock() {
        map.insert(job_id.clone(), ctl.clone());
    }
    let jid = job_id.clone();
    std::thread::spawn(move || {
        task(jid, ctl, rx, emit);
    });
    job_id
}

fn emit_to(app: &tauri::AppHandle, event: FcProgressEvent) {
    let _ = app.emit("fc://progress", event);
}

// ---------- 경로 유틸 ----------

/// UI에 전달하는 경로 문자열. Windows canonicalize가 반환하는 `\\?\` verbatim
/// 접두를 벗겨 일반 경로로 되돌린다. 프런트의 브레드크럼이 verbatim을
/// `?/C:/...` 형태로 조합해 os error 123을 내는 문제를 막는다.
#[cfg(target_os = "windows")]
fn display_path_string(p: &Path) -> String {
    let s = p.to_string_lossy();
    if let Some(stripped) = s.strip_prefix(r"\\?\UNC\") {
        return format!(r"\\{}", stripped);
    }
    if let Some(stripped) = s.strip_prefix(r"\\?\") {
        return stripped.to_string();
    }
    s.into_owned()
}

#[cfg(not(target_os = "windows"))]
fn display_path_string(p: &Path) -> String {
    p.to_string_lossy().into_owned()
}

fn system_write_prefixes() -> Vec<PathBuf> {
    let mut out = Vec::new();
    #[cfg(target_os = "windows")]
    {
        for var in ["SystemRoot", "ProgramFiles", "ProgramFiles(x86)", "ProgramData"] {
            if let Ok(v) = std::env::var(var) {
                out.push(PathBuf::from(v));
            }
        }
        out.push(PathBuf::from("C:\\Windows"));
    }
    #[cfg(not(target_os = "windows"))]
    {
        for p in ["/bin", "/sbin", "/usr", "/etc", "/System", "/Library"] {
            out.push(PathBuf::from(p));
        }
    }
    out
}

/// 시스템 폴더 아래면 true (쓰기 경고용, D1).
pub fn is_system_write_path(path: &Path) -> bool {
    #[cfg(target_os = "windows")]
    {
        let lower = path.to_string_lossy().to_lowercase();
        system_write_prefixes()
            .iter()
            .any(|p| lower.starts_with(&p.to_string_lossy().to_lowercase()))
    }
    #[cfg(not(target_os = "windows"))]
    {
        system_write_prefixes().iter().any(|p| path.starts_with(p))
    }
}

fn is_hidden(path: &Path) -> bool {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::fs::MetadataExt;
        if let Ok(md) = std::fs::metadata(path) {
            const FILE_ATTRIBUTE_HIDDEN: u32 = 0x2;
            if md.file_attributes() & FILE_ATTRIBUTE_HIDDEN != 0 {
                return true;
            }
        }
    }
    path.file_name()
        .map(|n| n.to_string_lossy().starts_with('.'))
        .unwrap_or(false)
}

fn entry_of(path: &Path) -> Result<FcEntry, String> {
    let md = std::fs::symlink_metadata(path)
        .map_err(|e| format!("Cannot stat '{}': {}", path.display(), e))?;
    let ft = md.file_type();
    let kind = if ft.is_symlink() {
        FcEntryKind::Symlink
    } else if ft.is_dir() {
        FcEntryKind::Dir
    } else if ft.is_file() {
        FcEntryKind::File
    } else {
        FcEntryKind::Other
    };
    let modified_ms = md
        .modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64);
    Ok(FcEntry {
        name: path
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_else(|| display_path_string(path)),
        path: display_path_string(path),
        kind,
        size: if ft.is_file() { md.len() } else { 0 },
        modified_ms,
        hidden: is_hidden(path),
        readonly: md.permissions().readonly(),
        symlink: ft.is_symlink(),
        warning: false,
    })
}

fn suggest_rename(dst: &Path) -> String {
    let stem = dst
        .file_stem()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_else(|| "file".to_string());
    let ext = dst
        .extension()
        .map(|e| format!(".{}", e.to_string_lossy()))
        .unwrap_or_default();
    let parent = dst.parent();
    for i in 2..100000u32 {
        let name = format!("{} ({}){}", stem, i, ext);
        let candidate = match parent {
            Some(p) => p.join(&name),
            None => PathBuf::from(&name),
        };
        if !candidate.exists() {
            return name;
        }
    }
    format!("{} (copy){}", stem, ext)
}

// ---------- 목록/시스템 폴더 ----------

#[tauri::command]
pub fn fc_list_dir(path: String, show_hidden: Option<bool>) -> Result<Vec<FcEntry>, String> {
    let verified = resolve_user_path(&path, true)?;
    if !verified.is_dir() {
        return Err(format!("Not a directory: {}", verified.display()));
    }
    let show_hidden = show_hidden.unwrap_or(false);
    let mut entries = Vec::new();
    let read = std::fs::read_dir(&verified)
        .map_err(|e| format!("Failed to read directory '{}': {}", verified.display(), e))?;
    for entry in read.flatten() {
        let p = entry.path();
        if !show_hidden && is_hidden(&p) {
            continue;
        }
        match entry_of(&p) {
            Ok(e) => entries.push(e),
            Err(_) => continue,
        }
    }
    entries.sort_by(|a, b| {
        let ad = matches!(a.kind, FcEntryKind::Dir);
        let bd = matches!(b.kind, FcEntryKind::Dir);
        if ad != bd {
            return if ad {
                std::cmp::Ordering::Less
            } else {
                std::cmp::Ordering::Greater
            };
        }
        a.name.to_lowercase().cmp(&b.name.to_lowercase())
    });
    Ok(entries)
}

#[tauri::command]
pub fn fc_system_folders() -> Result<Vec<FcSystemFolder>, String> {
    let mut out = Vec::new();
    let mut push = |id: &str, label: &str, opt: Option<PathBuf>| {
        if let Some(p) = opt {
            out.push(FcSystemFolder {
                id: id.to_string(),
                label: label.to_string(),
                exists: p.is_dir(),
                path: p.to_string_lossy().into_owned(),
            });
        }
    };
    push("home", "홈", dirs::home_dir());
    push("desktop", "바탕화면", dirs::desktop_dir());
    push("documents", "문서", dirs::document_dir());
    push("downloads", "다운로드", dirs::download_dir());
    push("pictures", "사진", dirs::picture_dir());
    push("music", "음악", dirs::audio_dir());
    push("videos", "동영상", dirs::video_dir());
    #[cfg(target_os = "windows")]
    {
        for c in 'A'..='Z' {
            let drive = format!("{}:\\", c);
            if Path::new(&drive).exists() {
                // 시스템 예약 파티션(복구 등)은 제외: 루트에 Windows 폴더가 없고 접근 불가면 스킵.
                out.push(FcSystemFolder {
                    id: format!("drive-{}", c),
                    label: format!("로컬 디스크 ({}:)", c),
                    exists: true,
                    path: drive,
                });
            }
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        out.push(FcSystemFolder {
            id: "root".to_string(),
            label: "파일 시스템 루트".to_string(),
            exists: Path::new("/").is_dir(),
            path: "/".to_string(),
        });
    }
    Ok(out)
}

// ---------- 정보 ----------

fn walk_stat(
    root: &Path,
    ctl: &JobControl,
    emit: &dyn Fn(FcProgressEvent),
    job_id: &str,
    acc: &mut FcStatResult,
) -> Result<(), String> {
    let mut stack = vec![root.to_path_buf()];
    let mut since_emit = 0u64;
    while let Some(dir) = stack.pop() {
        if cancelled(ctl) {
            return Err("cancelled".to_string());
        }
        let read = match std::fs::read_dir(&dir) {
            Ok(r) => r,
            Err(_) => continue,
        };
        for entry in read.flatten() {
            if cancelled(ctl) {
                return Err("cancelled".to_string());
            }
            let p = entry.path();
            let ft = match entry.file_type() {
                Ok(f) => f,
                Err(_) => continue,
            };
            if ft.is_symlink() {
                acc.file_count += 1;
                continue;
            }
            if ft.is_dir() {
                acc.dir_count += 1;
                stack.push(p);
            } else if ft.is_file() {
                acc.file_count += 1;
                if let Ok(md) = entry.metadata() {
                    acc.total_bytes += md.len();
                }
            }
            since_emit += 1;
            if since_emit >= 1000 {
                since_emit = 0;
                emit(FcProgressEvent::Progress {
                    job_id: job_id.to_string(),
                    done_files: acc.file_count + acc.dir_count,
                    total_files: None,
                    done_bytes: acc.total_bytes,
                    total_bytes: None,
                });
            }
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn fc_stat(app: tauri::AppHandle, paths: Vec<String>) -> Result<String, String> {
    let mut verified = Vec::new();
    for p in &paths {
        verified.push(resolve_user_path(p, true)?);
    }
    let job_id = spawn_job(
        Box::new(move |e| emit_to(&app, e)),
        move |jid, ctl, _rx, emit| {
            let mut acc = FcStatResult {
                paths: paths.clone(),
                file_count: 0,
                dir_count: 0,
                total_bytes: 0,
            };
            for v in &verified {
                if cancelled(&ctl) {
                    emit(FcProgressEvent::Cancelled { job_id: jid.clone() });
                    remove_job(&jid);
                    return;
                }
                let md = match std::fs::symlink_metadata(v) {
                    Ok(m) => m,
                    Err(e) => {
                        emit(FcProgressEvent::Error {
                            job_id: jid.clone(),
                            message: e.to_string(),
                        });
                        remove_job(&jid);
                        return;
                    }
                };
                if md.file_type().is_dir() {
                    acc.dir_count += 1;
                    if let Err(e) = walk_stat(v, &ctl, &emit, &jid, &mut acc) {
                        if e == "cancelled" {
                            emit(FcProgressEvent::Cancelled { job_id: jid.clone() });
                        } else {
                            emit(FcProgressEvent::Error {
                                job_id: jid.clone(),
                                message: e,
                            });
                        }
                        remove_job(&jid);
                        return;
                    }
                } else {
                    acc.file_count += 1;
                    acc.total_bytes += md.len();
                }
            }
            let value = serde_json::to_value(&acc).unwrap_or(serde_json::Value::Null);
            emit(FcProgressEvent::Done {
                job_id: jid.clone(),
                result: value,
            });
            remove_job(&jid);
        },
    );
    Ok(job_id)
}

// ---------- 복사/이동 엔진 ----------

#[derive(Default)]
struct OpTotals {
    files: u64,
    bytes: u64,
}

#[derive(Default, Serialize)]
struct OpOutcome {
    files: u64,
    bytes: u64,
    skipped: u64,
    renamed: u64,
    warning: bool,
}

fn scan_source(src: &Path, totals: &mut OpTotals) {
    let md = match std::fs::symlink_metadata(src) {
        Ok(m) => m,
        Err(_) => return,
    };
    if md.file_type().is_symlink() {
        totals.files += 1;
        return;
    }
    if md.is_dir() {
        totals.files += 1;
        let mut stack = vec![src.to_path_buf()];
        while let Some(dir) = stack.pop() {
            let Ok(read) = std::fs::read_dir(&dir) else {
                continue;
            };
            for entry in read.flatten() {
                let p = entry.path();
                let Ok(ft) = entry.file_type() else {
                    continue;
                };
                totals.files += 1;
                if ft.is_symlink() {
                    continue;
                }
                if ft.is_dir() {
                    stack.push(p);
                } else if ft.is_file() {
                    if let Ok(m) = entry.metadata() {
                        totals.bytes += m.len();
                    }
                }
            }
        }
    } else {
        totals.files += 1;
        totals.bytes += md.len();
    }
}

fn copy_file_stream(
    src: &Path,
    dst: &Path,
    ctl: &JobControl,
    on_bytes: &mut dyn FnMut(u64),
) -> Result<(), String> {
    if let Some(parent) = dst.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let mut reader = std::fs::File::open(src)
        .map_err(|e| format!("Failed to open '{}': {}", src.display(), e))?;
    let mut writer = std::fs::File::create(dst)
        .map_err(|e| format!("Failed to create '{}': {}", dst.display(), e))?;
    let mut buf = [0u8; 65536];
    loop {
        if cancelled(ctl) {
            return Err("cancelled".to_string());
        }
        let n = reader
            .read(&mut buf)
            .map_err(|e| format!("Failed to read '{}': {}", src.display(), e))?;
        if n == 0 {
            break;
        }
        writer
            .write_all(&buf[..n])
            .map_err(|e| format!("Failed to write '{}': {}", dst.display(), e))?;
        on_bytes(n as u64);
    }
    Ok(())
}

fn remove_path_all(path: &Path) -> Result<(), String> {
    let md = std::fs::symlink_metadata(path)
        .map_err(|e| format!("Cannot stat '{}': {}", path.display(), e))?;
    if md.file_type().is_dir() && !md.file_type().is_symlink() {
        std::fs::remove_dir_all(path).map_err(|e| e.to_string())
    } else {
        std::fs::remove_file(path).map_err(|e| e.to_string())
    }
}

/// 단일 소스를 dest_dir 안에 복사/이동한다. 반환값은 건너뜀 여부.
#[allow(clippy::too_many_arguments)]
fn execute_one(
    src: &Path,
    dest_dir: &Path,
    policy: ConflictPolicy,
    is_move: bool,
    ctl: &JobControl,
    rx: &mpsc::Receiver<ConflictAnswer>,
    emit: &dyn Fn(FcProgressEvent),
    job_id: &str,
    totals: &OpTotals,
    outcome: &mut OpOutcome,
    progress: &mut (u64, u64),
) -> Result<(), String> {
    let file_name = src.file_name().ok_or_else(|| {
        format!("Invalid source name: '{}'", src.display())
    })?;
    let mut dst = dest_dir.join(file_name);

    if dst.exists() || std::fs::symlink_metadata(&dst).is_ok() {
        let decision = match policy {
            ConflictPolicy::Overwrite => ConflictDecision::Overwrite,
            ConflictPolicy::Skip => ConflictDecision::Skip,
            ConflictPolicy::Rename => ConflictDecision::Rename,
            ConflictPolicy::Ask => wait_conflict(ctl, rx, emit, job_id, &dst)?,
        };
        match decision {
            ConflictDecision::Skip => {
                outcome.skipped += 1;
                return Ok(());
            }
            ConflictDecision::Rename => {
                let name = suggest_rename(&dst);
                dst = dst.parent().unwrap_or(Path::new("")).join(name);
                outcome.renamed += 1;
            }
            ConflictDecision::Overwrite => {
                remove_path_all(&dst)?;
            }
        }
    }

    // 이동 fast-path: 같은 파일시스템이면 rename 한 방.
    if is_move && policy != ConflictPolicy::Ask {
        if std::fs::rename(src, &dst).is_ok() {
            progress.0 += 1;
            outcome.files += 1;
            emit_progress(emit, job_id, progress, totals);
            return Ok(());
        }
    }

    copy_recursive(src, &dst, ctl, emit, job_id, totals, outcome, progress)?;
    if is_move {
        if cancelled(ctl) {
            return Err("cancelled".to_string());
        }
        remove_path_all(src)?;
    }
    Ok(())
}

fn emit_progress(
    emit: &dyn Fn(FcProgressEvent),
    job_id: &str,
    progress: &(u64, u64),
    totals: &OpTotals,
) {
    emit(FcProgressEvent::Progress {
        job_id: job_id.to_string(),
        done_files: progress.0,
        total_files: Some(totals.files),
        done_bytes: progress.1,
        total_bytes: Some(totals.bytes),
    });
}

fn copy_recursive(
    src: &Path,
    dst: &Path,
    ctl: &JobControl,
    emit: &dyn Fn(FcProgressEvent),
    job_id: &str,
    totals: &OpTotals,
    outcome: &mut OpOutcome,
    progress: &mut (u64, u64),
) -> Result<(), String> {
    if cancelled(ctl) {
        return Err("cancelled".to_string());
    }
    let md = std::fs::symlink_metadata(src)
        .map_err(|e| format!("Cannot stat '{}': {}", src.display(), e))?;
    if md.file_type().is_symlink() {
        outcome.skipped += 1;
        progress.0 += 1;
        emit_progress(emit, job_id, progress, totals);
        return Ok(());
    }
    if md.is_dir() {
        std::fs::create_dir_all(dst).map_err(|e| e.to_string())?;
        progress.0 += 1;
        outcome.files += 1;
        emit_progress(emit, job_id, progress, totals);
        let read = std::fs::read_dir(src).map_err(|e| e.to_string())?;
        for entry in read.flatten() {
            copy_recursive(
                &entry.path(),
                &dst.join(entry.file_name()),
                ctl,
                emit,
                job_id,
                totals,
                outcome,
                progress,
            )?;
        }
        return Ok(());
    }
    let mut on_bytes = |n: u64| {
        progress.1 += n;
        outcome.bytes += n;
        emit_progress(emit, job_id, progress, totals);
    };
    copy_file_stream(src, dst, ctl, &mut on_bytes)?;
    progress.0 += 1;
    outcome.files += 1;
    emit_progress(emit, job_id, progress, totals);
    Ok(())
}

fn run_copy_move(
    jid: String,
    ctl: std::sync::Arc<JobControl>,
    rx: mpsc::Receiver<ConflictAnswer>,
    emit: Box<dyn Fn(FcProgressEvent) + Send>,
    sources: Vec<PathBuf>,
    dest_dir: PathBuf,
    policy: ConflictPolicy,
    is_move: bool,
) {
    let mut totals = OpTotals::default();
    for s in &sources {
        scan_source(s, &mut totals);
    }
    let warning = is_system_write_path(&dest_dir);
    let mut outcome = OpOutcome {
        warning,
        ..Default::default()
    };
    let mut progress = (0u64, 0u64);
    for src in &sources {
        if cancelled(&ctl) {
            emit(FcProgressEvent::Cancelled { job_id: jid.clone() });
            remove_job(&jid);
            return;
        }
        let emit_ref: &dyn Fn(FcProgressEvent) = &emit;
        match execute_one(
            src, &dest_dir, policy, is_move, &ctl, &rx, emit_ref, &jid, &totals, &mut outcome,
            &mut progress,
        ) {
            Ok(()) => {}
            Err(e) if e == "cancelled" => {
                emit(FcProgressEvent::Cancelled { job_id: jid.clone() });
                remove_job(&jid);
                return;
            }
            Err(e) => {
                emit(FcProgressEvent::Error {
                    job_id: jid.clone(),
                    message: e,
                });
                remove_job(&jid);
                return;
            }
        }
    }
    let value = serde_json::to_value(&outcome).unwrap_or(serde_json::Value::Null);
    emit(FcProgressEvent::Done {
        job_id: jid.clone(),
        result: value,
    });
    remove_job(&jid);
}

fn parse_policy(s: &str) -> Result<ConflictPolicy, String> {
    match s {
        "ask" => Ok(ConflictPolicy::Ask),
        "overwrite" => Ok(ConflictPolicy::Overwrite),
        "skip" => Ok(ConflictPolicy::Skip),
        "rename" => Ok(ConflictPolicy::Rename),
        other => Err(format!("Unknown conflict policy: {}", other)),
    }
}

#[tauri::command]
pub async fn fc_copy(
    app: tauri::AppHandle,
    sources: Vec<String>,
    dest_dir: String,
    conflict: Option<String>,
) -> Result<String, String> {
    let policy = parse_policy(conflict.as_deref().unwrap_or("ask"))?;
    let mut verified_sources = Vec::new();
    for s in &sources {
        verified_sources.push(resolve_user_path(s, true)?);
    }
    let verified_dest = resolve_user_path(&dest_dir, true)?;
    if !verified_dest.is_dir() {
        return Err(format!("Not a directory: {}", verified_dest.display()));
    }
    for src in &verified_sources {
        if verified_dest.starts_with(src) {
            return Err("Cannot copy a folder into itself".to_string());
        }
    }
    Ok(spawn_job(
        Box::new(move |e| emit_to(&app, e)),
        move |jid, ctl, rx, emit| {
            run_copy_move(jid, ctl, rx, emit, verified_sources, verified_dest, policy, false);
        },
    ))
}

#[tauri::command]
pub async fn fc_move(
    app: tauri::AppHandle,
    sources: Vec<String>,
    dest_dir: String,
    conflict: Option<String>,
) -> Result<String, String> {
    let policy = parse_policy(conflict.as_deref().unwrap_or("ask"))?;
    let mut verified_sources = Vec::new();
    for s in &sources {
        verified_sources.push(resolve_user_path(s, true)?);
    }
    let verified_dest = resolve_user_path(&dest_dir, true)?;
    if !verified_dest.is_dir() {
        return Err(format!("Not a directory: {}", verified_dest.display()));
    }
    for src in &verified_sources {
        if verified_dest.starts_with(src) {
            return Err("Cannot move a folder into itself".to_string());
        }
    }
    Ok(spawn_job(
        Box::new(move |e| emit_to(&app, e)),
        move |jid, ctl, rx, emit| {
            run_copy_move(jid, ctl, rx, emit, verified_sources, verified_dest, policy, true);
        },
    ))
}

#[derive(Debug, Clone, Serialize)]
pub struct FcOpResult {
    pub warning: bool,
}

#[tauri::command]
pub fn fc_trash(paths: Vec<String>) -> Result<FcOpResult, String> {
    for p in &paths {
        let verified = resolve_user_path(p, true)?;
        trash::delete(&verified).map_err(|e| format!("Failed to trash '{}': {}", verified.display(), e))?;
    }
    Ok(FcOpResult { warning: false })
}

#[tauri::command]
pub fn fc_delete_permanent(paths: Vec<String>) -> Result<FcOpResult, String> {
    for p in &paths {
        let verified = resolve_user_path(p, true)?;
        remove_path_all(&verified)?;
    }
    Ok(FcOpResult { warning: false })
}

#[tauri::command]
pub fn fc_rename(path: String, new_name: String) -> Result<FcOpResult, String> {
    if new_name.trim().is_empty() || new_name.contains(['/', '\\']) {
        return Err("Invalid new name".to_string());
    }
    let verified = resolve_user_path(&path, true)?;
    let parent = verified.parent().ok_or_else(|| "Cannot rename root".to_string())?;
    let dst = parent.join(new_name.trim());
    if dst.exists() {
        return Err(format!("Already exists: {}", dst.display()));
    }
    std::fs::rename(&verified, &dst)
        .map_err(|e| format!("Failed to rename: {}", e))?;
    Ok(FcOpResult {
        warning: is_system_write_path(&dst),
    })
}

#[tauri::command]
pub fn fc_mkdir(path: String) -> Result<FcOpResult, String> {
    let target = Path::new(&path).to_path_buf();
    if target.exists() {
        return Err(format!("Already exists: {}", target.display()));
    }
    // 미존재 경로는 traversal만 검사한다.
    resolve_user_path(&path, false)?;
    std::fs::create_dir_all(&target).map_err(|e| e.to_string())?;
    Ok(FcOpResult {
        warning: is_system_write_path(&target),
    })
}

#[tauri::command]
pub fn fc_create_file(path: String) -> Result<FcOpResult, String> {
    let target = Path::new(&path).to_path_buf();
    if target.exists() {
        return Err(format!("Already exists: {}", target.display()));
    }
    resolve_user_path(&path, false)?;
    if let Some(parent) = target.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::write(&target, []).map_err(|e| e.to_string())?;
    Ok(FcOpResult {
        warning: is_system_write_path(&target),
    })
}

// ---------- 검색 ----------

fn run_search(
    jid: String,
    ctl: std::sync::Arc<JobControl>,
    emit: Box<dyn Fn(FcProgressEvent) + Send>,
    root: PathBuf,
    name_matcher: Option<globset::GlobMatcher>,
    name_substring: Option<String>,
    content_re: Option<regex::Regex>,
    max_results: usize,
    use_gitignore: bool,
) {
    let mut builder = ignore::WalkBuilder::new(&root);
    builder.hidden(false);
    builder.git_ignore(use_gitignore);
    let mut count = 0usize;
    let mut batch = 0usize;
    for result in builder.build() {
        if cancelled(&ctl) {
            emit(FcProgressEvent::Cancelled { job_id: jid.clone() });
            remove_job(&jid);
            return;
        }
        if count >= max_results {
            break;
        }
        let entry = match result {
            Ok(e) => e,
            Err(_) => continue,
        };
        let path = entry.path();
        let file_name = entry.file_name().to_string_lossy().to_lowercase();
        let name_hit = match (&name_matcher, &name_substring) {
            (Some(m), _) => m.is_match(path) || m.is_match(entry.file_name()),
            (None, Some(sub)) => file_name.contains(sub),
            (None, None) => true,
        };
        if !name_hit {
            continue;
        }
        let is_dir = entry.file_type().map(|f| f.is_dir()).unwrap_or(false);
        if let Some(re) = &content_re {
            if is_dir {
                continue;
            }
            let md = match entry.metadata() {
                Ok(m) => m,
                Err(_) => continue,
            };
            if md.len() > 5 * 1024 * 1024 {
                continue;
            }
            let content = match std::fs::read_to_string(path) {
                Ok(c) => c,
                Err(_) => continue,
            };
            let mut matched = false;
            for (idx, line) in content.lines().enumerate() {
                if re.is_match(line) {
                    let short: String = if line.chars().count() > 300 {
                        line.chars().take(300).collect()
                    } else {
                        line.to_string()
                    };
                    emit(FcProgressEvent::Match {
                        job_id: jid.clone(),
                        m: FcSearchMatch {
                            path: display_path_string(path),
                            is_dir: false,
                            line_number: Some(idx + 1),
                            line_content: Some(short),
                        },
                    });
                    count += 1;
                    matched = true;
                    if count >= max_results {
                        break;
                    }
                }
            }
            if matched {
                batch += 1;
            }
            let _ = batch;
            continue;
        }
        emit(FcProgressEvent::Match {
            job_id: jid.clone(),
            m: FcSearchMatch {
                path: display_path_string(path),
                is_dir,
                line_number: None,
                line_content: None,
            },
        });
        count += 1;
    }
    let value = serde_json::json!({ "count": count });
    emit(FcProgressEvent::Done {
        job_id: jid.clone(),
        result: value,
    });
    remove_job(&jid);
}

#[tauri::command]
pub async fn fc_search(
    app: tauri::AppHandle,
    root: String,
    name_pattern: Option<String>,
    content_query: Option<String>,
    max_results: Option<usize>,
    use_gitignore: Option<bool>,
) -> Result<String, String> {
    let verified = resolve_user_path(&root, true)?;
    if !verified.is_dir() {
        return Err(format!("Not a directory: {}", verified.display()));
    }
    let max = max_results.unwrap_or(200).clamp(1, 5000);
    let use_gi = use_gitignore.unwrap_or(true);

    let (name_matcher, name_substring) = match name_pattern {
        Some(p) if !p.trim().is_empty() => {
            let pat = p.trim().to_string();
            match globset::GlobBuilder::new(&pat)
                .case_insensitive(true)
                .build()
            {
                Ok(g) => (Some(g.compile_matcher()), None),
                Err(_) => (None, Some(pat.to_lowercase())),
            }
        }
        _ => (None, None),
    };
    let content_re = match content_query {
        Some(q) if !q.trim().is_empty() => Some(
            regex::Regex::new(&q).map_err(|e| format!("Invalid content regex '{}': {}", q, e))?,
        ),
        _ => None,
    };

    Ok(spawn_job(
        Box::new(move |e| emit_to(&app, e)),
        move |jid, ctl, _rx, emit| {
            run_search(
                jid,
                ctl,
                emit,
                verified,
                name_matcher,
                name_substring,
                content_re,
                max,
                use_gi,
            );
        },
    ))
}

// ---------- 압축 ----------

fn zip_options() -> zip::write::SimpleFileOptions {
    zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated)
}

fn add_to_zip(
    writer: &mut zip::ZipWriter<std::fs::File>,
    src: &Path,
    base: &Path,
    ctl: &JobControl,
    emit: &dyn Fn(FcProgressEvent),
    job_id: &str,
    progress: &mut (u64, u64),
    totals: &OpTotals,
) -> Result<(), String> {
    if cancelled(ctl) {
        return Err("cancelled".to_string());
    }
    let md = std::fs::symlink_metadata(src)
        .map_err(|e| format!("Cannot stat '{}': {}", src.display(), e))?;
    let rel = src
        .strip_prefix(base)
        .map_err(|e| e.to_string())?
        .to_string_lossy()
        .replace('\\', "/");
    if md.file_type().is_symlink() {
        return Ok(());
    }
    if md.is_dir() {
        let name = if rel.is_empty() {
            String::new()
        } else {
            format!("{}/", rel)
        };
        if !name.is_empty() {
            writer
                .add_directory(name, zip_options())
                .map_err(|e| e.to_string())?;
        }
        progress.0 += 1;
        emit_progress(emit, job_id, progress, totals);
        let read = std::fs::read_dir(src).map_err(|e| e.to_string())?;
        for entry in read.flatten() {
            add_to_zip(writer, &entry.path(), base, ctl, emit, job_id, progress, totals)?;
        }
        return Ok(());
    }
    writer
        .start_file(rel, zip_options())
        .map_err(|e| e.to_string())?;
    let mut reader =
        std::fs::File::open(src).map_err(|e| format!("Failed to open '{}': {}", src.display(), e))?;
    let mut buf = [0u8; 65536];
    loop {
        if cancelled(ctl) {
            return Err("cancelled".to_string());
        }
        let n = reader.read(&mut buf).map_err(|e| e.to_string())?;
        if n == 0 {
            break;
        }
        writer.write_all(&buf[..n]).map_err(|e| e.to_string())?;
        progress.1 += n as u64;
        emit_progress(emit, job_id, progress, totals);
    }
    progress.0 += 1;
    emit_progress(emit, job_id, progress, totals);
    Ok(())
}

#[tauri::command]
pub async fn fc_zip(
    app: tauri::AppHandle,
    sources: Vec<String>,
    dest: String,
) -> Result<String, String> {
    let mut verified_sources = Vec::new();
    for s in &sources {
        verified_sources.push(resolve_user_path(s, true)?);
    }
    if verified_sources.is_empty() {
        return Err("No sources".to_string());
    }
    let dest_path = Path::new(&dest).to_path_buf();
    resolve_user_path(&dest, false)?;
    Ok(spawn_job(
        Box::new(move |e| emit_to(&app, e)),
        move |jid, ctl, _rx, emit| {
            let mut totals = OpTotals::default();
            for s in &verified_sources {
                scan_source(s, &mut totals);
            }
            let warning = dest_path
                .parent()
                .map(is_system_write_path)
                .unwrap_or(false);
            if let Some(parent) = dest_path.parent() {
                if let Err(e) = std::fs::create_dir_all(parent) {
                    emit(FcProgressEvent::Error {
                        job_id: jid.clone(),
                        message: e.to_string(),
                    });
                    remove_job(&jid);
                    return;
                }
            }
            let file = match std::fs::File::create(&dest_path) {
                Ok(f) => f,
                Err(e) => {
                    emit(FcProgressEvent::Error {
                        job_id: jid.clone(),
                        message: e.to_string(),
                    });
                    remove_job(&jid);
                    return;
                }
            };
            let mut writer = zip::ZipWriter::new(file);
            let mut progress = (0u64, 0u64);
            // 공통 부모를 기준으로 상대 경로를 기록한다.
            let base = common_parent(&verified_sources).unwrap_or_else(|| PathBuf::from(""));
            let emit_ref: &dyn Fn(FcProgressEvent) = &emit;
            for src in &verified_sources {
                if cancelled(&ctl) {
                    emit(FcProgressEvent::Cancelled { job_id: jid.clone() });
                    remove_job(&jid);
                    return;
                }
                if let Err(e) = add_to_zip(
                    &mut writer,
                    src,
                    &base,
                    &ctl,
                    emit_ref,
                    &jid,
                    &mut progress,
                    &totals,
                ) {
                    if e == "cancelled" {
                        emit(FcProgressEvent::Cancelled { job_id: jid.clone() });
                    } else {
                        emit(FcProgressEvent::Error {
                            job_id: jid.clone(),
                            message: e,
                        });
                    }
                    remove_job(&jid);
                    return;
                }
            }
            if let Err(e) = writer.finish() {
                emit(FcProgressEvent::Error {
                    job_id: jid.clone(),
                    message: e.to_string(),
                });
                remove_job(&jid);
                return;
            }
            emit(FcProgressEvent::Done {
                job_id: jid.clone(),
                result: serde_json::json!({
                    "archive": dest_path.to_string_lossy(),
                    "files": progress.0,
                    "bytes": progress.1,
                    "warning": warning,
                }),
            });
            remove_job(&jid);
        },
    ))
}

fn common_parent(paths: &[PathBuf]) -> Option<PathBuf> {
    let mut iter = paths.iter();
    let first = iter.next()?.parent().map(|p| p.to_path_buf())?;
    let mut base = first;
    for p in iter {
        let parent = p.parent()?;
        while !parent.starts_with(&base) {
            if !base.pop() {
                return None;
            }
        }
    }
    Some(base)
}

#[tauri::command]
pub async fn fc_unzip(
    app: tauri::AppHandle,
    archive: String,
    dest_dir: String,
) -> Result<String, String> {
    let verified_archive = resolve_user_path(&archive, true)?;
    let dest_path = Path::new(&dest_dir).to_path_buf();
    resolve_user_path(&dest_dir, false)?;
    Ok(spawn_job(
        Box::new(move |e| emit_to(&app, e)),
        move |jid, ctl, _rx, emit| {
            let warning = is_system_write_path(&dest_path);
            if let Err(e) = std::fs::create_dir_all(&dest_path) {
                emit(FcProgressEvent::Error {
                    job_id: jid.clone(),
                    message: e.to_string(),
                });
                remove_job(&jid);
                return;
            }
            let file = match std::fs::File::open(&verified_archive) {
                Ok(f) => f,
                Err(e) => {
                    emit(FcProgressEvent::Error {
                        job_id: jid.clone(),
                        message: e.to_string(),
                    });
                    remove_job(&jid);
                    return;
                }
            };
            let mut zip = match zip::ZipArchive::new(file) {
                Ok(z) => z,
                Err(e) => {
                    emit(FcProgressEvent::Error {
                        job_id: jid.clone(),
                        message: format!("Invalid archive: {}", e),
                    });
                    remove_job(&jid);
                    return;
                }
            };
            let total = zip.len() as u64;
            let mut done = 0u64;
            for i in 0..zip.len() {
                if cancelled(&ctl) {
                    emit(FcProgressEvent::Cancelled { job_id: jid.clone() });
                    remove_job(&jid);
                    return;
                }
                let mut entry = match zip.by_index(i) {
                    Ok(e) => e,
                    Err(e) => {
                        emit(FcProgressEvent::Error {
                            job_id: jid.clone(),
                            message: e.to_string(),
                        });
                        remove_job(&jid);
                        return;
                    }
                };
                // ZipSlip 방지.
                let out = match entry.enclosed_name() {
                    Some(p) => dest_path.join(p),
                    None => {
                        emit(FcProgressEvent::Error {
                            job_id: jid.clone(),
                            message: format!("Unsafe entry path in archive"),
                        });
                        remove_job(&jid);
                        return;
                    }
                };
                if entry.is_dir() {
                    if let Err(e) = std::fs::create_dir_all(&out) {
                        emit(FcProgressEvent::Error {
                            job_id: jid.clone(),
                            message: e.to_string(),
                        });
                        remove_job(&jid);
                        return;
                    }
                } else {
                    if let Some(parent) = out.parent() {
                        if let Err(e) = std::fs::create_dir_all(parent) {
                            emit(FcProgressEvent::Error {
                                job_id: jid.clone(),
                                message: e.to_string(),
                            });
                            remove_job(&jid);
                            return;
                        }
                    }
                    let mut out_file = match std::fs::File::create(&out) {
                        Ok(f) => f,
                        Err(e) => {
                            emit(FcProgressEvent::Error {
                                job_id: jid.clone(),
                                message: e.to_string(),
                            });
                            remove_job(&jid);
                            return;
                        }
                    };
                    if let Err(e) = std::io::copy(&mut entry, &mut out_file) {
                        emit(FcProgressEvent::Error {
                            job_id: jid.clone(),
                            message: e.to_string(),
                        });
                        remove_job(&jid);
                        return;
                    }
                }
                done += 1;
                emit(FcProgressEvent::Progress {
                    job_id: jid.clone(),
                    done_files: done,
                    total_files: Some(total),
                    done_bytes: 0,
                    total_bytes: None,
                });
            }
            emit(FcProgressEvent::Done {
                job_id: jid.clone(),
                result: serde_json::json!({ "files": done, "warning": warning }),
            });
            remove_job(&jid);
        },
    ))
}

#[tauri::command]
pub fn fc_archive_list(archive: String) -> Result<Vec<FcArchiveEntry>, String> {
    let verified = resolve_user_path(&archive, true)?;
    let file =
        std::fs::File::open(&verified).map_err(|e| format!("Cannot open archive: {}", e))?;
    let mut zip =
        zip::ZipArchive::new(file).map_err(|e| format!("Invalid archive: {}", e))?;
    let mut out = Vec::new();
    for i in 0..zip.len() {
        let entry = zip.by_index(i).map_err(|e| e.to_string())?;
        out.push(FcArchiveEntry {
            name: entry.name().to_string(),
            size: entry.size(),
            is_dir: entry.is_dir(),
        });
    }
    Ok(out)
}

// ---------- 열기 ----------

#[tauri::command]
pub fn fc_open_default(path: String) -> Result<(), String> {
    let verified = resolve_user_path(&path, true)?;
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("cmd")
            .args(["/C", "start", "", &verified.to_string_lossy()])
            .spawn()
            .map_err(|e| format!("Failed to open: {}", e))?;
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&verified)
            .spawn()
            .map_err(|e| format!("Failed to open: {}", e))?;
    }
    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(&verified)
            .spawn()
            .map_err(|e| format!("Failed to open: {}", e))?;
    }
    Ok(())
}

#[tauri::command]
pub fn fc_reveal(path: String) -> Result<(), String> {
    reveal_in_explorer(path, None)
}

/// 바이너리 쓰기 (P11-26 채팅 이미지 복사 등). 부모 디렉터리를 만든다.
#[tauri::command]
pub fn fc_write_bytes(path: String, base64: String) -> Result<u64, String> {
    use base64::Engine;
    let target = Path::new(&path).to_path_buf();
    // 미존재 경로는 traversal만 검사한다.
    resolve_user_path(&path, false)?;
    if let Some(parent) = target.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(base64.trim())
        .map_err(|e| format!("Invalid base64: {}", e))?;
    std::fs::write(&target, &bytes).map_err(|e| e.to_string())?;
    Ok(bytes.len() as u64)
}

#[derive(Debug, Clone, Serialize)]
pub struct FcFileBytes {
    pub base64: String,
    pub size: u64,
    pub truncated: bool,
}

fn read_capped(path: &Path, max_bytes: u64) -> Result<(Vec<u8>, u64, bool), String> {
    let md = std::fs::metadata(path)
        .map_err(|e| format!("Cannot stat '{}': {}", path.display(), e))?;
    if md.is_dir() {
        return Err(format!("Not a file: {}", path.display()));
    }
    let size = md.len();
    let take = size.min(max_bytes);
    let file =
        std::fs::File::open(path).map_err(|e| format!("Cannot open '{}': {}", path.display(), e))?;
    let mut buf = Vec::with_capacity(take.min(16 * 1024 * 1024) as usize);
    let mut limited = file.take(take);
    std::io::copy(&mut limited, &mut buf).map_err(|e| e.to_string())?;
    Ok((buf, size, size > max_bytes))
}

/// 바이너리 뷰어용 앞부분 읽기 (base64). CSP·asset 우회 목적.
#[tauri::command]
pub fn fc_read_file_bytes(path: String, max_bytes: Option<u64>) -> Result<FcFileBytes, String> {
    use base64::Engine;
    let verified = resolve_user_path(&path, true)?;
    let (buf, size, truncated) = read_capped(&verified, max_bytes.unwrap_or(64 * 1024 * 1024))?;
    Ok(FcFileBytes {
        base64: base64::engine::general_purpose::STANDARD.encode(&buf),
        size,
        truncated,
    })
}

#[derive(Debug, Clone, Serialize)]
pub struct FcTextHead {
    pub text: String,
    pub size: u64,
    pub truncated: bool,
}

/// 대용량 텍스트 앞부분 읽기 (문자 경계 절단).
#[tauri::command]
pub fn fc_read_text_head(path: String, max_bytes: Option<u64>) -> Result<FcTextHead, String> {
    let verified = resolve_user_path(&path, true)?;
    let (buf, size, mut truncated) = read_capped(&verified, max_bytes.unwrap_or(200_000))?;
    let mut end = buf.len();
    while !std::str::from_utf8(&buf[..end]).is_ok() && end > 0 {
        end -= 1;
    }
    if end != buf.len() {
        truncated = true;
    }
    let text = std::str::from_utf8(&buf[..end])
        .map_err(|e| e.to_string())?
        .to_string();
    Ok(FcTextHead {
        text,
        size,
        truncated,
    })
}

/// P11-33: Office Open XML(pptx/docx) 텍스트를 zip에서 직접 추출한다.
/// pptx는 슬라이드 `ppt/slides/slideN.xml`의 `<a:t>`, docx는
/// `word/document.xml`의 `<w:t>`를 순서대로 모은다. 전체를 JS 메모리로
/// 올리지 않아 대용량 문서에 유리하다.
#[tauri::command]
pub fn fc_office_text(path: String) -> Result<String, String> {
    const MAX_CHARS: usize = 200_000;
    let verified = resolve_user_path(&path, true)?;
    let ext = verified
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_lowercase())
        .unwrap_or_default();
    let (inner_filter, tag): (Box<dyn Fn(&str) -> bool>, &str) = match ext.as_str() {
        "pptx" => (
            Box::new(|n: &str| {
                n.starts_with("ppt/slides/slide")
                    && n.ends_with(".xml")
                    && n["ppt/slides/slide".len()..n.len() - 4]
                        .chars()
                        .all(|c| c.is_ascii_digit())
            }),
            "a:t",
        ),
        "docx" => (Box::new(|n: &str| n == "word/document.xml"), "w:t"),
        _ => return Err(format!("fc_office_text supports pptx/docx only: {}", path)),
    };

    let file =
        std::fs::File::open(&verified).map_err(|e| format!("Cannot open '{}': {}", path, e))?;
    let mut archive =
        zip::ZipArchive::new(file).map_err(|e| format!("Not a valid office file: {}", e))?;
    let mut names: Vec<String> = Vec::new();
    for i in 0..archive.len() {
        let entry = archive
            .by_index(i)
            .map_err(|e| format!("Zip entry error: {}", e))?;
        let name = entry.name().to_string();
        if inner_filter(&name) {
            names.push(name);
        }
    }
    names.sort();
    if names.is_empty() {
        return Err("No readable text found in office file".to_string());
    }

    let open_tag = format!("<{}>", tag);
    let open_tag_attr = format!("<{} ", tag);
    let close_tag = format!("</{}>", tag);
    let mut out = String::new();
    for (idx, name) in names.iter().enumerate() {
        let mut entry = archive
            .by_name(name)
            .map_err(|e| format!("Zip entry error: {}", e))?;
        let mut xml = String::new();
        std::io::Read::read_to_string(&mut entry, &mut xml)
            .map_err(|e| format!("Zip entry error: {}", e))?;
        drop(entry);
        if ext == "pptx" {
            out.push_str(&format!("[slide {}]\n", idx + 1));
        }
        let mut rest = xml.as_str();
        while let Some(start) = rest.find(&open_tag).or_else(|| rest.find(&open_tag_attr)) {
            let after_open = if rest[start..].starts_with(&open_tag) {
                &rest[start + open_tag.len()..]
            } else {
                // `<w:t xml:space="preserve">` 같은 속성형은 '>'까지 건너뛴다.
                match rest[start..].find('>') {
                    Some(pos) => &rest[start + pos + 1..],
                    None => break,
                }
            };
            match after_open.find(&close_tag) {
                Some(end) => {
                    let text = after_open[..end].trim();
                    if !text.is_empty() {
                        out.push_str(text);
                        out.push('\n');
                        if out.len() >= MAX_CHARS {
                            break;
                        }
                    }
                    rest = &after_open[end + close_tag.len()..];
                }
                None => break,
            }
        }
        if out.len() >= MAX_CHARS {
            break;
        }
        out.push('\n');
    }
    if out.len() > MAX_CHARS {
        out.truncate(MAX_CHARS);
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::fs_commands::scope_test_lock;

    fn unique_base(tag: &str) -> PathBuf {
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        std::env::temp_dir().join(format!("vc-fc-test-{}-{}-{}", tag, std::process::id(), stamp))
    }

    fn test_ctl() -> (std::sync::Arc<JobControl>, mpsc::Receiver<ConflictAnswer>) {
        let (tx, rx) = mpsc::channel();
        let ctl = std::sync::Arc::new(JobControl {
            cancel: AtomicBool::new(false),
            conflict_tx: Mutex::new(tx),
            default_decision: Mutex::new(None),
            conflict_seq: AtomicU64::new(1),
        });
        (ctl, rx)
    }

    fn silent_emit(_: FcProgressEvent) {}

    #[test]
    fn test_display_path_string_strips_verbatim_prefix() {
        // UI로 verbatim(`\\?\`) 경로가 노출되면 브레드크럼이 `?/C:/...`로 조합돼
        // os error 123을 낸다.
        #[cfg(target_os = "windows")]
        {
            assert_eq!(
                display_path_string(Path::new(r"\\?\C:\Workspace\test")),
                r"C:\Workspace\test"
            );
            assert_eq!(
                display_path_string(Path::new(r"\\?\UNC\server\share\dir")),
                r"\\server\share\dir"
            );
        }
        #[cfg(not(target_os = "windows"))]
        {
            assert_eq!(
                display_path_string(Path::new("/tmp/vanilla-test")),
                "/tmp/vanilla-test"
            );
        }
    }

    #[test]
    fn test_copy_rename_and_skip_conflicts() {
        let _guard = scope_test_lock();
        let base = unique_base("conflict");
        let src = base.join("src");
        let dst = base.join("dst");
        std::fs::create_dir_all(&src).unwrap();
        std::fs::create_dir_all(&dst).unwrap();
        std::fs::write(src.join("a.txt"), "hello").unwrap();
        std::fs::write(dst.join("a.txt"), "existing").unwrap();

        let (ctl, rx) = test_ctl();
        let mut totals = OpTotals::default();
        scan_source(&src.join("a.txt"), &mut totals);
        let mut outcome = OpOutcome::default();
        let mut progress = (0u64, 0u64);
        // Rename 정책: 기존 파일 유지 + 복사본 생성.
        execute_one(
            &src.join("a.txt"),
            &dst,
            ConflictPolicy::Rename,
            false,
            &ctl,
            &rx,
            &silent_emit,
            "test",
            &totals,
            &mut outcome,
            &mut progress,
        )
        .unwrap();
        assert_eq!(std::fs::read_to_string(dst.join("a.txt")).unwrap(), "existing");
        assert_eq!(std::fs::read_to_string(dst.join("a (2).txt")).unwrap(), "hello");
        assert_eq!(outcome.renamed, 1);

        // Skip 정책: 건너뜀 집계.
        let mut outcome2 = OpOutcome::default();
        let mut progress2 = (0u64, 0u64);
        execute_one(
            &src.join("a.txt"),
            &dst,
            ConflictPolicy::Skip,
            false,
            &ctl,
            &rx,
            &silent_emit,
            "test",
            &totals,
            &mut outcome2,
            &mut progress2,
        )
        .unwrap();
        assert_eq!(outcome2.skipped, 1);

        // Overwrite 정책: 덮어씀.
        let mut outcome3 = OpOutcome::default();
        let mut progress3 = (0u64, 0u64);
        execute_one(
            &src.join("a.txt"),
            &dst,
            ConflictPolicy::Overwrite,
            false,
            &ctl,
            &rx,
            &silent_emit,
            "test",
            &totals,
            &mut outcome3,
            &mut progress3,
        )
        .unwrap();
        assert_eq!(std::fs::read_to_string(dst.join("a.txt")).unwrap(), "hello");

        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn test_ask_conflict_answered_from_channel() {
        let _guard = scope_test_lock();
        let (ctl, rx) = test_ctl();
        // 미리 답변을 넣어 두면 대기 없이 해결된다.
        ctl.conflict_tx
            .lock()
            .unwrap()
            .send(ConflictAnswer {
                conflict_id: 1,
                decision: ConflictDecision::Skip,
                apply_to_all: true,
            })
            .unwrap();
        let decision = wait_conflict(&ctl, &rx, &silent_emit, "test", Path::new("C:\\x\\a.txt")).unwrap();
        assert_eq!(decision, ConflictDecision::Skip);
        // apply_to_all이 기본값으로 저장된다.
        assert_eq!(
            *ctl.default_decision.lock().unwrap(),
            Some(ConflictDecision::Skip)
        );
    }

    #[test]
    fn test_cancel_mid_copy_is_deterministic() {
        let _guard = scope_test_lock();
        let base = unique_base("cancel");
        let src = base.join("src");
        let dst = base.join("dst");
        std::fs::create_dir_all(&src).unwrap();
        std::fs::create_dir_all(&dst).unwrap();
        for i in 0..30 {
            std::fs::write(src.join(format!("f{}.txt", i)), "data").unwrap();
        }
        let (ctl, rx) = test_ctl();
        let ctl_clone = ctl.clone();
        // 첫 progress 이벤트에서 취소 → 결정적 중단.
        let emit = |e: FcProgressEvent| {
            if matches!(e, FcProgressEvent::Progress { .. }) {
                ctl_clone.cancel.store(true, Ordering::Relaxed);
            }
        };
        let mut totals = OpTotals::default();
        scan_source(&src, &mut totals);
        let mut outcome = OpOutcome::default();
        let mut progress = (0u64, 0u64);
        let mut cancelled_seen = false;
        for entry in std::fs::read_dir(&src).unwrap().flatten() {
            let r = execute_one(
                &entry.path(),
                &dst,
                ConflictPolicy::Overwrite,
                false,
                &ctl,
                &rx,
                &emit,
                "test",
                &totals,
                &mut outcome,
                &mut progress,
            );
            if r.is_err() {
                cancelled_seen = true;
                break;
            }
        }
        assert!(cancelled_seen, "copy should stop after cancel");
        assert!(progress.0 < 30);
        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn test_zip_round_trip() {
        let _guard = scope_test_lock();
        let base = unique_base("zip");
        let src = base.join("src");
        std::fs::create_dir_all(&src.join("sub")).unwrap();
        std::fs::write(src.join("a.txt"), "alpha").unwrap();
        std::fs::write(src.join("sub").join("b.txt"), "beta").unwrap();

        let (ctl, _rx) = test_ctl();
        let mut totals = OpTotals::default();
        scan_source(&src, &mut totals);
        let archive = base.join("out.zip");
        let file = std::fs::File::create(&archive).unwrap();
        let mut writer = zip::ZipWriter::new(file);
        let mut progress = (0u64, 0u64);
        add_to_zip(&mut writer, &src, &base, &ctl, &silent_emit, "test", &mut progress, &totals)
            .unwrap();
        writer.finish().unwrap();

        let entries = fc_archive_list(archive.to_string_lossy().into_owned()).unwrap();
        assert!(entries.iter().any(|e| e.name.ends_with("a.txt")));
        assert!(entries.iter().any(|e| e.name.ends_with("sub/b.txt")));

        // 해제 후 내용 비교.
        let out = base.join("out");
        std::fs::create_dir_all(&out).unwrap();
        let f = std::fs::File::open(&archive).unwrap();
        let mut zip = zip::ZipArchive::new(f).unwrap();
        for i in 0..zip.len() {
            let mut entry = zip.by_index(i).unwrap();
            let dest = out.join(entry.enclosed_name().unwrap());
            if entry.is_dir() {
                std::fs::create_dir_all(&dest).unwrap();
            } else {
                if let Some(p) = dest.parent() {
                    std::fs::create_dir_all(p).unwrap();
                }
                let mut out_file = std::fs::File::create(&dest).unwrap();
                std::io::copy(&mut entry, &mut out_file).unwrap();
            }
        }
        assert_eq!(
            std::fs::read_to_string(out.join("src").join("a.txt")).unwrap(),
            "alpha"
        );
        assert_eq!(
            std::fs::read_to_string(out.join("src").join("sub").join("b.txt")).unwrap(),
            "beta"
        );
        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn test_list_dir_and_system_folders() {
        let _guard = scope_test_lock();
        let base = unique_base("list");
        std::fs::create_dir_all(&base).unwrap();
        std::fs::write(base.join("visible.txt"), "x").unwrap();
        std::fs::write(base.join(".hidden"), "x").unwrap();

        let shown = fc_list_dir(base.to_string_lossy().into_owned(), Some(false)).unwrap();
        assert!(shown.iter().any(|e| e.name == "visible.txt"));
        assert!(!shown.iter().any(|e| e.name == ".hidden"));
        let all = fc_list_dir(base.to_string_lossy().into_owned(), Some(true)).unwrap();
        assert!(all.iter().any(|e| e.name == ".hidden"));

        let folders = fc_system_folders().unwrap();
        assert!(folders.iter().any(|f| f.id == "home"));
        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn test_trash_round_trip() {
        let _guard = scope_test_lock();
        let base = unique_base("trash");
        std::fs::create_dir_all(&base).unwrap();
        let target = base.join("gone.txt");
        std::fs::write(&target, "x").unwrap();
        fc_trash(vec![target.to_string_lossy().into_owned()]).unwrap();
        assert!(!target.exists());
        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn test_read_bytes_and_text_head() {
        let _guard = scope_test_lock();
        let base = unique_base("readcap");
        std::fs::create_dir_all(&base).unwrap();
        let target = base.join("data.bin");
        let content = "가나다라".repeat(100);
        std::fs::write(&target, content.as_bytes()).unwrap();
        let p = target.to_string_lossy().into_owned();

        let head = fc_read_text_head(p.clone(), Some(10)).unwrap();
        assert!(head.truncated);
        assert!(head.text.chars().count() <= 10);
        // 문자 경계에서 잘렸는지 확인 (replacement character 없음).
        assert!(!head.text.contains('�'));

        let full = fc_read_text_head(p.clone(), None).unwrap();
        assert!(!full.truncated);
        assert_eq!(full.text, content);

        let bytes = fc_read_file_bytes(p, Some(8)).unwrap();
        assert!(bytes.truncated);
        assert_eq!(bytes.size as usize, content.as_bytes().len());
        assert_eq!(bytes.base64.len(), 12); // 8 bytes -> 12 base64 chars

        let _ = std::fs::remove_dir_all(&base);
    }

    fn write_office_zip(path: &std::path::Path, entries: &[(&str, &str)]) {
        let file = std::fs::File::create(path).unwrap();
        let mut zip = zip::ZipWriter::new(file);
        let options =
            zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Stored);
        for (name, content) in entries {
            zip.start_file(*name, options).unwrap();
            std::io::Write::write_all(&mut zip, content.as_bytes()).unwrap();
        }
        zip.finish().unwrap();
    }

    #[test]
    fn test_office_text_extracts_pptx_and_docx() {
        let _guard = scope_test_lock();
        let base = unique_base("office");
        std::fs::create_dir_all(&base).unwrap();

        let pptx = base.join("deck.pptx");
        write_office_zip(
            &pptx,
            &[
                (
                    "ppt/slides/slide1.xml",
                    r#"<p:sld><p:txBody><a:p><a:r><a:t>첫 슬라이드</a:t></a:r></a:p></p:txBody></p:sld>"#,
                ),
                (
                    "ppt/slides/slide2.xml",
                    r#"<p:sld><a:t>둘째</a:t><a:t>셋째</a:t></p:sld>"#,
                ),
                ("ppt/slides/_rels/slide1.xml.rels", "<rels/>"),
            ],
        );
        let text = fc_office_text(pptx.to_string_lossy().into_owned()).unwrap();
        assert!(text.contains("[slide 1]"), "{}", text);
        assert!(text.contains("첫 슬라이드"), "{}", text);
        assert!(text.contains("[slide 2]"), "{}", text);
        assert!(text.contains("둘째"), "{}", text);

        let docx = base.join("doc.docx");
        write_office_zip(
            &docx,
            &[(
                "word/document.xml",
                r#"<w:document><w:body><w:p><w:r><w:t>본문</w:t></w:r><w:r><w:t xml:space="preserve"> 두번째</w:t></w:r></w:p></w:body></w:document>"#,
            )],
        );
        let text = fc_office_text(docx.to_string_lossy().into_owned()).unwrap();
        assert!(text.contains("본문"), "{}", text);
        assert!(text.contains("두번째"), "{}", text);

        // 미지원 확장자·깨진 zip은 실패한다.
        let txt = base.join("plain.txt");
        std::fs::write(&txt, "hi").unwrap();
        assert!(fc_office_text(txt.to_string_lossy().into_owned()).is_err());
        let broken = base.join("broken.pptx");
        std::fs::write(&broken, "not a zip").unwrap();
        assert!(fc_office_text(broken.to_string_lossy().into_owned()).is_err());

        let _ = std::fs::remove_dir_all(&base);
    }
}
