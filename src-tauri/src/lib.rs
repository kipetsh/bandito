mod ota;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .register_uri_scheme_protocol("bandito", |context, request| {
            ota::serve_frontend(context.app_handle(), request.uri().path())
        })
        .invoke_handler(tauri::generate_handler![
            ota::ota_prepare_launch,
            ota::ota_mark_boot_success,
            ota::ota_check_and_install,
            ota::ota_restart_app
        ])
        .run(tauri::generate_context!())
        .expect("error while running Bandito");
}
