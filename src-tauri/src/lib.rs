pub mod commands;

use commands::fs_commands::*;
use commands::integration_commands::*;
use commands::search_commands::*;
use commands::shell_commands::*;
use commands::web_commands::*;
use commands::system_commands::*;
use commands::llm_commands::*;
use commands::eval_commands::*;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_sql::Builder::default().build())
        .plugin(
            tauri_plugin_log::Builder::default()
                .targets([
                    tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::Stdout),
                    tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::LogDir {
                        file_name: Some("fortress".into()),
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
            for window in app.webview_windows().values() {
                let _ = window.set_theme(Some(tauri::Theme::Light));
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            pick_project_folder,
            set_active_workspace,
            ensure_fortress_dir,
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
            eval_list_packs,
            eval_read_pack_file,
            eval_write_pack_files,
            eval_delete_pack,
            eval_append_run_log,
            eval_read_run_log,
            eval_sandbox_create,
            eval_sandbox_create_from_files,
            eval_sandbox_snapshot,
            eval_sandbox_destroy,
            eval_sandbox_cleanup_all,
            eval_detect_runtimes,
            eval_run_python,
            eval_download_file,
            eval_export_write,
            eval_read_import_file,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
