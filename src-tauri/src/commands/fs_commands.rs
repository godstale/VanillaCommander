use std::path::{Path, PathBuf};
use std::sync::RwLock;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Runtime};
use tauri_plugin_dialog::DialogExt;

static AGENT_ALLOWED_ROOTS: RwLock<Vec<String>> = RwLock::new(Vec::new());

pub fn set_allowed_roots_internal(roots: Vec<String>) {
    // starts_with 비교가 동작하도록 canonical 형태로 보관한다 (Windows \\?\ 접두 등).
    let canonical: Vec<String> = roots
        .into_iter()
        .map(|r| {
            Path::new(&r)
                .canonicalize()
                .map(|p| p.to_string_lossy().into_owned())
                .unwrap_or(r)
        })
        .collect();
    if let Ok(mut lock) = AGENT_ALLOWED_ROOTS.write() {
        *lock = canonical;
    }
}

pub fn get_allowed_roots_internal() -> Vec<String> {
    AGENT_ALLOWED_ROOTS
        .read()
        .map(|lock| lock.clone())
        .unwrap_or_default()
}

/// 허용 루트 static을 건드리는 테스트끼리 직렬화한다 (integration_commands 포함).
#[cfg(test)]
pub fn scope_test_lock() -> std::sync::MutexGuard<'static, ()> {
    static LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());
    LOCK.lock().unwrap_or_else(|e| e.into_inner())
}

/// 에이전트 허용 루트 설정 (D1, P11-04). 존재하는 디렉터리만 등록한다.
#[tauri::command]
pub fn set_agent_allowed_roots(roots: Vec<String>) -> Result<(), String> {
    let mut canonical: Vec<String> = Vec::new();
    for r in roots {
        let p = Path::new(&r)
            .canonicalize()
            .map_err(|e| format!("Allowed root '{}' error: {}", r, e))?;
        if !p.is_dir() {
            return Err(format!("Allowed root is not a directory: {}", r));
        }
        canonical.push(p.to_string_lossy().into_owned());
    }
    set_allowed_roots_internal(canonical);
    Ok(())
}

/// Fortress 시절 데이터(`.fortress/fortress.db*`)를 새 이름으로 옮긴다. 새 폴더가 이미 있으면 건드리지 않는다.
fn migrate_legacy_data_dir(ws_path: &Path, app_data_dir: &Path) {
    let legacy_dir = ws_path.join(".fortress");
    if app_data_dir.exists() || !legacy_dir.is_dir() {
        return;
    }
    if std::fs::rename(&legacy_dir, app_data_dir).is_err() {
        return;
    }
    rename_legacy_db_files(app_data_dir);
}

/// `fortress.db`, `fortress.db-wal`, `fortress.db-shm` → `vanilla-commander.db*`
pub fn rename_legacy_db_files(dir: &Path) {
    for suffix in ["", "-wal", "-shm"] {
        let from = dir.join(format!("fortress.db{}", suffix));
        let to = dir.join(format!("vanilla-commander.db{}", suffix));
        if from.exists() && !to.exists() {
            let _ = std::fs::rename(&from, &to);
        }
    }
}

#[tauri::command]
pub fn ensure_app_data_dir(workspace_root: String) -> Result<String, String> {
    let ws_path = Path::new(&workspace_root);
    if !ws_path.is_dir() {
        return Err(format!("Workspace root is not a valid directory: {}", workspace_root));
    }
    let app_data_dir = ws_path.join(".vanilla-commander");
    migrate_legacy_data_dir(ws_path, &app_data_dir);
    if !app_data_dir.exists() {
        std::fs::create_dir_all(&app_data_dir).map_err(|e| format!("Failed to create .vanilla-commander dir: {}", e))?;
    }
    let gitignore_path = app_data_dir.join(".gitignore");
    if !gitignore_path.exists() {
        let _ = std::fs::write(&gitignore_path, "*.db\n*.db-*\nlogs/\n");
    }
    let logs_dir = app_data_dir.join("logs");
    if !logs_dir.exists() {
        let _ = std::fs::create_dir_all(&logs_dir);
    }
    Ok(app_data_dir.to_string_lossy().to_string())
}

#[derive(Debug, Serialize, Deserialize)]
pub struct AppPathsInfo {
    pub app_data_dir: String,
    pub app_log_dir: String,
    pub current_workspace: Option<String>,
}

#[tauri::command]
pub fn get_app_paths<R: Runtime>(app: AppHandle<R>) -> Result<AppPathsInfo, String> {
    use tauri::Manager;
    let data_dir = app
        .path()
        .app_data_dir()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_default();
    let log_dir = app
        .path()
        .app_log_dir()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_default();
    let current_ws = get_allowed_roots_internal().into_iter().next();

    Ok(AppPathsInfo {
        app_data_dir: data_dir,
        app_log_dir: log_dir,
        current_workspace: current_ws,
    })
}

pub fn resolve_path(path_str: &str, workspace_root: Option<&str>) -> PathBuf {
    let p = Path::new(path_str);
    if p.is_absolute() {
        return p.to_path_buf();
    }

    let root_opt = workspace_root
        .map(|s| s.to_string())
        .or_else(|| get_allowed_roots_internal().into_iter().next())
        .or_else(|| std::env::current_dir().ok().map(|d| d.to_string_lossy().to_string()));

    if let Some(ws) = root_opt {
        if path_str == "." || path_str == "./" || path_str == ".\\" || path_str.is_empty() {
            return Path::new(&ws).to_path_buf();
        }
        let clean = path_str
            .strip_prefix("./")
            .or_else(|| path_str.strip_prefix(".\\"))
            .unwrap_or(path_str);
        Path::new(&ws).join(clean)
    } else {
        p.to_path_buf()
    }
}

fn is_within_roots(canonical: &Path, roots: &[PathBuf]) -> bool {
    roots.iter().any(|r| canonical.starts_with(r))
}

pub fn resolve_and_verify_workspace_path(
    path_str: &str,
    workspace_root: Option<&str>,
    must_exist: bool,
) -> Result<PathBuf, String> {
    let roots = get_allowed_roots_internal()
        .into_iter()
        .map(PathBuf::from)
        .collect::<Vec<_>>();

    // 검증 기준: 명시 루트(허용 루트 안에 있을 때만 인정) + 허용 루트 전체.
    // 허용 루트가 비어 있으면 명시 루트만 쓴다(기존 호환).
    let mut bases: Vec<PathBuf> = Vec::new();
    if let Some(ws) = workspace_root.filter(|s| !s.trim().is_empty()) {
        let ws_canonical = Path::new(ws)
            .canonicalize()
            .map_err(|e| format!("Workspace '{}' error: {}", ws, e))?;
        if !roots.is_empty() && !is_within_roots(&ws_canonical, &roots) {
            return Err(format!(
                "Access denied: workspace '{}' is outside allowed roots",
                ws
            ));
        }
        bases.push(ws_canonical);
    }
    bases.extend(roots);

    let base_opt = bases.first().map(|p| p.to_string_lossy().into_owned());
    let resolved = resolve_path(path_str, base_opt.as_deref());

    if bases.is_empty() {
        return Ok(resolved);
    }
    let within = |c: &Path| {
        if is_within_roots(c, &bases) {
            Ok(())
        } else {
            Err(format!(
                "Access denied: path '{}' is outside allowed roots",
                resolved.display()
            ))
        }
    };

    if must_exist {
        let canonical = resolved
            .canonicalize()
            .map_err(|e| format!("Path '{}' error: {}", resolved.display(), e))?;
        within(&canonical)?;
        return Ok(canonical);
    }

    if resolved.exists() {
        let canonical = resolved
            .canonicalize()
            .map_err(|e| format!("Path '{}' error: {}", resolved.display(), e))?;
        within(&canonical)?;
        return Ok(canonical);
    }

    // File does not exist yet; find nearest existing ancestor
    let mut ancestor = resolved.parent();
    let mut remaining_components = Vec::new();
    if let Some(file_name) = resolved.file_name() {
        remaining_components.push(file_name);
    }

    let mut existing_ancestor_canonical = None;
    while let Some(parent) = ancestor {
        if parent.exists() {
            let anc_canon = parent
                .canonicalize()
                .map_err(|e| format!("Ancestor path '{}' error: {}", parent.display(), e))?;
            existing_ancestor_canonical = Some(anc_canon);
            break;
        } else {
            if let Some(name) = parent.file_name() {
                remaining_components.push(name);
            }
            ancestor = parent.parent();
        }
    }

    let base = match existing_ancestor_canonical {
        Some(canon) => canon,
        None => {
            return Err(format!(
                "Access denied: no existing ancestor for '{}'",
                resolved.display()
            ))
        }
    };
    within(&base)?;

    let mut full_path = base;
    for comp in remaining_components.into_iter().rev() {
        let s = comp.to_string_lossy();
        if s == ".." {
            return Err(format!(
                "Access denied: parent directory traversal in '{}'",
                path_str
            ));
        } else if s != "." {
            full_path.push(comp);
        }
    }
    Ok(full_path)
}

/// 사용자 UI용 경로 해석 (D1). 스코프 검사는 하지 않고 canonicalize와
/// 상위 traversal 방지만 수행한다. 에이전트 도구에는 사용하지 않는다.
pub fn resolve_user_path(path_str: &str, must_exist: bool) -> Result<PathBuf, String> {
    let resolved = Path::new(path_str).to_path_buf();
    if must_exist {
        return resolved
            .canonicalize()
            .map_err(|e| format!("Path '{}' error: {}", resolved.display(), e));
    }
    if resolved.exists() {
        return resolved
            .canonicalize()
            .map_err(|e| format!("Path '{}' error: {}", resolved.display(), e));
    }
    for comp in resolved.components() {
        if matches!(comp, std::path::Component::ParentDir) {
            return Err(format!(
                "Access denied: parent directory traversal in '{}'",
                path_str
            ));
        }
    }
    Ok(resolved)
}

#[derive(Debug, Serialize, Deserialize)]
pub struct FileTreeNode {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub children: Option<Vec<FileTreeNode>>,
}

fn read_dir_recursive(dir: &Path) -> Result<Vec<FileTreeNode>, String> {
    let mut entries: Vec<_> = std::fs::read_dir(dir)
        .map_err(|e| e.to_string())?
        .filter_map(|entry| entry.ok())
        .filter(|entry| {
            let name = entry.file_name().to_string_lossy().to_string();
            !name.starts_with('.') && name != "node_modules" && name != "target"
        })
        .collect();

    entries.sort_by(|a, b| {
        let a_is_dir = a.path().is_dir();
        let b_is_dir = b.path().is_dir();
        if a_is_dir != b_is_dir {
            if a_is_dir {
                std::cmp::Ordering::Less
            } else {
                std::cmp::Ordering::Greater
            }
        } else {
            a.file_name().cmp(&b.file_name())
        }
    });

    entries
        .into_iter()
        .map(|entry| {
            let path = entry.path();
            let name = entry.file_name().to_string_lossy().to_string();
            let is_dir = path.is_dir();
            let children = if is_dir {
                Some(read_dir_recursive(&path)?)
            } else {
                None
            };
            Ok(FileTreeNode {
                name,
                path: path.to_string_lossy().to_string(),
                is_dir,
                children,
            })
        })
        .collect()
}

#[tauri::command]
pub async fn pick_project_folder<R: Runtime>(app: AppHandle<R>) -> Result<Option<String>, String> {
    let (tx, rx) = std::sync::mpsc::channel();
    app.dialog().file().pick_folder(move |folder_path| {
        let _ = tx.send(folder_path);
    });

    let picked_opt = tauri::async_runtime::spawn_blocking(move || rx.recv())
        .await
        .map_err(|e| e.to_string())?
        .map(|picked| picked.map(|p| p.to_string()))
        .map_err(|e| e.to_string())?;

    // 허용 루트 등록은 호출자(JS)가 set_agent_allowed_roots로 수행한다.
    Ok(picked_opt)
}

#[tauri::command]
pub fn read_project_folder_tree(folder_path: String) -> Result<FileTreeNode, String> {
    let root = Path::new(&folder_path);
    if !root.is_dir() {
        return Err(format!("Not a directory: {}", folder_path));
    }
    Ok(FileTreeNode {
        name: root
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| folder_path.clone()),
        path: folder_path.clone(),
        is_dir: true,
        children: Some(read_dir_recursive(root)?),
    })
}

#[tauri::command]
pub fn read_text_file(path: String, workspace_root: Option<String>) -> Result<String, String> {
    let verified = resolve_and_verify_workspace_path(&path, workspace_root.as_deref(), true)?;
    std::fs::read_to_string(&verified).map_err(|e| format!("Failed to read {}: {}", verified.display(), e))
}

#[tauri::command]
pub fn write_text_file(path: String, contents: String, workspace_root: Option<String>) -> Result<(), String> {
    let verified = resolve_and_verify_workspace_path(&path, workspace_root.as_deref(), false)?;
    if let Some(parent) = verified.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::write(&verified, contents).map_err(|e| format!("Failed to write {}: {}", verified.display(), e))
}

#[tauri::command]
pub fn create_file(path: String, workspace_root: Option<String>) -> Result<(), String> {
    let verified = resolve_and_verify_workspace_path(&path, workspace_root.as_deref(), false)?;
    if verified.exists() {
        return Err(format!("이미 파일이 존재합니다: {}", verified.display()));
    }
    if let Some(parent) = verified.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::write(&verified, []).map_err(|e| format!("Failed to create {}: {}", verified.display(), e))
}

#[tauri::command]
pub fn create_folder(path: String, workspace_root: Option<String>) -> Result<(), String> {
    let verified = resolve_and_verify_workspace_path(&path, workspace_root.as_deref(), false)?;
    if verified.exists() {
        return Err(format!("이미 폴더가 존재합니다: {}", verified.display()));
    }
    std::fs::create_dir_all(&verified).map_err(|e| format!("Failed to create {}: {}", verified.display(), e))
}

#[tauri::command]
pub fn rename_path(from: String, to: String, workspace_root: Option<String>) -> Result<(), String> {
    let verified_from = resolve_and_verify_workspace_path(&from, workspace_root.as_deref(), true)?;
    let verified_to = resolve_and_verify_workspace_path(&to, workspace_root.as_deref(), false)?;
    if verified_to.exists() {
        return Err(format!("이미 대상 경로가 존재합니다: {}", verified_to.display()));
    }
    std::fs::rename(&verified_from, &verified_to)
        .map_err(|e| format!("Failed to rename {} to {}: {}", verified_from.display(), verified_to.display(), e))
}

#[tauri::command]
pub fn delete_path(path: String, workspace_root: Option<String>) -> Result<(), String> {
    let verified = resolve_and_verify_workspace_path(&path, workspace_root.as_deref(), true)?;
    if verified.is_dir() {
        std::fs::remove_dir_all(&verified).map_err(|e| format!("Failed to delete {}: {}", verified.display(), e))
    } else {
        std::fs::remove_file(&verified).map_err(|e| format!("Failed to delete {}: {}", verified.display(), e))
    }
}

#[derive(Debug, Serialize, Deserialize)]
pub struct DirEntryItem {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub size: u64,
}

pub fn verify_path_in_workspace(target: &Path, workspace_root: Option<&str>) -> Result<PathBuf, String> {
    resolve_and_verify_workspace_path(&target.to_string_lossy(), workspace_root, true)
}

#[tauri::command]
pub fn list_dir(path: String, workspace_root: Option<String>) -> Result<Vec<DirEntryItem>, String> {
    let verified = resolve_and_verify_workspace_path(&path, workspace_root.as_deref(), true)?;
    if !verified.is_dir() {
        return Err(format!("Not a directory: {}", verified.display()));
    }
    let read_res = std::fs::read_dir(&verified).map_err(|e| format!("Failed to read directory '{}': {}", verified.display(), e))?;
    let mut entries = Vec::new();
    for entry in read_res.flatten() {
        let entry_path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();
        let is_dir = entry_path.is_dir();
        let size = if is_dir { 0 } else { entry.metadata().map(|m| m.len()).unwrap_or(0) };
        entries.push(DirEntryItem {
            name,
            path: entry_path.to_string_lossy().to_string(),
            is_dir,
            size,
        });
    }
    entries.sort_by(|a, b| {
        if a.is_dir != b.is_dir {
            if a.is_dir {
                std::cmp::Ordering::Less
            } else {
                std::cmp::Ordering::Greater
            }
        } else {
            a.name.cmp(&b.name)
        }
    });
    Ok(entries)
}

fn copy_dir_all(src: &Path, dst: &Path) -> std::io::Result<()> {
    std::fs::create_dir_all(dst)?;
    for entry in std::fs::read_dir(src)? {
        let entry = entry?;
        let ty = entry.file_type()?;
        let dest_child = dst.join(entry.file_name());
        if ty.is_dir() {
            copy_dir_all(&entry.path(), &dest_child)?;
        } else {
            std::fs::copy(entry.path(), dest_child)?;
        }
    }
    Ok(())
}

#[tauri::command]
pub fn copy_path(from: String, to: String, workspace_root: Option<String>) -> Result<(), String> {
    let verified_from = resolve_and_verify_workspace_path(&from, workspace_root.as_deref(), true)?;
    let verified_to = resolve_and_verify_workspace_path(&to, workspace_root.as_deref(), false)?;

    if verified_to.exists() {
        return Err(format!("이미 대상 경로가 존재합니다: {}", verified_to.display()));
    }

    if verified_from.is_dir() {
        copy_dir_all(&verified_from, &verified_to)
            .map_err(|e| format!("Failed to copy directory: {}", e))?;
    } else {
        if let Some(parent) = verified_to.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        std::fs::copy(&verified_from, &verified_to)
            .map_err(|e| format!("Failed to copy file: {}", e))?;
    }
    Ok(())
}

#[tauri::command]
pub fn reveal_in_explorer(path: String, workspace_root: Option<String>) -> Result<(), String> {
    // 사용자 UI 동작이므로 스코프 검사 없이 canonicalize만 한다 (D1).
    // workspace_root 인자는 하위 호환용으로 받되 사용하지 않는다.
    let _ = workspace_root;
    let verified = resolve_user_path(&path, true)?;

    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(format!("/select,{}", verified.display()))
            .spawn()
            .map_err(|e| format!("Failed to launch explorer: {}", e))?;
    }

    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .args(["-R", &verified.to_string_lossy()])
            .spawn()
            .map_err(|e| format!("Failed to launch Finder: {}", e))?;
    }

    #[cfg(target_os = "linux")]
    {
        let target = if verified.is_dir() {
            verified.clone()
        } else {
            verified.parent().unwrap_or(&verified).to_path_buf()
        };
        std::process::Command::new("xdg-open")
            .arg(target)
            .spawn()
            .map_err(|e| format!("Failed to launch file manager: {}", e))?;
    }

    Ok(())
}

#[derive(Debug, Serialize, Deserialize)]
pub struct WorkFolderLayout {
    pub work_folder: String,
    pub wiki_dir: String,
    pub inbox_dir: String,
    pub backup_dir: String,
    pub config_dir: String,
    pub skills_dir: String,
}

/// 작업 폴더 하위 레이아웃 생성 (D2, P11-04): wiki/·wiki-inbox/·backup/·config/·skills/.
#[tauri::command]
pub fn ensure_work_folder_layout(work_folder: String) -> Result<WorkFolderLayout, String> {
    let root = Path::new(&work_folder);
    if !root.is_dir() {
        return Err(format!("Work folder is not a valid directory: {}", work_folder));
    }
    let canonical = root
        .canonicalize()
        .map_err(|e| format!("Work folder '{}' error: {}", work_folder, e))?;
    let sub = |name: &str| -> Result<String, String> {
        let dir = canonical.join(name);
        std::fs::create_dir_all(&dir)
            .map_err(|e| format!("Failed to create {} dir: {}", name, e))?;
        Ok(dir.to_string_lossy().into_owned())
    };
    Ok(WorkFolderLayout {
        work_folder: canonical.to_string_lossy().into_owned(),
        wiki_dir: sub("wiki")?,
        inbox_dir: sub("wiki-inbox")?,
        backup_dir: sub("backup")?,
        config_dir: sub("config")?,
        skills_dir: sub("skills")?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::fs_commands::scope_test_lock;

    fn unique_base(tag: &str) -> PathBuf {
        let stamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        std::env::temp_dir().join(format!("vc-fs-scope-test-{}-{}-{}", tag, std::process::id(), stamp))
    }

    #[test]
    fn test_allowed_roots_verify() {
        let _guard = scope_test_lock();
        let base = unique_base("roots");
        let allowed = base.join("allowed");
        let outside = base.join("outside");
        std::fs::create_dir_all(&allowed).unwrap();
        std::fs::create_dir_all(&outside).unwrap();

        set_allowed_roots_internal(vec![allowed.to_string_lossy().into_owned()]);
        let file = allowed.join("a.txt");
        std::fs::write(&file, "x").unwrap();
        // 허용 루트 안: 명시 루트와 무관하게 통과
        assert!(resolve_and_verify_workspace_path(&file.to_string_lossy(), None, true).is_ok());
        assert!(resolve_and_verify_workspace_path(
            &file.to_string_lossy(),
            Some(&allowed.to_string_lossy()),
            true
        )
        .is_ok());
        // 허용 루트 밖: 거부
        assert!(resolve_and_verify_workspace_path(&outside.to_string_lossy(), None, true).is_err());
        // 명시 루트 자체가 허용 밖이면 루트 지정 우회 불가
        assert!(resolve_and_verify_workspace_path(
            &file.to_string_lossy(),
            Some(&outside.to_string_lossy()),
            true
        )
        .is_err());

        set_allowed_roots_internal(Vec::new());
        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn test_user_path_no_scope_check() {
        let _guard = scope_test_lock();
        let base = unique_base("user");
        std::fs::create_dir_all(&base).unwrap();
        set_allowed_roots_internal(vec![base.join("elsewhere").to_string_lossy().into_owned()]);
        // 스코프 밖이어도 실존 경로면 통과
        assert!(resolve_user_path(&base.to_string_lossy(), true).is_ok());
        // 미존재 + traversal은 거부
        assert!(resolve_user_path("nope/../evil", false).is_err());
        set_allowed_roots_internal(Vec::new());
        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn test_work_folder_layout() {
        let base = unique_base("layout");
        std::fs::create_dir_all(&base).unwrap();
        let layout = ensure_work_folder_layout(base.to_string_lossy().into_owned()).unwrap();
        for dir in [
            &layout.wiki_dir,
            &layout.inbox_dir,
            &layout.backup_dir,
            &layout.config_dir,
            &layout.skills_dir,
        ] {
            assert!(Path::new(dir).is_dir(), "missing {}", dir);
        }
        // 존재하지 않는 폴더는 거부
        assert!(ensure_work_folder_layout(base.join("nope").to_string_lossy().into_owned()).is_err());
        let _ = std::fs::remove_dir_all(&base);
    }
}

