use std::process::{Command, Stdio};
use std::sync::mpsc;
use std::time::Duration;
use serde::{Deserialize, Serialize};
use crate::commands::fs_commands::resolve_and_verify_workspace_path;

#[derive(Debug, Serialize, Deserialize)]
pub struct ShellOutput {
    pub stdout: String,
    pub stderr: String,
    pub exit_code: i32,
}

#[tauri::command]
pub async fn run_shell(
    command: String,
    cwd: Option<String>,
    timeout_ms: Option<u64>,
    workspace_root: Option<String>,
) -> Result<ShellOutput, String> {
    let target_cwd = cwd.unwrap_or_else(|| ".".to_string());
    let verified_cwd = resolve_and_verify_workspace_path(&target_cwd, workspace_root.as_deref(), true)?;

    let timeout_duration = Duration::from_millis(timeout_ms.unwrap_or(120_000));

    tauri::async_runtime::spawn_blocking(move || {
        let mut cmd = if cfg!(target_os = "windows") {
            let mut c = Command::new("powershell");
            c.args(["-NoProfile", "-NonInteractive", "-Command", &command]);
            c
        } else {
            let mut c = Command::new("sh");
            c.args(["-c", &command]);
            c
        };

        cmd.current_dir(&verified_cwd)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        let child = cmd
            .spawn()
            .map_err(|e| format!("Failed to start shell command: {}", e))?;

        let (tx, rx) = mpsc::channel();

        // Spawn a thread to wait for child
        let child_id = child.id();
        let _ = child_id;

        std::thread::spawn(move || {
            let res = child.wait_with_output();
            let _ = tx.send(res);
        });

        match rx.recv_timeout(timeout_duration) {
            Ok(output_res) => {
                let output = output_res.map_err(|e| format!("Command execution failed: {}", e))?;
                let stdout = String::from_utf8_lossy(&output.stdout).to_string();
                let stderr = String::from_utf8_lossy(&output.stderr).to_string();
                let exit_code = output.status.code().unwrap_or(-1);
                Ok(ShellOutput {
                    stdout,
                    stderr,
                    exit_code,
                })
            }
            Err(mpsc::RecvTimeoutError::Timeout) => {
                // Timeout exceeded
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
                Err(format!(
                    "Command timed out after {} seconds and was terminated",
                    timeout_duration.as_secs()
                ))
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => {
                Err("Command worker thread terminated unexpectedly".to_string())
            }
        }
    })
    .await
    .map_err(|e| format!("Async execution error: {}", e))?
}
