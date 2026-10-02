//! 외부 에이전트 CLI 실행 (외부 연동용).
//!
//! - 셸을 거치지 않고 `Command::new`로 직접 실행한다.
//! - 실행 파일은 절대 경로·존재 필수.
//! - cwd 미지정 시 매번 새로 만드는 임시 디렉터리에서 실행한다.
//! - cwd 지정 시 활성 워크스페이스 안의 실존 디렉터리여야 한다 (D3, P11-02).
//!   허용 루트 목록 검사는 P11-04(`set_agent_allowed_roots`)에서 일반화한다.

use super::fs_commands::resolve_and_verify_workspace_path;
use serde::{Deserialize, Serialize};
use std::io::Write;
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::mpsc;
use std::time::Duration;

const PROMPT_FILE_TOKEN: &str = "{promptFile}";
const OUTPUT_CAP_BYTES: usize = 2 * 1024 * 1024;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CliRunOutput {
    pub exit_code: i32,
    pub stdout: String,
    pub stderr: String,
    pub timed_out: bool,
}

pub fn validate_executable(executable_path: &str) -> Result<PathBuf, String> {
    let path = PathBuf::from(executable_path);
    if !path.is_absolute() {
        return Err(format!(
            "INTEGRATION_CLI executable must be an absolute path: {}",
            executable_path
        ));
    }
    if !path.is_file() {
        return Err(format!(
            "INTEGRATION_CLI executable not found: {}",
            executable_path
        ));
    }
    Ok(path)
}

fn fresh_work_dir() -> Result<PathBuf, String> {
    let dir = std::env::temp_dir().join(format!(
        "vanilla-commander-cli-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0)
    ));
    std::fs::create_dir_all(&dir)
        .map_err(|e| format!("INTEGRATION_CLI failed to create temp dir: {}", e))?;
    Ok(dir)
}

/// `{promptFile}` 토큰이 있으면 프롬프트 파일 내용을 임시 파일에 쓰고
/// 인자를 치환한다. 토큰이 있는데 내용이 없으면 에러.
pub fn prepare_work_dir(
    args: &[String],
    prompt_file_text: Option<&str>,
) -> Result<(PathBuf, Vec<String>), String> {
    let needs_file = args.iter().any(|a| a.contains(PROMPT_FILE_TOKEN));
    let dir = fresh_work_dir()?;
    let mut resolved = args.to_vec();
    if needs_file {
        let text = prompt_file_text.unwrap_or("");
        if text.is_empty() {
            cleanup_work_dir(&dir);
            return Err("INTEGRATION_CLI args contain {promptFile} but no prompt text was provided".to_string());
        }
        let prompt_path = dir.join("prompt.txt");
        std::fs::write(&prompt_path, text)
            .map_err(|e| format!("INTEGRATION_CLI failed to write prompt file: {}", e))?;
        let replacement = prompt_path.to_string_lossy().into_owned();
        for arg in resolved.iter_mut() {
            if arg.contains(PROMPT_FILE_TOKEN) {
                *arg = arg.replace(PROMPT_FILE_TOKEN, &replacement);
            }
        }
    }
    Ok((dir, resolved))
}

fn cleanup_work_dir(dir: &std::path::Path) {
    let _ = std::fs::remove_dir_all(dir);
}

fn cap_output(text: String) -> String {
    if text.len() <= OUTPUT_CAP_BYTES {
        return text;
    }
    let mut end = OUTPUT_CAP_BYTES;
    while !text.is_char_boundary(end) {
        end -= 1;
    }
    format!("{}…[truncated at 2MB]", &text[..end])
}

/// CLI 실행 디렉터리 결정. cwd 지정 시 워크스페이스 containment 검사 후
/// 사용하고, 미지정이면 프롬프트용 임시 디렉터리에서 실행한다.
pub fn resolve_cwd_for_cli(cwd: &Option<String>, fallback: &PathBuf) -> Result<PathBuf, String> {
    match cwd {
        Some(dir) if !dir.trim().is_empty() => resolve_and_verify_workspace_path(dir, None, true)
            .map_err(|e| format!("INTEGRATION_CLI invalid cwd: {}", e)),
        _ => Ok(fallback.clone()),
    }
}

#[tauri::command]
pub async fn integration_run_cli(
    executable_path: String,
    args: Vec<String>,
    stdin_text: Option<String>,
    prompt_file_text: Option<String>,
    timeout_ms: Option<u64>,
    cwd: Option<String>,
) -> Result<CliRunOutput, String> {
    let exe = validate_executable(&executable_path)?;
    let (work_dir, resolved_args) = prepare_work_dir(&args, prompt_file_text.as_deref())?;
    let run_dir = resolve_cwd_for_cli(&cwd, &work_dir)?;
    let timeout_duration = Duration::from_millis(timeout_ms.unwrap_or(180_000).max(1));

    let work_dir_for_cmd = run_dir.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        let mut cmd = Command::new(&exe);
        cmd.args(&resolved_args)
            .current_dir(&work_dir_for_cmd)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        if stdin_text.is_some() {
            cmd.stdin(Stdio::piped());
        } else {
            cmd.stdin(Stdio::null());
        }

        let mut child = cmd
            .spawn()
            .map_err(|e| format!("INTEGRATION_CLI failed to start: {}", e))?;
        let child_id = child.id();

        if let Some(input) = stdin_text {
            if let Some(mut stdin) = child.stdin.take() {
                let _ = stdin.write_all(input.as_bytes());
            }
        }

        let (tx, rx) = mpsc::channel();
        std::thread::spawn(move || {
            let res = child.wait_with_output();
            let _ = tx.send(res);
        });

        match rx.recv_timeout(timeout_duration) {
            Ok(output_res) => {
                let output =
                    output_res.map_err(|e| format!("INTEGRATION_CLI execution failed: {}", e))?;
                Ok::<CliRunOutput, String>(CliRunOutput {
                    exit_code: output.status.code().unwrap_or(-1),
                    stdout: cap_output(String::from_utf8_lossy(&output.stdout).into_owned()),
                    stderr: cap_output(String::from_utf8_lossy(&output.stderr).into_owned()),
                    timed_out: false,
                })
            }
            Err(mpsc::RecvTimeoutError::Timeout) => {
                #[cfg(target_os = "windows")]
                {
                    let _ = Command::new("taskkill")
                        .args(["/F", "/T", "/PID", &child_id.to_string()])
                        .output();
                }
                #[cfg(not(target_os = "windows"))]
                {
                    let _ = Command::new("kill")
                        .args(["-9", &child_id.to_string()])
                        .output();
                }
                Ok(CliRunOutput {
                    exit_code: -1,
                    stdout: String::new(),
                    stderr: format!(
                        "INTEGRATION_CLI timed out after {}ms and was terminated",
                        timeout_duration.as_millis()
                    ),
                    timed_out: true,
                })
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => {
                Err("INTEGRATION_CLI worker thread terminated unexpectedly".to_string())
            }
        }
    })
    .await
    .map_err(|e| format!("INTEGRATION_CLI async execution error: {}", e))?;

    cleanup_work_dir(&work_dir);
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_relative_path_rejected() {
        assert!(validate_executable("agent-cli").is_err());
        assert!(validate_executable("relative/dir/agent").is_err());
    }

    #[test]
    fn test_missing_absolute_path_rejected() {
        #[cfg(target_os = "windows")]
        let missing = "C:\\definitely\\not\\here\\vanilla-commander-test-binary.exe";
        #[cfg(not(target_os = "windows"))]
        let missing = "/definitely/not/here/vanilla-commander-test-binary";
        assert!(validate_executable(missing).is_err());
    }

    #[test]
    fn test_prompt_token_without_text_rejected() {
        let args = vec!["run".to_string(), "{promptFile}".to_string()];
        assert!(prepare_work_dir(&args, None).is_err());
        assert!(prepare_work_dir(&args, Some("")).is_err());
    }

    #[test]
    fn test_prompt_token_replaced_with_temp_file() {
        let args = vec!["run".to_string(), "{promptFile}".to_string()];
        let (dir, resolved) = prepare_work_dir(&args, Some("hello prompt")).unwrap();
        assert_eq!(resolved[0], "run");
        assert!(resolved[1].ends_with("prompt.txt"));
        assert_ne!(resolved[1], "{promptFile}");
        assert_eq!(std::fs::read_to_string(&resolved[1]).unwrap(), "hello prompt");
        cleanup_work_dir(&dir);
        assert!(!dir.exists());
    }

    #[test]
    fn test_no_token_needs_no_file() {
        let args = vec!["--version".to_string()];
        let (dir, resolved) = prepare_work_dir(&args, None).unwrap();
        assert_eq!(resolved, args);
        assert!(dir.exists());
        cleanup_work_dir(&dir);
    }

    #[test]
    fn test_output_cap_truncates_on_char_boundary() {
        let big = "가".repeat(OUTPUT_CAP_BYTES + 100);
        let capped = cap_output(big);
        assert!(capped.len() <= OUTPUT_CAP_BYTES + 64);
        assert!(capped.contains("truncated"));
        assert_eq!(cap_output("small".to_string()), "small");
    }

    #[test]
    fn test_cwd_resolution() {
        use crate::commands::fs_commands::set_active_workspace_internal;

        let stamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        let base =
            std::env::temp_dir().join(format!("vc-cli-cwd-test-{}-{}", std::process::id(), stamp));
        let ws = base.join("ws");
        let outside = base.join("outside");
        std::fs::create_dir_all(&ws).unwrap();
        std::fs::create_dir_all(&outside).unwrap();
        let fallback = base.join("fallback");
        std::fs::create_dir_all(&fallback).unwrap();

        set_active_workspace_internal(Some(ws.to_string_lossy().into_owned()));
        let sub = ws.join("sub");
        std::fs::create_dir_all(&sub).unwrap();
        assert!(resolve_cwd_for_cli(&Some(sub.to_string_lossy().into_owned()), &fallback).is_ok());
        assert!(
            resolve_cwd_for_cli(&Some(outside.to_string_lossy().into_owned()), &fallback).is_err()
        );
        assert!(
            resolve_cwd_for_cli(&Some(base.join("nope").to_string_lossy().into_owned()), &fallback)
                .is_err()
        );
        assert_eq!(resolve_cwd_for_cli(&None, &fallback).unwrap(), fallback);

        set_active_workspace_internal(None);
        let _ = std::fs::remove_dir_all(&base);
    }
}
