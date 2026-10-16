fn main() {
    println!(
        "cargo:rustc-env=AGENT_BAY_TARGET={}",
        std::env::var("TARGET").expect("Rust target")
    );
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "pick_target_path",
            "save_export",
            "save_video",
            "desktop_status",
            "desktop_preferences",
            "set_window_style",
        ]),
    ))
    .expect("prepare Agent Bay desktop build");
}
