mod categorize;
mod commands;
mod error;
mod models;
mod pdf;
mod repo;
mod state;
mod vault;

use state::AppState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .manage(AppState::new())
        .invoke_handler(tauri::generate_handler![
            commands::vault_create,
            commands::vault_open,
            commands::vault_lock,
            commands::vault_status,
            commands::vault_recent,
            commands::cards_list,
            commands::cards_create,
            commands::cards_update,
            commands::cards_remove,
            commands::categories_list,
            commands::categories_create,
            commands::categories_update,
            commands::categories_remove,
            commands::transactions_list,
            commands::transactions_create,
            commands::transactions_update,
            commands::transactions_remove,
            commands::transactions_bulk_update,
            commands::transactions_bulk_remove,
            commands::transactions_month_summary,
            commands::import_extract_pdf,
            commands::import_parse,
            commands::import_commit,
            commands::vault_backup_now,
            commands::export_csv,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
