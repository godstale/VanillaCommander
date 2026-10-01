//! Eval pack storage, sandbox filesystem, runtime probing, and downloads.
//!
//! Roots: builtin packs live under `resource_dir()/resources/evals` (read-only),
//! user packs under `app_data_dir/evals/packs`, project packs under
//! `{workspaceRoot}/.fortress/evals/packs`. Sandboxes live under
//! `temp_dir()/fortress-eval/<unique>` and export/import paths are
//! frontend dialog-picked absolute paths.

use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, Runtime};

use super::fs_commands::get_active_workspace_internal;

const MAX_PACK_FILE_BYTES: u64 = 32 * 1024 * 1024;
const MAX_IMPORT_BYTES: u64 = 64 * 1024 * 1024;
const MAX_DOWNLOAD_BYTES: u64 = 200 * 1024 * 1024;
const MAX_OUTPUT_BYTES: usize = 64 * 1024;
const TEXT_PROBE_BYTES: usize = 8 * 1024;
const MAX_SNAPSHOT_FILES: usize = 20_000;

static SANDBOX_COUNTER: AtomicU64 = AtomicU64::new(0);

// ---- validation helpers ----

pub fn is_valid_pack_id(pack_id: &str) -> bool {
    let bytes = pack_id.as_bytes();
    if bytes.len() < 2 || bytes.len() > 64 {
        return false;
    }
    let first = bytes[0];
    if !(first.is_ascii_alphanumeric() && !first.is_ascii_uppercase()) {
        return false;
    }
    bytes[1..]
        .iter()
        .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || *b == b'-')
}

fn validate_pack_id(pack_id: &str) -> Result<(), String> {
    if is_valid_pack_id(pack_id) {
        Ok(())
    } else {
        Err(format!("Invalid pack id: '{}'", pack_id))
    }
}

/// Reject absolute paths, NUL bytes, and any `..` / prefix / `.` escapes.
/// Returns the rel path components for safe joining.
fn validate_rel_path(rel_path: &str) -> Result<Vec<String>, String> {
    if rel_path.is_empty() || rel_path.contains('\0') {
        return Err(format!("Invalid relative path: '{}'", rel_path));
    }
    let p = Path::new(rel_path);
    if p.is_absolute() {
        return Err(format!("Absolute path not allowed: '{}'", rel_path));
    }
    let mut parts = Vec::new();
    for comp in p.components() {
        match comp {
            Component::Normal(s) => {
                let s = s.to_string_lossy().to_string();
                if s == ".." {
                    return Err(format!("Parent traversal not allowed: '{}'", rel_path));
                }
                parts.push(s);
            }
            _ => {
                return Err(format!("Invalid path component in '{}'", rel_path));
            }
        }
    }
    if parts.is_empty() {
        return Err(format!("Invalid relative path: '{}'", rel_path));
    }
    Ok(parts)
}

/// Join validated rel components onto root, then canonicalize and verify
/// containment (catches symlink escapes). When `must_exist` is false,
/// missing tails are resolved via the nearest existing ancestor.
fn join_and_verify(root: &Path, rel_path: &str, must_exist: bool) -> Result<PathBuf, String> {
    let parts = validate_rel_path(rel_path)?;
    let mut joined = root.to_path_buf();
    for part in &parts {
        joined.push(part);
    }
    verify_under_root(&joined, root, must_exist)
}

/// Canonicalize `candidate` (or its nearest existing ancestor when it does
/// not exist yet) and verify it stays under `root`.
fn verify_under_root(candidate: &Path, root: &Path, must_exist: bool) -> Result<PathBuf, String> {
    let root_canon = root
        .canonicalize()
        .map_err(|e| format!("Root '{}' error: {}", root.display(), e))?;
    if must_exist || candidate.exists() {
        let canon = candidate
            .canonicalize()
            .map_err(|e| format!("Path '{}' error: {}", candidate.display(), e))?;
        if !canon.starts_with(&root_canon) {
            return Err(format!(
                "Access denied: path '{}' escapes root '{}'",
                candidate.display(),
                root.display()
            ));
        }
        return Ok(canon);
    }
    // Nearest existing ancestor walk for not-yet-existing paths.
    let mut ancestor = candidate.parent();
    let mut tail: Vec<std::ffi::OsString> = Vec::new();
    if let Some(name) = candidate.file_name() {
        tail.push(name.to_os_string());
    }
    let mut base: Option<PathBuf> = None;
    while let Some(parent) = ancestor {
        if parent.exists() {
            let anc_canon = parent
                .canonicalize()
                .map_err(|e| format!("Ancestor '{}' error: {}", parent.display(), e))?;
            base = Some(anc_canon);
            break;
        }
        if let Some(name) = parent.file_name() {
            tail.push(name.to_os_string());
        }
        ancestor = parent.parent();
    }
    // Root itself must exist for pack/sandbox operations; fall back to root.
    let base = base.unwrap_or_else(|| root_canon.clone());
    if !base.starts_with(&root_canon) {
        return Err(format!(
            "Access denied: path '{}' escapes root '{}'",
            candidate.display(),
            root.display()
        ));
    }
    let mut full = base;
    for comp in tail.into_iter().rev() {
        full.push(comp);
    }
    // Re-verify the logical path has no `..` left (paranoia; components
    // were already validated, but ancestor splicing could reintroduce them
    // only if the filesystem contains such names — still check).
    if full.components().any(|c| matches!(c, Component::ParentDir)) {
        return Err(format!(
            "Access denied: parent traversal in '{}'",
            candidate.display()
        ));
    }
    // Symlink check on the final path is impossible pre-creation; the
    // ancestor check above covers existing links. Final containment of the
    // logical path under root:
    let root_str = root_canon.to_string_lossy().to_string();
    let full_str = full.to_string_lossy().to_string();
    if full != root_canon && !full_str.starts_with(&format!("{}{}", root_str, std::path::MAIN_SEPARATOR)) {
        return Err(format!(
            "Access denied: path '{}' escapes root '{}'",
            candidate.display(),
            root.display()
        ));
    }
    Ok(full)
}

// ---- scope roots ----

fn parse_scope(scope: &str) -> Result<&str, String> {
    match scope {
        "builtin" | "user" | "project" => Ok(scope),
        _ => Err(format!("Invalid scope: '{}'", scope)),
    }
}

fn builtin_root<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    let resource_dir = app
        .path()
        .resource_dir()
        .map_err(|e| format!("resource_dir error: {}", e))?;
    let primary = resource_dir.join("resources").join("evals");
    if primary.is_dir() {
        return Ok(primary);
    }
    let flat = resource_dir.join("evals");
    if flat.is_dir() {
        return Ok(flat);
    }
    // Dev fallback: crate manifest dir resources/evals.
    let dev = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources").join("evals");
    if dev.is_dir() {
        return Ok(dev);
    }
    Err("Builtin eval packs directory not found".to_string())
}

fn user_root<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("app_data_dir error: {}", e))?;
    let root = data_dir.join("evals").join("packs");
    std::fs::create_dir_all(&root)
        .map_err(|e| format!("Failed to create user packs dir: {}", e))?;
    Ok(root)
}

fn project_root(workspace_root: Option<String>) -> Result<PathBuf, String> {
    let active = get_active_workspace_internal();
    let ws = workspace_root.or(active).ok_or_else(|| {
        "No workspace: project scope requires an active workspace".to_string()
    })?;
    // workspaceRoot must equal the active workspace.
    if let Some(active_ws) = get_active_workspace_internal() {
        let a = Path::new(&active_ws)
            .canonicalize()
            .map_err(|e| format!("Active workspace error: {}", e))?;
        let b = Path::new(&ws)
            .canonicalize()
            .map_err(|e| format!("Workspace '{}' error: {}", ws, e))?;
        if a != b {
            return Err(format!(
                "workspace_root '{}' does not match active workspace '{}'",
                ws, active_ws
            ));
        }
    }
    let root = Path::new(&ws).join(".fortress").join("evals").join("packs");
    std::fs::create_dir_all(&root)
        .map_err(|e| format!("Failed to create project packs dir: {}", e))?;
    Ok(root)
}

fn scope_root<R: Runtime>(
    app: &AppHandle<R>,
    scope: &str,
    workspace_root: Option<String>,
) -> Result<PathBuf, String> {
    match parse_scope(scope)? {
        "builtin" => builtin_root(app),
        "user" => user_root(app),
        _ => project_root(workspace_root),
    }
}

fn sandbox_base() -> PathBuf {
    std::env::temp_dir().join("fortress-eval")
}

fn unique_sandbox_name() -> String {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let n = SANDBOX_COUNTER.fetch_add(1, Ordering::SeqCst);
    format!("{}-{}-{}", std::process::id(), nanos, n)
}

fn verify_sandbox_root(sandbox_root: &str) -> Result<PathBuf, String> {
    let base = sandbox_base();
    let candidate = Path::new(sandbox_root);
    let abs = if candidate.is_absolute() {
        candidate.to_path_buf()
    } else {
        base.join(candidate)
    };
    verify_under_root(&abs, &base, true)
}

// ---- DTOs ----

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PackListEntry {
    pub pack_id: String,
    pub manifest_text: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PackFileInput {
    pub rel_path: String,
    pub content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SnapshotEntry {
    pub path: String,
    pub size: u64,
    pub is_text: bool,
    pub content: Option<String>,
    pub modified_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RuntimeInfo {
    pub path: Option<String>,
    pub version: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RuntimesInfo {
    pub python: Option<RuntimeInfo>,
    pub node: Option<RuntimeInfo>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PythonRunResult {
    pub exit_code: i32,
    pub stdout: String,
    pub stderr: String,
    pub timed_out: bool,
    pub duration_ms: u64,
}

// ---- pack commands ----

fn read_manifest_text(pack_dir: &Path) -> Option<String> {
    for name in ["manifest.json", "pack.json"] {
        let p = pack_dir.join(name);
        if let Ok(text) = std::fs::read_to_string(&p) {
            return Some(text);
        }
    }
    None
}

#[tauri::command]
pub async fn eval_list_packs<R: Runtime>(
    app: AppHandle<R>,
    scope: String,
    workspace_root: Option<String>,
) -> Result<Vec<PackListEntry>, String> {
    let root = scope_root(&app, &scope, workspace_root)?;
    let root_canon = root
        .canonicalize()
        .map_err(|e| format!("Packs root error: {}", e))?;
    let mut out = Vec::new();
    let entries = std::fs::read_dir(&root_canon)
        .map_err(|e| format!("Failed to list packs: {}", e))?;
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let canon = match path.canonicalize() {
            Ok(c) => c,
            Err(_) => continue,
        };
        if !canon.starts_with(&root_canon) {
            continue;
        }
        let pack_id = match path.file_name().and_then(|n| n.to_str()) {
            Some(n) => n.to_string(),
            None => continue,
        };
        if !is_valid_pack_id(&pack_id) {
            continue;
        }
        if let Some(manifest_text) = read_manifest_text(&canon) {
            out.push(PackListEntry {
                pack_id,
                manifest_text,
            });
        }
    }
    out.sort_by(|a, b| a.pack_id.cmp(&b.pack_id));
    Ok(out)
}

#[tauri::command]
pub async fn eval_read_pack_file<R: Runtime>(
    app: AppHandle<R>,
    scope: String,
    pack_id: String,
    rel_path: String,
    workspace_root: Option<String>,
) -> Result<String, String> {
    validate_pack_id(&pack_id)?;
    let root = scope_root(&app, &scope, workspace_root)?;
    let pack_dir = join_and_verify(&root, &pack_id, true)?;
    if !pack_dir.is_dir() {
        return Err(format!("Pack not found: '{}'", pack_id));
    }
    let file = join_and_verify(&pack_dir, &rel_path, true)?;
    let meta = std::fs::metadata(&file)
        .map_err(|e| format!("Failed to stat '{}': {}", file.display(), e))?;
    if meta.len() > MAX_PACK_FILE_BYTES {
        return Err(format!(
            "File too large ({} bytes, cap is {} MB)",
            meta.len(),
            MAX_PACK_FILE_BYTES / (1024 * 1024)
        ));
    }
    std::fs::read_to_string(&file)
        .map_err(|e| format!("Failed to read '{}': {}", file.display(), e))
}

#[tauri::command]
pub async fn eval_write_pack_files<R: Runtime>(
    app: AppHandle<R>,
    scope: String,
    pack_id: String,
    files: Vec<PackFileInput>,
    workspace_root: Option<String>,
) -> Result<(), String> {
    if parse_scope(&scope)? == "builtin" {
        return Err("Builtin packs are read-only".to_string());
    }
    validate_pack_id(&pack_id)?;
    let root = scope_root(&app, &scope, workspace_root)?;
    let pack_dir = join_and_verify(&root, &pack_id, false)?;
    if !pack_dir.exists() {
        std::fs::create_dir_all(&pack_dir)
            .map_err(|e| format!("Failed to create pack dir: {}", e))?;
    }
    let pack_dir = pack_dir
        .canonicalize()
        .map_err(|e| format!("Pack dir error: {}", e))?;
    for f in &files {
        if f.content.len() as u64 > MAX_PACK_FILE_BYTES {
            return Err(format!("File '{}' exceeds 32MB cap", f.rel_path));
        }
        let dest = join_and_verify(&pack_dir, &f.rel_path, false)?;
        if let Some(parent) = dest.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create parent dirs: {}", e))?;
        }
        std::fs::write(&dest, &f.content)
            .map_err(|e| format!("Failed to write '{}': {}", dest.display(), e))?;
    }
    Ok(())
}

#[tauri::command]
pub async fn eval_delete_pack<R: Runtime>(
    app: AppHandle<R>,
    scope: String,
    pack_id: String,
    workspace_root: Option<String>,
) -> Result<(), String> {
    if parse_scope(&scope)? == "builtin" {
        return Err("Builtin packs are read-only".to_string());
    }
    validate_pack_id(&pack_id)?;
    let root = scope_root(&app, &scope, workspace_root)?;
    let pack_dir = join_and_verify(&root, &pack_id, true)?;
    if !pack_dir.is_dir() {
        return Err(format!("Pack not found: '{}'", pack_id));
    }
    std::fs::remove_dir_all(&pack_dir)
        .map_err(|e| format!("Failed to delete pack '{}': {}", pack_id, e))?;
    Ok(())
}

// ---- run progress log commands ----

const MAX_RUN_LOG_APPEND_BYTES: usize = 1024 * 1024;
const MAX_RUN_LOG_READ_BYTES: u64 = 2 * 1024 * 1024;

/// Run ids are UUIDs (`crypto.randomUUID`); allow the same shape plus `_`.
fn validate_run_id(run_id: &str) -> Result<(), String> {
    let bytes = run_id.as_bytes();
    if bytes.is_empty() || bytes.len() > 128 {
        return Err(format!("Invalid run id: '{}'", run_id));
    }
    let ok = bytes
        .iter()
        .all(|b| b.is_ascii_alphanumeric() || *b == b'-' || *b == b'_');
    if !ok {
        return Err(format!("Invalid run id: '{}'", run_id));
    }
    Ok(())
}

/// `{workspaceRoot}/.fortress/eval-runs`. Same active-workspace check as
/// `project_root` so logs never escape the session workspace.
fn eval_runs_root(workspace_root: Option<String>) -> Result<PathBuf, String> {
    let active = get_active_workspace_internal();
    let ws = workspace_root.or(active).ok_or_else(|| {
        "No workspace: run logs require an active workspace".to_string()
    })?;
    if let Some(active_ws) = get_active_workspace_internal() {
        let a = Path::new(&active_ws)
            .canonicalize()
            .map_err(|e| format!("Active workspace error: {}", e))?;
        let b = Path::new(&ws)
            .canonicalize()
            .map_err(|e| format!("Workspace '{}' error: {}", ws, e))?;
        if a != b {
            return Err(format!(
                "workspace_root '{}' does not match active workspace '{}'",
                ws, active_ws
            ));
        }
    }
    let root = Path::new(&ws).join(".fortress").join("eval-runs");
    std::fs::create_dir_all(&root)
        .map_err(|e| format!("Failed to create eval-runs dir: {}", e))?;
    Ok(root)
}

fn run_log_path(workspace_root: Option<String>, run_id: &str) -> Result<PathBuf, String> {
    validate_run_id(run_id)?;
    let root = eval_runs_root(workspace_root)?;
    let run_dir = join_and_verify(&root, run_id, false)?;
    if !run_dir.exists() {
        std::fs::create_dir_all(&run_dir)
            .map_err(|e| format!("Failed to create run dir: {}", e))?;
    }
    let run_dir = run_dir
        .canonicalize()
        .map_err(|e| format!("Run dir error: {}", e))?;
    Ok(run_dir.join("progress.jsonl"))
}

#[tauri::command]
pub async fn eval_append_run_log(
    workspace_root: Option<String>,
    run_id: String,
    lines: Vec<String>,
) -> Result<(), String> {
    let total: usize = lines.iter().map(|l| l.len()).sum();
    if total > MAX_RUN_LOG_APPEND_BYTES {
        return Err(format!(
            "Run log batch too large ({} bytes, cap is 1MB)",
            total
        ));
    }
    let path = run_log_path(workspace_root, &run_id)?;
    use std::io::Write;
    let mut file = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .map_err(|e| format!("Failed to open '{}': {}", path.display(), e))?;
    for line in &lines {
        // One JSON object per line; strip stray newlines so the file stays parseable.
        let flat: String = line.chars().filter(|c| *c != '\n' && *c != '\r').collect();
        writeln!(file, "{}", flat)
            .map_err(|e| format!("Failed to append to '{}': {}", path.display(), e))?;
    }
    Ok(())
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RunLogReadout {
    pub text: String,
    pub truncated: bool,
}

#[tauri::command]
pub async fn eval_read_run_log(
    workspace_root: Option<String>,
    run_id: String,
    max_bytes: Option<u64>,
) -> Result<RunLogReadout, String> {
    let path = run_log_path(workspace_root, &run_id)?;
    if !path.exists() {
        return Ok(RunLogReadout {
            text: String::new(),
            truncated: false,
        });
    }
    let cap = max_bytes.unwrap_or(MAX_RUN_LOG_READ_BYTES).clamp(1024, MAX_RUN_LOG_READ_BYTES);
    let bytes = std::fs::read(&path)
        .map_err(|e| format!("Failed to read '{}': {}", path.display(), e))?;
    if bytes.len() as u64 <= cap {
        return Ok(RunLogReadout {
            text: String::from_utf8_lossy(&bytes).to_string(),
            truncated: false,
        });
    }
    // Tail slice: start at a char boundary, then at the next newline so the
    // first line stays a complete JSON object.
    let start = bytes.len() - cap as usize;
    let mut cut = start;
    while cut < bytes.len() && !std::str::from_utf8(&bytes[cut..cut + 1]).is_ok() {
        cut += 1;
    }
    let tail = &bytes[cut..];
    let line_start = tail.iter().position(|b| *b == b'\n').map(|i| i + 1).unwrap_or(0);
    Ok(RunLogReadout {
        text: String::from_utf8_lossy(&tail[line_start..]).to_string(),
        truncated: true,
    })
}

// ---- sandbox commands ----

fn copy_dir_all(src: &Path, dst: &Path) -> Result<(), String> {
    std::fs::create_dir_all(dst)
        .map_err(|e| format!("Failed to create dir '{}': {}", dst.display(), e))?;
    let entries =
        std::fs::read_dir(src).map_err(|e| format!("Failed to read '{}': {}", src.display(), e))?;
    for entry in entries.flatten() {
        let ty = entry
            .file_type()
            .map_err(|e| format!("Failed to stat entry: {}", e))?;
        // Never follow symlinks into the sandbox.
        if ty.is_symlink() {
            continue;
        }
        let dest = dst.join(entry.file_name());
        if ty.is_dir() {
            copy_dir_all(&entry.path(), &dest)?;
        } else if ty.is_file() {
            std::fs::copy(entry.path(), &dest)
                .map_err(|e| format!("Failed to copy '{}': {}", entry.path().display(), e))?;
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn eval_sandbox_create<R: Runtime>(
    app: AppHandle<R>,
    scope: String,
    pack_id: String,
    fixture_rel_dir: String,
    workspace_root: Option<String>,
) -> Result<String, String> {
    validate_pack_id(&pack_id)?;
    let root = scope_root(&app, &scope, workspace_root)?;
    let pack_dir = join_and_verify(&root, &pack_id, true)?;
    let fixture = join_and_verify(&pack_dir, &fixture_rel_dir, true)?;
    if !fixture.is_dir() {
        return Err(format!("Fixture dir not found: '{}'", fixture_rel_dir));
    }
    let base = sandbox_base();
    std::fs::create_dir_all(&base)
        .map_err(|e| format!("Failed to create sandbox base: {}", e))?;
    let base_canon = base
        .canonicalize()
        .map_err(|e| format!("Sandbox base error: {}", e))?;
    let dest = base_canon.join(unique_sandbox_name());
    copy_dir_all(&fixture, &dest)?;
    Ok(dest.to_string_lossy().to_string())
}

#[tauri::command]
pub async fn eval_sandbox_create_from_files(
    files: Vec<PackFileInput>,
) -> Result<String, String> {
    let base = sandbox_base();
    std::fs::create_dir_all(&base)
        .map_err(|e| format!("Failed to create sandbox base: {}", e))?;
    let base_canon = base
        .canonicalize()
        .map_err(|e| format!("Sandbox base error: {}", e))?;
    let dest = base_canon.join(unique_sandbox_name());
    std::fs::create_dir_all(&dest)
        .map_err(|e| format!("Failed to create sandbox dir: {}", e))?;
    for f in &files {
        let target = join_and_verify(&dest, &f.rel_path, false)?;
        if let Some(parent) = target.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create parent dirs: {}", e))?;
        }
        std::fs::write(&target, &f.content)
            .map_err(|e| format!("Failed to write '{}': {}", target.display(), e))?;
    }
    Ok(dest.to_string_lossy().to_string())
}

pub fn is_text_bytes(sample: &[u8]) -> bool {
    if sample.contains(&0) {
        return false;
    }
    std::str::from_utf8(sample).is_ok()
}

/// Snapshot rule: text content is inlined only when the file is text and
/// fits within `max_text_bytes`; over-cap text returns size only.
pub fn should_include_content(is_text: bool, size: u64, max_text_bytes: u64) -> bool {
    size == 0 || (is_text && size <= max_text_bytes)
}

fn file_modified_ms(meta: &std::fs::Metadata) -> u64 {
    meta.modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

#[tauri::command]
pub async fn eval_sandbox_snapshot(
    sandbox_root: String,
    max_text_bytes: u64,
) -> Result<Vec<SnapshotEntry>, String> {
    let root = verify_sandbox_root(&sandbox_root)?;
    if !root.is_dir() {
        return Err(format!("Sandbox not found: '{}'", sandbox_root));
    }
    let mut out = Vec::new();
    let mut stack = vec![root.clone()];
    while let Some(dir) = stack.pop() {
        // Symlinked dirs inside the sandbox are not followed.
        let entries = match std::fs::read_dir(&dir) {
            Ok(e) => e,
            Err(_) => continue,
        };
        for entry in entries.flatten() {
            if out.len() >= MAX_SNAPSHOT_FILES {
                break;
            }
            let ty = match entry.file_type() {
                Ok(t) => t,
                Err(_) => continue,
            };
            if ty.is_symlink() {
                continue;
            }
            let path = entry.path();
            if ty.is_dir() {
                stack.push(path);
                continue;
            }
            if !ty.is_file() {
                continue;
            }
            // Canonicalize each file to catch symlink escapes from races.
            let canon = match path.canonicalize() {
                Ok(c) => c,
                Err(_) => continue,
            };
            if !canon.starts_with(&root) {
                continue;
            }
            let rel = match canon.strip_prefix(&root) {
                Ok(r) => r.to_string_lossy().replace('\\', "/"),
                Err(_) => continue,
            };
            let meta = match std::fs::metadata(&canon) {
                Ok(m) => m,
                Err(_) => continue,
            };
            let size = meta.len();
            let modified_ms = file_modified_ms(&meta);
            // Probe first 8KB for text detection.
            let probe_len = std::cmp::min(size, TEXT_PROBE_BYTES as u64) as usize;
            let mut probe = vec![0u8; probe_len];
            let is_text = match std::fs::File::open(&canon) {
                Ok(mut f) => {
                    use std::io::Read;
                    match f.read_exact(&mut probe) {
                        Ok(()) => is_text_bytes(&probe),
                        Err(_) => false,
                    }
                }
                Err(_) => false,
            };
            let content = if size == 0 {
                // Empty file counts as text.
                Some(String::new())
            } else if is_text && size <= max_text_bytes {
                // Over-cap text returns size only (content: None).
                match std::fs::read(&canon) {
                    Ok(bytes) => match String::from_utf8(bytes) {
                        Ok(s) => Some(s),
                        Err(_) => None,
                    },
                    Err(_) => None,
                }
            } else {
                None
            };
            let is_text = if content.is_some() {
                true
            } else if size == 0 {
                true
            } else if !is_text {
                false
            } else {
                // Probe said text but full read failed or was over cap:
                // trust the probe only when the whole file was probed.
                size > TEXT_PROBE_BYTES as u64
            };
            out.push(SnapshotEntry {
                path: rel,
                size,
                is_text,
                content,
                modified_ms,
            });
        }
    }
    out.sort_by(|a, b| a.path.cmp(&b.path));
    Ok(out)
}

#[tauri::command]
pub async fn eval_sandbox_destroy(sandbox_root: String) -> Result<(), String> {
    let root = verify_sandbox_root(&sandbox_root)?;
    if !root.is_dir() {
        return Err(format!("Sandbox not found: '{}'", sandbox_root));
    }
    std::fs::remove_dir_all(&root)
        .map_err(|e| format!("Failed to destroy sandbox: {}", e))?;
    Ok(())
}

#[tauri::command]
pub async fn eval_sandbox_cleanup_all() -> Result<u32, String> {
    let base = sandbox_base();
    if !base.is_dir() {
        return Ok(0);
    }
    let mut removed: u32 = 0;
    let entries =
        std::fs::read_dir(&base).map_err(|e| format!("Failed to read sandbox base: {}", e))?;
    for entry in entries.flatten() {
        let path = entry.path();
        // Only remove direct children to avoid surprises.
        let ok = if path.is_dir() {
            std::fs::remove_dir_all(&path).is_ok()
        } else {
            std::fs::remove_file(&path).is_ok()
        };
        if ok {
            removed = removed.saturating_add(1);
        }
    }
    Ok(removed)
}

// ---- runtime detection (PATH search, no shell) ----

fn find_on_path(names: &[&str]) -> Option<PathBuf> {
    let path_var = std::env::var_os("PATH")?;
    let mut candidates: Vec<PathBuf> = Vec::new();
    for dir in std::env::split_paths(&path_var) {
        for name in names {
            candidates.push(dir.join(name));
        }
    }
    #[cfg(target_os = "windows")]
    {
        let mut expanded = Vec::new();
        let pathext = std::env::var("PATHEXT").unwrap_or_else(|_| ".EXE;.BAT;.CMD".to_string());
        let exts: Vec<String> = pathext
            .split(';')
            .map(|e| e.trim().to_ascii_lowercase())
            .filter(|e| !e.is_empty())
            .collect();
        for c in &candidates {
            if c.extension().is_some() {
                expanded.push(c.clone());
            } else {
                for ext in &exts {
                    expanded.push(c.with_extension(ext.trim_start_matches('.')));
                }
                expanded.push(c.clone());
            }
        }
        candidates = expanded;
    }
    candidates.into_iter().find(|p| p.is_file())
}

fn runtime_version(path: &Path) -> Option<String> {
    let out = std::process::Command::new(path)
        .arg("--version")
        .output()
        .ok()?;
    let mut text = String::from_utf8_lossy(&out.stdout).trim().to_string();
    if text.is_empty() {
        text = String::from_utf8_lossy(&out.stderr).trim().to_string();
    }
    let first_line = text.lines().next().unwrap_or("").trim().to_string();
    if first_line.is_empty() {
        None
    } else {
        Some(first_line.chars().take(120).collect())
    }
}

fn detect_one(names: &[&str]) -> Option<RuntimeInfo> {
    let path = find_on_path(names)?;
    let version = runtime_version(&path);
    Some(RuntimeInfo {
        path: Some(path.to_string_lossy().to_string()),
        version,
    })
}

#[tauri::command]
pub async fn eval_detect_runtimes() -> Result<RuntimesInfo, String> {
    // No shell: direct PATH lookup only.
    #[cfg(target_os = "windows")]
    let python_names: &[&str] = &["python.exe", "python3.exe", "python3", "python", "py.exe", "py"];
    #[cfg(not(target_os = "windows"))]
    let python_names: &[&str] = &["python3", "python"];
    #[cfg(target_os = "windows")]
    let node_names: &[&str] = &["node.exe", "node"];
    #[cfg(not(target_os = "windows"))]
    let node_names: &[&str] = &["node", "nodejs"];
    Ok(RuntimesInfo {
        python: detect_one(python_names),
        node: detect_one(node_names),
    })
}

// ---- python execution ----

fn truncate_output(s: &str) -> String {
    let bytes = s.as_bytes();
    if bytes.len() <= MAX_OUTPUT_BYTES {
        return s.to_string();
    }
    // Truncate on a char boundary from the head.
    let mut end = MAX_OUTPUT_BYTES;
    while end > 0 && !s.is_char_boundary(end) {
        end -= 1;
    }
    format!("{}... [truncated at 64KB]", &s[..end])
}

#[tauri::command]
pub async fn eval_run_python(code: String, timeout_ms: u64) -> Result<PythonRunResult, String> {
    #[cfg(target_os = "windows")]
    let python_names: &[&str] = &["python.exe", "python3.exe", "py.exe"];
    #[cfg(not(target_os = "windows"))]
    let python_names: &[&str] = &["python3", "python"];
    let python = find_on_path(python_names)
        .ok_or_else(|| "No Python runtime found on PATH".to_string())?;
    let timeout_ms = timeout_ms.clamp(1000, 300_000);
    let started = SystemTime::now();
    let res = tauri::async_runtime::spawn_blocking(move || {
        use std::io::Read;
        let run_dir = std::env::temp_dir()
            .join("fortress-eval")
            .join(format!("pyrun-{}", unique_sandbox_name()));
        std::fs::create_dir_all(&run_dir)
            .map_err(|e| format!("Failed to create run dir: {}", e))?;
        let solution = run_dir.join("solution.py");
        std::fs::write(&solution, code)
            .map_err(|e| format!("Failed to write solution.py: {}", e))?;
        let mut child = std::process::Command::new(&python)
            .arg("-I")
            .arg("solution.py")
            .current_dir(&run_dir)
            // Minimal environment: no inherited secrets.
            .env_clear()
            .env("PATH", std::env::var_os("PATH").unwrap_or_default())
            .env("NO_COLOR", "1")
            .env("PYTHONIOENCODING", "utf-8")
            .env("PYTHONDONTWRITEBYTECODE", "1")
            .env("PYTHONNOUSERSITE", "1")
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .spawn()
            .map_err(|e| format!("Failed to spawn python: {}", e))?;
        // Drain pipes on threads so a chatty child cannot block on a
        // full pipe buffer. Each drainer caps its buffer at 64KB+1 byte.
        let stdout_handle = {
            let pipe = child.stdout.take();
            std::thread::spawn(move || {
                let mut buf = Vec::new();
                if let Some(mut p) = pipe {
                    let mut chunk = [0u8; 8192];
                    loop {
                        match p.read(&mut chunk) {
                            Ok(0) => break,
                            Ok(n) => {
                                if buf.len() < MAX_OUTPUT_BYTES + 1 {
                                    let room = (MAX_OUTPUT_BYTES + 1) - buf.len();
                                    buf.extend_from_slice(&chunk[..std::cmp::min(n, room)]);
                                }
                            }
                            Err(_) => break,
                        }
                    }
                }
                buf
            })
        };
        let stderr_handle = {
            let pipe = child.stderr.take();
            std::thread::spawn(move || {
                let mut buf = Vec::new();
                if let Some(mut p) = pipe {
                    let mut chunk = [0u8; 8192];
                    loop {
                        match p.read(&mut chunk) {
                            Ok(0) => break,
                            Ok(n) => {
                                if buf.len() < MAX_OUTPUT_BYTES + 1 {
                                    let room = (MAX_OUTPUT_BYTES + 1) - buf.len();
                                    buf.extend_from_slice(&chunk[..std::cmp::min(n, room)]);
                                }
                            }
                            Err(_) => break,
                        }
                    }
                }
                buf
            })
        };
        let poll_ms: u64 = 10;
        let mut elapsed: u64 = 0;
        let status = loop {
            match child.try_wait().map_err(|e| format!("wait error: {}", e))? {
                Some(status) => break Some(status),
                None => {
                    if elapsed >= timeout_ms {
                        let _ = child.kill();
                        let _ = child.wait();
                        break None;
                    }
                    std::thread::sleep(std::time::Duration::from_millis(poll_ms));
                    elapsed += poll_ms;
                }
            }
        };
        let timed_out = status.is_none();
        let exit_code = status.map(|s| s.code().unwrap_or(-1)).unwrap_or(-1);
        // Join drainers after the child exited; buffers are 64KB-capped.
        let stdout_bytes = stdout_handle.join().unwrap_or_default();
        let stderr_bytes = stderr_handle.join().unwrap_or_default();
        let stdout = String::from_utf8_lossy(&stdout_bytes).to_string();
        let stderr = String::from_utf8_lossy(&stderr_bytes).to_string();
        let _ = std::fs::remove_dir_all(&run_dir);
        Ok::<(i32, String, String, bool), String>((exit_code, stdout, stderr, timed_out))
    })
    .await
    .map_err(|e| format!("Python run task failed: {}", e))??;
    let duration_ms = started
        .elapsed()
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    Ok(PythonRunResult {
        exit_code: res.0,
        stdout: truncate_output(&res.1),
        stderr: truncate_output(&res.2),
        timed_out: res.3,
        duration_ms,
    })
}

// ---- download (allowlisted hosts, reqwest, 200MB cap) ----

pub fn download_host_allowed(url: &str) -> bool {
    let parsed = match url.parse::<tauri::Url>() {
        Ok(u) => u,
        Err(_) => return false,
    };
    if parsed.scheme() != "https" {
        return false;
    }
    match parsed.host_str().map(|h| h.to_ascii_lowercase()) {
        Some(h) => {
            h == "huggingface.co"
                || h == "raw.githubusercontent.com"
                || h.ends_with(".huggingface.co")
        }
        None => false,
    }
}

#[tauri::command]
pub async fn eval_download_file<R: Runtime>(
    app: AppHandle<R>,
    url: String,
    dest_scope: String,
    pack_id: String,
    rel_path: String,
) -> Result<u64, String> {
    if !download_host_allowed(&url) {
        return Err(format!("Download host not allowlisted: '{}'", url));
    }
    if parse_scope(&dest_scope)? == "builtin" {
        return Err("Builtin packs are read-only".to_string());
    }
    validate_pack_id(&pack_id)?;
    // Workspace_root for downloads: user scope does not need one; project
    // scope uses the active workspace.
    let root = scope_root(&app, &dest_scope, None)?;
    let pack_dir = join_and_verify(&root, &pack_id, false)?;
    if !pack_dir.exists() {
        std::fs::create_dir_all(&pack_dir)
            .map_err(|e| format!("Failed to create pack dir: {}", e))?;
    }
    let pack_dir = pack_dir
        .canonicalize()
        .map_err(|e| format!("Pack dir error: {}", e))?;
    let dest = join_and_verify(&pack_dir, &rel_path, false)?;
    if let Some(parent) = dest.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create parent dirs: {}", e))?;
    }
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(300))
        .build()
        .map_err(|e| format!("HTTP client build failed: {}", e))?;
    let mut resp = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("Download request failed: {}", e))?;
    if let Some(len) = resp.content_length() {
        if len > MAX_DOWNLOAD_BYTES {
            return Err(format!(
                "Remote file too large ({} bytes, cap is 200MB)",
                len
            ));
        }
    }
    if !resp.status().is_success() {
        return Err(format!("Download failed: HTTP {}", resp.status().as_u16()));
    }
    let mut file = std::fs::File::create(&dest)
        .map_err(|e| format!("Failed to create '{}': {}", dest.display(), e))?;
    let mut total: u64 = 0;
    use std::io::Write;
    while let Some(chunk) = resp
        .chunk()
        .await
        .map_err(|e| format!("Download read failed: {}", e))?
    {
        total += chunk.len() as u64;
        if total > MAX_DOWNLOAD_BYTES {
            drop(file);
            let _ = std::fs::remove_file(&dest);
            return Err("Download exceeded 200MB cap".to_string());
        }
        file.write_all(&chunk)
            .map_err(|e| format!("Failed to write download: {}", e))?;
    }
    Ok(total)
}

// ---- dialog-picked import/export paths ----

#[tauri::command]
pub async fn eval_export_write(path: String, content: String) -> Result<(), String> {
    let p = Path::new(&path);
    if !p.is_absolute() {
        return Err(format!("Export path must be absolute: '{}'", path));
    }
    if let Some(parent) = p.parent() {
        if !parent.is_dir() {
            return Err(format!("Export parent dir does not exist: '{}'", parent.display()));
        }
        // Canonicalize parent to resolve symlinks (no escape check: the
        // user explicitly chose this path via the save dialog).
        let _ = parent.canonicalize().map_err(|e| {
            format!("Export parent dir error '{}': {}", parent.display(), e)
        })?;
    }
    std::fs::write(p, content)
        .map_err(|e| format!("Failed to write export '{}': {}", path, e))?;
    Ok(())
}

#[tauri::command]
pub async fn eval_read_import_file(path: String) -> Result<String, String> {
    let p = Path::new(&path);
    if !p.is_absolute() {
        return Err(format!("Import path must be absolute: '{}'", path));
    }
    let canon = p
        .canonicalize()
        .map_err(|e| format!("Import path '{}' error: {}", path, e))?;
    let meta = std::fs::metadata(&canon)
        .map_err(|e| format!("Failed to stat '{}': {}", canon.display(), e))?;
    if meta.len() > MAX_IMPORT_BYTES {
        return Err(format!(
            "Import file too large ({} bytes, cap is 64MB)",
            meta.len()
        ));
    }
    std::fs::read_to_string(&canon)
        .map_err(|e| format!("Failed to read '{}': {}", canon.display(), e))
}

// Re-exported for unit tests: pure join helper over a temp root.
#[cfg(test)]
pub fn test_join(root: &Path, rel: &str, must_exist: bool) -> Result<PathBuf, String> {
    join_and_verify(root, rel, must_exist)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp_root(name: &str) -> PathBuf {
        let root = std::env::temp_dir()
            .join("fortress-eval-test")
            .join(name);
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).unwrap();
        root.canonicalize().unwrap()
    }

    #[test]
    fn pack_id_validation() {
        assert!(is_valid_pack_id("ab"));
        assert!(is_valid_pack_id("a1-b2-c3"));
        assert!(is_valid_pack_id("kmmlu-lite"));
        assert!(!is_valid_pack_id("a"));
        assert!(!is_valid_pack_id("A-b"));
        assert!(!is_valid_pack_id("-ab"));
        assert!(!is_valid_pack_id("a_b"));
        assert!(!is_valid_pack_id("a b"));
        assert!(!is_valid_pack_id("a/b"));
        assert!(!is_valid_pack_id("../x"));
        assert!(!is_valid_pack_id(""));
        assert!(!is_valid_pack_id(&"a".repeat(65)));
        assert!(is_valid_pack_id(&"a".repeat(64)));
    }

    #[test]
    fn traversal_rejected() {
        let root = tmp_root("traversal");
        assert!(test_join(&root, "../evil.txt", false).is_err());
        assert!(test_join(&root, "a/../../evil.txt", false).is_err());
        assert!(test_join(&root, "..", false).is_err());
        assert!(test_join(&root, "", false).is_err());
        #[cfg(target_os = "windows")]
        assert!(test_join(&root, "C:\\Windows\\x.txt", false).is_err());
        #[cfg(not(target_os = "windows"))]
        assert!(test_join(&root, "/etc/passwd", false).is_err());
        // Valid nested path resolves under root.
        let ok = test_join(&root, "sub/dir/file.txt", false).unwrap();
        assert!(ok.starts_with(&root));
    }

    #[test]
    fn absolute_rejected_by_validate() {
        assert!(validate_rel_path("/abs/path").is_err());
        assert!(validate_rel_path("..").is_err());
        assert!(validate_rel_path("a/../b").is_err());
        assert!(validate_rel_path("ok/file-name_1.jsonl").is_ok());
    }

    #[test]
    fn run_id_validation() {
        assert!(validate_run_id("550e8400-e29b-41d4-a716-446655440000").is_ok());
        assert!(validate_run_id("run_1").is_ok());
        assert!(validate_run_id("../evil").is_err());
        assert!(validate_run_id("a/b").is_err());
        assert!(validate_run_id("").is_err());
        assert!(validate_run_id(&"a".repeat(129)).is_err());
    }

    #[test]
    fn run_log_path_stays_under_runs_root() {
        let root = tmp_root("runs-root");
        let run_dir = join_and_verify(&root, "550e8400-e29b-41d4-a716-446655440000", false).unwrap();
        let joined = run_dir.join("progress.jsonl");
        let joined_str = joined.to_string_lossy().to_string();
        let root_str = root.to_string_lossy().to_string();
        assert!(joined_str.starts_with(&root_str));
        assert!(join_and_verify(&root, "../evil", false).is_err());
    }

    #[cfg(unix)]
    #[test]
    fn symlink_escape_rejected() {
        let root = tmp_root("symlink");
        let outside = tmp_root("symlink-outside");
        std::fs::write(outside.join("secret.txt"), "secret").unwrap();
        std::os::unix::fs::symlink(&outside, root.join("link")).unwrap();
        // Reading through the symlink must fail containment.
        assert!(test_join(&root, "link/secret.txt", true).is_err());
    }

    #[test]
    fn text_detection() {
        assert!(is_text_bytes(b"hello world\n"));
        assert!(is_text_bytes(b""));
        assert!(is_text_bytes("한글 텍스트".as_bytes()));
        assert!(!is_text_bytes(b"a\0b"));
        assert!(!is_text_bytes(&[0xff, 0xfe, 0x00, 0x01]));
        let mut big = vec![b'x'; TEXT_PROBE_BYTES + 10];
        assert!(is_text_bytes(&big[..TEXT_PROBE_BYTES]));
        big[TEXT_PROBE_BYTES - 1] = 0;
        assert!(!is_text_bytes(&big[..TEXT_PROBE_BYTES]));
    }

    #[test]
    fn over_cap_text_returns_size_only_logic() {
        // Snapshot rule: content is inlined only for text within cap.
        assert!(should_include_content(true, 100, 1024));
        assert!(!should_include_content(true, 100, 10));
        assert!(!should_include_content(false, 100, 1024));
        assert!(should_include_content(false, 0, 0));
        assert!(should_include_content(true, 0, 0));
    }

    #[test]
    fn download_allowlist() {
        assert!(download_host_allowed("https://huggingface.co/ds/file.json"));
        assert!(download_host_allowed("https://raw.githubusercontent.com/o/r/main/f.jsonl"));
        assert!(!download_host_allowed("http://huggingface.co/x"));
        assert!(!download_host_allowed("https://evil.com/huggingface.co/x"));
        assert!(!download_host_allowed("https://huggingface.co.evil.com/x"));
        assert!(!download_host_allowed("https://example.com/f.json"));
        assert!(!download_host_allowed("not a url"));
    }

    #[test]
    fn scope_parsing() {
        assert_eq!(parse_scope("builtin").unwrap(), "builtin");
        assert_eq!(parse_scope("user").unwrap(), "user");
        assert_eq!(parse_scope("project").unwrap(), "project");
        assert!(parse_scope("admin").is_err());
        assert!(parse_scope("").is_err());
    }
}
