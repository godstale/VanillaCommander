pub mod commands;

use commands::fs_commands::*;
use commands::commander_commands::*;
use commands::watch_commands::*;
use commands::integration_commands::*;
use commands::search_commands::*;
use commands::shell_commands::*;
use commands::web_commands::*;
use commands::system_commands::*;
use commands::llm_commands::*;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_sql::Builder::default().build())
        .plugin(
            tauri_plugin_log::Builder::default()
                .targets([
                    tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::Stdout),
                    tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::LogDir {
                        file_name: Some("vanilla-commander".into()),
                    }),
                    tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::Webview),
                ])
                .level(log::LevelFilter::Info)
                .max_file_size(10_000_000) // 10 MB limit per log file
                .rotation_strategy(tauri_plugin_log::RotationStrategy::KeepSome(5)) // Keep at most 5 rotated log files
                .build(),
        )
        .setup(|app| {
            use tauri::Manager;
            // tauri-plugin-sql은 app_config_dir 기준으로 DB를 연다 — 첫 Database.load 전에 구 파일명을 옮긴다.
            if let Ok(dir) = app.path().app_config_dir() {
                rename_legacy_db_files(&dir);
            }
            for window in app.webview_windows().values() {
                let _ = window.set_theme(Some(tauri::Theme::Light));
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            pick_project_folder,
            set_agent_allowed_roots,
            ensure_work_folder_layout,
            ensure_app_data_dir,
            get_app_paths,
            read_project_folder_tree,
            read_text_file,
            write_text_file,
            create_file,
            create_folder,
            rename_path,
            delete_path,
            list_dir,
            copy_path,
            reveal_in_explorer,
            grep_files,
            find_files,
            run_shell,
            web_search,
            web_fetch,
            open_in_browser,
            get_system_gpu_info,
            llm_http_get,
            llm_http_post_text,
            llm_http_post_stream,
            integration_run_cli,
            find_executable,
            fc_list_dir,
            fc_system_folders,
            fc_stat,
            fc_copy,
            fc_move,
            fc_cancel,
            fc_resolve_conflict,
            fc_trash,
            fc_delete_permanent,
            fc_rename,
            fc_mkdir,
            fc_create_file,
            fc_search,
            fc_zip,
            fc_unzip,
            fc_archive_list,
            fc_open_default,
            fc_reveal,
            fc_open_terminal,
            fc_read_file_bytes,
            fc_read_text_head,
            fc_write_bytes,
            fc_office_text,
            wiki_watch_set,
            wiki_watch_stop,
            wiki_watch_status,
            wiki_scan_folders,
            wiki_file_hash,
            wiki_default_watch_folder,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
