use serde::{Deserialize, Serialize};
use crate::commands::fs_commands::resolve_and_verify_workspace_path;

#[derive(Debug, Serialize, Deserialize)]
pub struct GrepMatch {
    pub file_path: String,
    pub line_number: usize,
    pub line_content: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct FindMatch {
    pub path: String,
    pub is_dir: bool,
}

#[tauri::command]
pub fn grep_files(
    pattern: String,
    path: String,
    glob: Option<String>,
    max_results: Option<usize>,
    workspace_root: Option<String>,
) -> Result<Vec<GrepMatch>, String> {
    let verified = resolve_and_verify_workspace_path(&path, workspace_root.as_deref(), true)?;

    let max_limit = max_results.unwrap_or(100);
    let re = regex::Regex::new(&pattern).map_err(|e| format!("Invalid regex pattern '{}': {}", pattern, e))?;

    let mut builder = ignore::WalkBuilder::new(&verified);
    builder.hidden(false); // Don't skip hidden unless gitignored

    if let Some(ref g) = glob {
        if !g.trim().is_empty() {
            let mut overrides = ignore::overrides::OverrideBuilder::new(&verified);
            overrides.add(g).map_err(|e| format!("Invalid glob override '{}': {}", g, e))?;
            builder.overrides(overrides.build().map_err(|e| e.to_string())?);
        }
    }

    let mut results = Vec::new();

    for result in builder.build() {
        if results.len() >= max_limit {
            break;
        }

        let entry = match result {
            Ok(e) => e,
            Err(_) => continue,
        };

        let file_type = match entry.file_type() {
            Some(ft) if ft.is_file() => ft,
            _ => continue,
        };
        let _ = file_type;

        let entry_path = entry.path();
        // Skip binary or unreadable files gracefully
        let content = match std::fs::read_to_string(entry_path) {
            Ok(c) => c,
            Err(_) => continue,
        };

        for (idx, line) in content.lines().enumerate() {
            if re.is_match(line) {
                let truncated_line: String = if line.chars().count() > 500 {
                    line.chars().take(500).collect()
                } else {
                    line.to_string()
                };

                results.push(GrepMatch {
                    file_path: entry_path.to_string_lossy().to_string(),
                    line_number: idx + 1,
                    line_content: truncated_line,
                });

                if results.len() >= max_limit {
                    break;
                }
            }
        }
    }

    Ok(results)
}

#[tauri::command]
pub fn find_files(
    pattern: String,
    path: String,
    max_results: Option<usize>,
    workspace_root: Option<String>,
) -> Result<Vec<FindMatch>, String> {
    let verified = resolve_and_verify_workspace_path(&path, workspace_root.as_deref(), true)?;

    let max_limit = max_results.unwrap_or(100);

    let glob = globset::GlobBuilder::new(&pattern)
        .case_insensitive(true)
        .build()
        .map_err(|e| format!("Invalid glob pattern '{}': {}", pattern, e))?
        .compile_matcher();

    let mut builder = ignore::WalkBuilder::new(&verified);
    builder.hidden(false);

    let mut results = Vec::new();

    for result in builder.build() {
        if results.len() >= max_limit {
            break;
        }

        let entry = match result {
            Ok(e) => e,
            Err(_) => continue,
        };

        let entry_path = entry.path();
        let file_name = entry.file_name();

        if glob.is_match(file_name) || glob.is_match(entry_path) {
            let is_dir = entry.file_type().map(|ft| ft.is_dir()).unwrap_or(false);
            results.push(FindMatch {
                path: entry_path.to_string_lossy().to_string(),
                is_dir,
            });
        }
    }

    Ok(results)
}
