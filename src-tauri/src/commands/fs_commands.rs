use std::path::{Path, PathBuf};
use std::sync::RwLock;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Runtime};
use tauri_plugin_dialog::DialogExt;

static ACTIVE_WORKSPACE: RwLock<Option<String>> = RwLock::new(None);

pub fn set_active_workspace_internal(path: Option<String>) {
    if let Some(ref p) = path {
        let _ = std::env::set_current_dir(Path::new(p));
    }
    if let Ok(mut lock) = ACTIVE_WORKSPACE.write() {
        *lock = path;
    }
}

pub fn get_active_workspace_internal() -> Option<String> {
    ACTIVE_WORKSPACE.read().ok().and_then(|lock| lock.clone())
}

#[tauri::command]
pub fn set_active_workspace(path: Option<String>) -> Result<(), String> {
    set_active_workspace_internal(path.clone());
    if let Some(ref p) = path {
        let _ = ensure_fortress_dir(p.clone());
    }
    Ok(())
}

#[tauri::command]
pub fn ensure_fortress_dir(workspace_root: String) -> Result<String, String> {
    let ws_path = Path::new(&workspace_root);
    if !ws_path.is_dir() {
        return Err(format!("Workspace root is not a valid directory: {}", workspace_root));
    }
    let fortress_dir = ws_path.join(".fortress");
    if !fortress_dir.exists() {
        std::fs::create_dir_all(&fortress_dir).map_err(|e| format!("Failed to create .fortress dir: {}", e))?;
    }
    let gitignore_path = fortress_dir.join(".gitignore");
    if !gitignore_path.exists() {
        let _ = std::fs::write(&gitignore_path, "*.db\n*.db-*\nlogs/\n");
    }
    let logs_dir = fortress_dir.join("logs");
    if !logs_dir.exists() {
        let _ = std::fs::create_dir_all(&logs_dir);
    }
    Ok(fortress_dir.to_string_lossy().to_string())
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
    let current_ws = get_active_workspace_internal();

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
        .or_else(get_active_workspace_internal)
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

pub fn resolve_and_verify_workspace_path(
    path_str: &str,
    workspace_root: Option<&str>,
    must_exist: bool,
) -> Result<PathBuf, String> {
    let active_ws = get_active_workspace_internal();
    let ws_opt = workspace_root.or(active_ws.as_deref());
    let resolved = resolve_path(path_str, ws_opt);

    if let Some(ws) = ws_opt {
        if !ws.trim().is_empty() {
            let ws_canonical = Path::new(ws)
                .canonicalize()
                .map_err(|e| format!("Workspace '{}' error: {}", ws, e))?;

            if must_exist {
                let canonical = resolved
                    .canonicalize()
                    .map_err(|e| format!("Path '{}' error: {}", resolved.display(), e))?;
                if !canonical.starts_with(&ws_canonical) {
                    return Err(format!(
                        "Access denied: path '{}' is outside workspace '{}'",
                        resolved.display(),
                        ws
                    ));
                }
                return Ok(canonical);
            } else {
                if resolved.exists() {
                    let canonical = resolved
                        .canonicalize()
                        .map_err(|e| format!("Path '{}' error: {}", resolved.display(), e))?;
                    if !canonical.starts_with(&ws_canonical) {
                        return Err(format!(
                            "Access denied: path '{}' is outside workspace '{}'",
                            resolved.display(),
                            ws
                        ));
                    }
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

                let base = existing_ancestor_canonical.unwrap_or_else(|| ws_canonical.clone());
                if !base.starts_with(&ws_canonical) {
                    return Err(format!(
                        "Access denied: path '{}' is outside workspace '{}'",
                        resolved.display(),
                        ws
                    ));
                }

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
                return Ok(full_path);
            }
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

    if let Some(ref path) = picked_opt {
        set_active_workspace_internal(Some(path.clone()));
    }

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
    let verified = resolve_and_verify_workspace_path(&path, workspace_root.as_deref(), true)?;

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

