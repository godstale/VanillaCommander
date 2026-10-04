//! P11-30: 위키용 폴더 감시. `notify-debouncer-full`(2초)로 묶인 파일 이벤트를
//! `wiki://file-event { path, kind }`으로 발행한다.
//!
//! - 임시 다운로드 파일(`.crdownload`, `.part`, `.tmp`, `~$*`)은 제외한다.
//! - 발행 전 **크기 안정화 확인**(1초 간격 2회 동일)을 거쳐, 아직 쓰기 중인
//!   파일을 파이프라인에 넘기지 않는다.
//! - 감시 집합은 `wiki_watch_set` 호출 때마다 교체된다(이전 감시는 중지).

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{mpsc, Mutex, OnceLock};
use std::time::{Duration, Instant};

use sha2::{Digest, Sha256};
use notify::{EventKind, RecommendedWatcher, RecursiveMode};
use notify_debouncer_full::{new_debouncer, DebounceEventResult, Debouncer, FileIdMap};
use serde::Serialize;
use tauri::Emitter;

/// 프런트가 구독하는 감시 이벤트. `listen('wiki://file-event', ...)`로 수신한다.
#[derive(Debug, Clone, Serialize)]
pub struct WikiFileEvent {
    pub path: String,
    pub kind: String,
}

/// 감시 스레드 제어 핸들. 교체·종료 시 스레드에 중지를 요청한다.
struct WatchHandle {
    stop_tx: mpsc::Sender<()>,
}

struct WatchState {
    folders: Vec<String>,
    handle: Option<WatchHandle>,
}

fn watch_state() -> &'static Mutex<WatchState> {
    static STATE: OnceLock<Mutex<WatchState>> = OnceLock::new();
    STATE.get_or_init(|| {
        Mutex::new(WatchState {
            folders: Vec::new(),
            handle: None,
        })
    })
}

/// 다운로드 중인 임시 파일을 가려낸다. 파일명(소문자) 기준 순수 판정이라 테스트가 쉽다.
fn is_temp_file_name(lower_name: &str) -> bool {
    lower_name.ends_with(".crdownload")
        || lower_name.ends_with(".part")
        || lower_name.ends_with(".tmp")
        || lower_name.starts_with("~$")
}

fn temp_file_excluded(path: &Path) -> bool {
    path.file_name()
        .and_then(|n| n.to_str())
        .map(|n| is_temp_file_name(&n.to_lowercase()))
        .unwrap_or(false)
}

/// notify 이벤트 종류 → 페이로드 kind. 제거·재스캔 등은 파이프라인과 무관해 None이다.
fn event_kind_label(kind: &EventKind) -> Option<&'static str> {
    match kind {
        EventKind::Create(_) => Some("created"),
        EventKind::Modify(_) => Some("modified"),
        EventKind::Remove(_) => None,
        EventKind::Access(_) => None,
        EventKind::Any => Some("modified"),
        EventKind::Other => None,
    }
}

/// 파일 크기가 안정될 때까지 기다린다. 1초 간격으로 2회 읽어 동일하면 확정하고,
/// 중간에 사라지면 None(발행 생략)을 반환한다.
fn wait_for_stable_size(path: &Path, interval: Duration) -> Option<u64> {
    let first = std::fs::metadata(path).ok()?.len();
    std::thread::sleep(interval);
    let second = std::fs::metadata(path).ok()?.len();
    if first == second {
        Some(second)
    } else {
        // 한 번 더 기다린다. 그래도 다르면 다음 이벤트에 맡기고 생략한다.
        std::thread::sleep(interval);
        let third = std::fs::metadata(path).ok()?.len();
        if second == third {
            Some(third)
        } else {
            None
        }
    }
}

struct WatchConfig {
    debounce: Duration,
    stable_wait: Duration,
    emit_cooldown: Duration,
}

impl Default for WatchConfig {
    fn default() -> Self {
        Self {
            debounce: Duration::from_secs(2),
            stable_wait: Duration::from_secs(1),
            emit_cooldown: Duration::from_secs(5),
        }
    }
}

fn spawn_watcher(
    app: tauri::AppHandle,
    folders: Vec<PathBuf>,
    recursive: bool,
    config: WatchConfig,
) -> Result<WatchHandle, String> {
    let (stop_tx, stop_rx) = mpsc::channel::<()>();
    let (event_tx, event_rx) = mpsc::channel::<DebounceEventResult>();

    let mut debouncer: Debouncer<RecommendedWatcher, FileIdMap> =
        new_debouncer(config.debounce, None, event_tx)
            .map_err(|e| format!("Failed to start folder watcher: {}", e))?;
    let mode = if recursive {
        RecursiveMode::Recursive
    } else {
        RecursiveMode::NonRecursive
    };
    for folder in &folders {
        debouncer
            .watch(folder, mode)
            .map_err(|e| format!("Failed to watch '{}': {}", folder.display(), e))?;
    }

    std::thread::spawn(move || {
        // Some(true) = 명시 중지, None = 채널 끊김(교체 시 이전 스레드 정리).
        let stopped = |rx: &mpsc::Receiver<()>| rx.try_recv().is_ok();
        let mut last_emit: HashMap<String, Instant> = HashMap::new();
        // debouncer를 스레드가 소유한다. 중지 시 감시를 풀고 종료한다.
        let mut debouncer = Some(debouncer);
        loop {
            if stopped(&stop_rx) {
                break;
            }
            match event_rx.recv_timeout(Duration::from_millis(200)) {
                Ok(Ok(events)) => {
                    for debounced in events {
                        if stopped(&stop_rx) {
                            break;
                        }
                        let Some(kind) = event_kind_label(&debounced.event.kind) else {
                            continue;
                        };
                        for path in &debounced.event.paths {
                            if stopped(&stop_rx) {
                                break;
                            }
                            if temp_file_excluded(path) {
                                continue;
                            }
                            if !path.is_file() {
                                continue;
                            }
                            let path_str = path.to_string_lossy().into_owned();
                            if let Some(last) = last_emit.get(&path_str) {
                                if last.elapsed() < config.emit_cooldown {
                                    continue;
                                }
                            }
                            if wait_for_stable_size(path, config.stable_wait).is_none() {
                                continue;
                            }
                            last_emit.insert(path_str.clone(), Instant::now());
                            let _ = app.emit(
                                "wiki://file-event",
                                WikiFileEvent {
                                    path: path_str,
                                    kind: kind.to_string(),
                                },
                            );
                        }
                    }
                }
                Ok(Err(_)) => {
                    // debouncer 내부 오류(예: 경로 접근 실패)는 무시하고 계속한다.
                    continue;
                }
                Err(mpsc::RecvTimeoutError::Timeout) => continue,
                Err(mpsc::RecvTimeoutError::Disconnected) => break,
            }
        }
        if let Some(d) = debouncer.take() {
            d.stop();
        }
    });

    Ok(WatchHandle { stop_tx })
}

fn stop_current(state: &mut WatchState) {
    if let Some(handle) = state.handle.take() {
        let _ = handle.stop_tx.send(());
    }
    state.folders.clear();
}

/// 감시 폴더 집합을 교체한다. 빈 배열이면 감시를 끈다.
/// 반환값은 canonicalize된 실제 감시 폴더 목록이다.
#[tauri::command]
pub fn wiki_watch_set(
    app: tauri::AppHandle,
    folders: Vec<String>,
    recursive: Option<bool>,
) -> Result<Vec<String>, String> {
    let mut canonical: Vec<PathBuf> = Vec::new();
    for f in &folders {
        let p = Path::new(f)
            .canonicalize()
            .map_err(|e| format!("Watch folder '{}' error: {}", f, e))?;
        if !p.is_dir() {
            return Err(format!("Watch folder is not a directory: {}", f));
        }
        if !canonical.contains(&p) {
            canonical.push(p);
        }
    }

    let mut state = watch_state()
        .lock()
        .map_err(|e| format!("Watcher state poisoned: {}", e))?;
    stop_current(&mut state);
    if !canonical.is_empty() {
        let handle = spawn_watcher(
            app,
            canonical.clone(),
            recursive.unwrap_or(false),
            WatchConfig::default(),
        )?;
        state.handle = Some(handle);
        state.folders = canonical
            .iter()
            .map(|p| p.to_string_lossy().into_owned())
            .collect();
    }
    Ok(state.folders.clone())
}

/// 감시를 끈다. `wiki_watch_set`에 빈 배열을 넘긴 것과 같다.
#[tauri::command]
pub fn wiki_watch_stop() -> Result<(), String> {
    let mut state = watch_state()
        .lock()
        .map_err(|e| format!("Watcher state poisoned: {}", e))?;
    stop_current(&mut state);
    Ok(())
}

/// 현재 감시 중인 폴더 목록(canonical).
#[tauri::command]
pub fn wiki_watch_status() -> Result<Vec<String>, String> {
    let state = watch_state()
        .lock()
        .map_err(|e| format!("Watcher state poisoned: {}", e))?;
    Ok(state.folders.clone())
}

/// 주기 스캔 결과 1건. 감시 이벤트를 놓친 파일(앱 종료 중 유입 등)을 따라잡는 데 쓴다.
#[derive(Debug, Clone, Serialize)]
pub struct WikiScanEntry {
    pub path: String,
    pub size: u64,
    pub modified_ms: u64,
}

fn scan_folder(root: &Path, recursive: bool, out: &mut Vec<WikiScanEntry>) {
    let Ok(read) = std::fs::read_dir(root) else {
        return;
    };
    for entry in read.flatten() {
        let path = entry.path();
        let Ok(meta) = entry.metadata() else {
            continue;
        };
        if meta.is_dir() {
            if recursive {
                scan_folder(&path, recursive, out);
            }
            continue;
        }
        if !meta.is_file() || temp_file_excluded(&path) {
            continue;
        }
        let modified_ms = meta
            .modified()
            .ok()
            .and_then(|m| m.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);
        out.push(WikiScanEntry {
            path: path.to_string_lossy().into_owned(),
            size: meta.len(),
            modified_ms,
        });
    }
}

/// 감시 폴더의 현재 파일 목록. 필터링·중복 판정은 프런트 파이프라인이 한다.
#[tauri::command]
pub fn wiki_scan_folders(
    folders: Vec<String>,
    recursive: Option<bool>,
) -> Result<Vec<WikiScanEntry>, String> {
    let recursive = recursive.unwrap_or(false);
    let mut out = Vec::new();
    for f in &folders {
        let p = Path::new(f)
            .canonicalize()
            .map_err(|e| format!("Scan folder '{}' error: {}", f, e))?;
        if !p.is_dir() {
            return Err(format!("Scan folder is not a directory: {}", f));
        }
        scan_folder(&p, recursive, &mut out);
    }
    Ok(out)
}

fn hash_file(path: &Path) -> Result<String, String> {
    use std::io::Read;
    let mut file = std::fs::File::open(path)
        .map_err(|e| format!("Failed to open '{}': {}", path.display(), e))?;
    let mut hasher = Sha256::new();
    let mut buf = [0u8; 64 * 1024];
    loop {
        let n = file
            .read(&mut buf)
            .map_err(|e| format!("Failed to read '{}': {}", path.display(), e))?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    Ok(hasher
        .finalize()
        .iter()
        .map(|b| format!("{:02x}", b))
        .collect())
}

/// 파일 내용의 SHA-256(hex). 같은 내용의 중복 등록을 막는 데 쓴다.
#[tauri::command]
pub fn wiki_file_hash(path: String) -> Result<String, String> {
    hash_file(Path::new(&path))
}

/// 기본 감시 폴더 = OS 다운로드 폴더 (P11-31 위키 설정의 초기값).
#[tauri::command]
pub fn wiki_default_watch_folder() -> Result<String, String> {
    dirs::download_dir()
        .map(|p| p.to_string_lossy().into_owned())
        .ok_or_else(|| "Could not locate the OS download folder".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn temp_download_files_are_excluded() {
        for name in [
            "movie.mp4.crdownload",
            "setup.PART",
            "upload.tmp",
            "~$report.docx",
            ".crdownload",
        ] {
            assert!(is_temp_file_name(&name.to_lowercase()), "{}", name);
        }
        for name in ["report.pdf", "photo.png", "notes.tmp.bak", "par.txt"] {
            assert!(!is_temp_file_name(&name.to_lowercase()), "{}", name);
        }
    }

    #[test]
    fn event_kinds_map_to_payload() {
        assert_eq!(
            event_kind_label(&EventKind::Create(notify::event::CreateKind::File)),
            Some("created")
        );
        assert_eq!(
            event_kind_label(&EventKind::Modify(notify::event::ModifyKind::Data(
                notify::event::DataChange::Any
            ))),
            Some("modified")
        );
        assert_eq!(
            event_kind_label(&EventKind::Remove(notify::event::RemoveKind::File)),
            None
        );
        assert_eq!(
            event_kind_label(&EventKind::Access(notify::event::AccessKind::Open(
                notify::event::AccessMode::Read
            ))),
            None
        );
    }

    #[test]
    fn stable_size_returns_none_for_missing_file() {
        let missing = Path::new("/definitely/not/here/file.txt");
        assert_eq!(
            wait_for_stable_size(missing, Duration::from_millis(10)),
            None
        );
    }

    #[test]
    fn stable_size_accepts_quiet_file() {
        let dir = std::env::temp_dir().join(format!(
            "vanilla-watch-test-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or(0)
        ));
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join("quiet.txt");
        std::fs::write(&file, b"hello").unwrap();
        let size = wait_for_stable_size(&file, Duration::from_millis(10));
        assert_eq!(size, Some(5));
        let _ = std::fs::remove_dir_all(&dir);
    }

    fn unique_temp_dir(tag: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "vanilla-{}-{}",
            tag,
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or(0)
        ))
    }

    #[test]
    fn scan_lists_files_and_honors_recursive() {
        let dir = unique_temp_dir("scan-test");
        let sub = dir.join("sub");
        std::fs::create_dir_all(&sub).unwrap();
        std::fs::write(dir.join("a.txt"), b"a").unwrap();
        std::fs::write(dir.join("b.crdownload"), b"b").unwrap();
        std::fs::write(sub.join("c.txt"), b"c").unwrap();

        let flat = wiki_scan_folders(vec![dir.to_string_lossy().into_owned()], None).unwrap();
        assert_eq!(flat.len(), 1);
        assert!(flat[0].path.ends_with("a.txt"));

        let deep =
            wiki_scan_folders(vec![dir.to_string_lossy().into_owned()], Some(true)).unwrap();
        assert_eq!(deep.len(), 2);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn hash_matches_known_sha256() {
        let dir = unique_temp_dir("hash-test");
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join("h.txt");
        std::fs::write(&file, b"abc").unwrap();
        assert_eq!(
            hash_file(&file).unwrap(),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
        let _ = std::fs::remove_dir_all(&dir);
    }
}
