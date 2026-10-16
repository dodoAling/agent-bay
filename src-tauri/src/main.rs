#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use base64::Engine;
use serde::{Deserialize, Serialize};
use std::{
    io::{BufRead, BufReader, Write},
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    thread,
    time::{Duration, Instant},
};
use tauri::{AppHandle, Manager, State, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
use tauri_plugin_dialog::DialogExt;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DesktopStatus {
    phase: String,
    backend_url: Option<String>,
    backend_pid: Option<u32>,
    desktop_pid: u32,
    error: Option<String>,
    exit_code: Option<i32>,
}

#[derive(Clone, Copy, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
enum WindowStyle {
    Windows,
    Macos,
}

#[derive(Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct DesktopPreferences {
    window_style: Option<WindowStyle>,
}

struct Runtime {
    child: Mutex<Option<Child>>,
    status: Mutex<DesktopStatus>,
    closing: AtomicBool,
}

// Node's CLI main-script resolver rejects Windows verbatim drive paths even
// though Rust and CreateProcess accept them. Preserve UNC and unusual paths
// through dunce's conservative simplification instead of string replacement.
fn process_path(path: PathBuf) -> PathBuf {
    dunce::simplified(&path).to_path_buf()
}

impl Runtime {
    fn new() -> Self {
        Self {
            child: Mutex::new(None),
            status: Mutex::new(DesktopStatus {
                phase: "starting".into(),
                backend_url: None,
                backend_pid: None,
                desktop_pid: std::process::id(),
                error: None,
                exit_code: None,
            }),
            closing: AtomicBool::new(false),
        }
    }
}

fn status(runtime: &Runtime) -> Result<DesktopStatus, String> {
    runtime
        .status
        .lock()
        .map(|value| value.clone())
        .map_err(|_| "Runtime state is unavailable.".into())
}

fn owned_window(window: &WebviewWindow, runtime: &Runtime) -> Result<(), String> {
    let backend = status(runtime)?
        .backend_url
        .ok_or("The local runtime is not ready.")?;
    let expected = tauri::Url::parse(&backend).map_err(|error| error.to_string())?;
    let actual = window.url().map_err(|error| error.to_string())?;
    if window.label() != "main" || actual.origin() != expected.origin() {
        return Err("Native actions are limited to the local workspace.".into());
    }
    Ok(())
}

#[tauri::command]
fn desktop_status(runtime: State<'_, Arc<Runtime>>) -> Result<DesktopStatus, String> {
    status(&runtime)
}

#[tauri::command]
fn desktop_preferences(
    app: AppHandle,
    window: WebviewWindow,
    runtime: State<'_, Arc<Runtime>>,
) -> Result<DesktopPreferences, String> {
    owned_window(&window, &runtime)?;
    let path = app
        .path()
        .app_config_dir()
        .map_err(|error| error.to_string())?
        .join("preferences.json");
    match std::fs::read_to_string(path) {
        Ok(json) => serde_json::from_str(&json)
            .map_err(|error| format!("Could not read desktop preferences: {error}")),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            Ok(DesktopPreferences::default())
        }
        Err(error) => Err(format!("Could not read desktop preferences: {error}")),
    }
}

#[tauri::command]
fn set_window_style(
    app: AppHandle,
    window: WebviewWindow,
    runtime: State<'_, Arc<Runtime>>,
    style: WindowStyle,
) -> Result<(), String> {
    owned_window(&window, &runtime)?;
    let directory = app
        .path()
        .app_config_dir()
        .map_err(|error| error.to_string())?;
    std::fs::create_dir_all(&directory)
        .map_err(|error| format!("Could not create desktop preference directory: {error}"))?;
    let json = serde_json::to_string_pretty(&DesktopPreferences {
        window_style: Some(style),
    })
    .map_err(|error| error.to_string())?;
    let temporary = directory.join(format!("preferences.{}.tmp", std::process::id()));
    let destination = directory.join("preferences.json");
    std::fs::write(&temporary, json)
        .map_err(|error| format!("Could not write desktop preferences: {error}"))?;
    std::fs::rename(&temporary, &destination)
        .map_err(|error| format!("Could not save desktop preferences: {error}"))
}

#[tauri::command]
async fn pick_target_path(
    app: AppHandle,
    window: WebviewWindow,
    runtime: State<'_, Arc<Runtime>>,
    directory: Option<bool>,
) -> Result<Option<String>, String> {
    owned_window(&window, &runtime)?;
    tauri::async_runtime::spawn_blocking(move || {
        let dialog = app
            .dialog()
            .file()
            .set_parent(&window)
            .set_title("Select an analysis target");
        let selection = if directory.unwrap_or(false) {
            dialog.blocking_pick_folder()
        } else {
            dialog.blocking_pick_file()
        };
        selection
            .map(|path| {
                path.into_path()
                    .map(|value| process_path(value).to_string_lossy().into_owned())
                    .map_err(|error| error.to_string())
            })
            .transpose()
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command(rename_all = "camelCase")]
async fn save_export(
    app: AppHandle,
    window: WebviewWindow,
    runtime: State<'_, Arc<Runtime>>,
    data: String,
    default_name: String,
) -> Result<Option<String>, String> {
    owned_window(&window, &runtime)?;
    if data.len() > 32 * 1024 * 1024 {
        return Err("Export exceeds the 32 MiB desktop limit.".into());
    }
    serde_json::from_str::<serde_json::Value>(&data)
        .map_err(|_| "Export must contain valid JSON.".to_string())?;
    let filename = Path::new(&default_name)
        .file_name()
        .and_then(|name| name.to_str())
        .filter(|name| name.len() <= 100)
        .unwrap_or("agent-bay-session.json")
        .to_string();
    tauri::async_runtime::spawn_blocking(move || {
        let Some(selection) = app
            .dialog()
            .file()
            .set_parent(&window)
            .set_title("Export session")
            .set_file_name(&filename)
            .add_filter("JSON", &["json"])
            .blocking_save_file()
        else {
            return Ok(None);
        };
        let path = process_path(selection.into_path().map_err(|error| error.to_string())?);
        std::fs::write(&path, data.as_bytes())
            .map_err(|error| format!("Could not save export: {error}"))?;
        Ok(Some(path.to_string_lossy().into_owned()))
    })
    .await
    .map_err(|error| error.to_string())?
}

fn decode_video(encoded: &str) -> Result<(Vec<u8>, &'static str), String> {
    const LIMIT: usize = 200 * 1024 * 1024;
    if encoded.len() > (LIMIT + 2) / 3 * 4 {
        return Err("Video exceeds the 200 MiB desktop limit.".into());
    }
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(encoded)
        .map_err(|_| "Video data is not valid base64.".to_string())?;
    if bytes.len() > LIMIT {
        return Err("Video exceeds the 200 MiB desktop limit.".into());
    }
    let extension = if bytes.len() >= 12 && &bytes[4..8] == b"ftyp" {
        "mp4"
    } else if bytes.starts_with(&[0x1a, 0x45, 0xdf, 0xa3]) {
        "webm"
    } else {
        return Err("Only MP4 or WebM videos can be saved.".into());
    };
    Ok((bytes, extension))
}

#[tauri::command(rename_all = "camelCase")]
async fn save_video(
    app: AppHandle,
    window: WebviewWindow,
    runtime: State<'_, Arc<Runtime>>,
    base64: String,
    default_name: String,
) -> Result<Option<String>, String> {
    owned_window(&window, &runtime)?;
    let (bytes, extension) = decode_video(&base64)?;
    let stem = Path::new(&default_name)
        .file_stem()
        .and_then(|name| name.to_str())
        .filter(|name| name.len() <= 100)
        .unwrap_or("agent-bay-demo");
    let filename = format!("{stem}.{extension}");
    tauri::async_runtime::spawn_blocking(move || {
        let Some(selection) = app
            .dialog()
            .file()
            .set_parent(&window)
            .set_title("Save demo video")
            .set_file_name(&filename)
            .add_filter("Video", &[extension])
            .blocking_save_file()
        else {
            return Ok(None);
        };
        let path = process_path(selection.into_path().map_err(|error| error.to_string())?);
        std::fs::write(&path, bytes).map_err(|error| format!("Could not save video: {error}"))?;
        Ok(Some(path.to_string_lossy().into_owned()))
    })
    .await
    .map_err(|error| error.to_string())?
}

fn bootstrap_path(app: &AppHandle) -> Result<PathBuf, String> {
    let bundled = app
        .path()
        .resource_dir()
        .map_err(|error| error.to_string())?
        .join("resources/server/bootstrap.mjs");
    if bundled.is_file() {
        return Ok(process_path(bundled));
    }
    #[cfg(debug_assertions)]
    {
        let source = Path::new(env!("CARGO_MANIFEST_DIR")).join("resources/server/bootstrap.mjs");
        if source.is_file() {
            return Ok(process_path(source));
        }
    }
    Err(format!(
        "Bundled backend not found: {}. Run npm run desktop:prepare before building.",
        bundled.display()
    ))
}

fn sidecar_path() -> Result<PathBuf, String> {
    let executable = std::env::current_exe().map_err(|error| error.to_string())?;
    let directory = executable
        .parent()
        .ok_or("Desktop executable directory is unavailable.")?;
    let filename = if cfg!(windows) {
        "agent-bay-node.exe"
    } else {
        "agent-bay-node"
    };
    let bundled = directory.join(filename);
    if bundled.is_file() {
        return Ok(process_path(bundled));
    }
    #[cfg(debug_assertions)]
    {
        let suffix = if cfg!(windows) { ".exe" } else { "" };
        let host = env!("AGENT_BAY_TARGET");
        let source = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("binaries")
            .join(format!("agent-bay-node-{host}{suffix}"));
        if source.is_file() {
            return Ok(process_path(source));
        }
    }
    Err(format!(
        "Bundled Node runtime not found: {}.",
        bundled.display()
    ))
}

#[cfg(test)]
mod tests {
    use super::{decode_video, process_path, DesktopPreferences, WindowStyle};
    use std::path::PathBuf;

    #[test]
    #[cfg(windows)]
    fn node_cli_paths_remove_safe_verbatim_prefixes_and_preserve_unc() {
        assert_eq!(
            process_path(PathBuf::from(r"\\?\D:\Agent Bay\bootstrap.mjs")),
            PathBuf::from(r"D:\Agent Bay\bootstrap.mjs")
        );
        assert_eq!(
            process_path(PathBuf::from(r"\\?\UNC\server\share\bootstrap.mjs")),
            PathBuf::from(r"\\?\UNC\server\share\bootstrap.mjs")
        );
        assert_eq!(
            process_path(PathBuf::from(r"D:\Agent Bay\bootstrap.mjs")),
            PathBuf::from(r"D:\Agent Bay\bootstrap.mjs")
        );
    }
    #[test]
    fn preferences_accept_only_supported_styles_and_store_no_other_state() {
        for value in ["windows", "macos"] {
            assert!(serde_json::from_str::<WindowStyle>(&format!("\"{value}\"")).is_ok());
        }
        assert!(serde_json::from_str::<WindowStyle>("\"arbitrary\"").is_err());
        assert!(serde_json::from_str::<DesktopPreferences>(
            r#"{"windowStyle":"windows","apiKey":"not-allowed"}"#
        )
        .is_err());
        assert_eq!(
            serde_json::to_value(DesktopPreferences::default()).unwrap(),
            serde_json::json!({"windowStyle": null})
        );
        assert_eq!(
            serde_json::to_value(DesktopPreferences {
                window_style: Some(WindowStyle::Macos)
            })
            .unwrap(),
            serde_json::json!({"windowStyle": "macos"})
        );
    }

    #[test]
    fn video_save_accepts_video_headers_and_rejects_other_payloads() {
        use base64::Engine;
        let encode = |bytes: &[u8]| base64::engine::general_purpose::STANDARD.encode(bytes);
        assert_eq!(
            decode_video(&encode(b"\0\0\0\x18ftypisom")).unwrap().1,
            "mp4"
        );
        assert_eq!(
            decode_video(&encode(&[0x1a, 0x45, 0xdf, 0xa3, 1, 2, 3]))
                .unwrap()
                .1,
            "webm"
        );
        assert!(decode_video(&encode(b"{\"not\":\"video\"}")).is_err());
        assert!(decode_video("not valid base64!").is_err());
    }
}

fn boot_failure(app: &AppHandle, runtime: &Runtime, message: String) {
    if let Ok(mut value) = runtime.status.lock() {
        value.phase = "failed".into();
        value.error = Some(message.clone());
    }
    eprintln!("Agent Bay desktop: {message}");
    if let Some(window) = app.get_webview_window("main") {
        let boot_url = if cfg!(windows) {
            "http://tauri.localhost/index.html"
        } else {
            "tauri://localhost/index.html"
        };
        let _ = window.navigate(tauri::Url::parse(boot_url).expect("valid local boot URL"));
    }
}

#[derive(Deserialize)]
struct Ready {
    url: String,
}

fn accept_ready(app: &AppHandle, runtime: &Runtime, line: &str) -> Result<(), String> {
    let Some(json) = line.strip_prefix("AGENT_BAY_READY ") else {
        return Ok(());
    };
    let ready: Ready = serde_json::from_str(json)
        .map_err(|error| format!("Invalid backend readiness message: {error}"))?;
    let url = tauri::Url::parse(&ready.url).map_err(|error| error.to_string())?;
    if url.scheme() != "http"
        || url.host_str() != Some("127.0.0.1")
        || url.port().unwrap_or(0) == 0
        || !url.username().is_empty()
        || url.password().is_some()
        || url.path() != "/"
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err("The backend supplied an invalid local workspace URL.".into());
    }
    if runtime.closing.load(Ordering::SeqCst) {
        return Ok(());
    }
    {
        let mut value = runtime
            .status
            .lock()
            .map_err(|_| "Runtime state is unavailable.")?;
        if value.phase != "starting" {
            return Ok(());
        }
        value.phase = "ready".into();
        value.backend_url = Some(url.to_string());
        println!(
            "AGENT_BAY_DESKTOP_READY {}",
            serde_json::to_string(&*value).unwrap_or_default()
        );
    }
    app.get_webview_window("main")
        .ok_or("The workspace window is unavailable.")?
        .navigate(url)
        .map_err(|error| error.to_string())
}

fn start_backend(app: AppHandle, runtime: Arc<Runtime>) -> Result<(), String> {
    let bootstrap = bootstrap_path(&app)?;
    let node = sidecar_path()?;
    let mut command = Command::new(&node);
    command
        .arg(&bootstrap)
        .env("PORT", "0")
        .env("AGENT_BAY_DESKTOP", "1")
        .env("AGENT_BAY_PARENT_PID", std::process::id().to_string())
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    command.current_dir(
        bootstrap
            .parent()
            .ok_or("Backend directory is unavailable.")?,
    );
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    let mut child = command
        .spawn()
        .map_err(|error| format!("Could not start the bundled Node runtime: {error}"))?;
    let stdout = child
        .stdout
        .take()
        .ok_or("Backend output is unavailable.")?;
    let stderr = child
        .stderr
        .take()
        .ok_or("Backend error output is unavailable.")?;
    runtime
        .status
        .lock()
        .map_err(|_| "Runtime state is unavailable.")?
        .backend_pid = Some(child.id());
    *runtime
        .child
        .lock()
        .map_err(|_| "Runtime process state is unavailable.")? = Some(child);
    let output_app = app.clone();
    let output_runtime = Arc::clone(&runtime);
    thread::spawn(move || {
        for line in BufReader::new(stdout).lines() {
            match line {
                Ok(line) => {
                    if let Err(error) = accept_ready(&output_app, &output_runtime, &line) {
                        boot_failure(&output_app, &output_runtime, error);
                    }
                }
                Err(error) => {
                    if !output_runtime.closing.load(Ordering::SeqCst) {
                        boot_failure(
                            &output_app,
                            &output_runtime,
                            format!("Backend output failed: {error}"),
                        );
                    }
                    break;
                }
            }
        }
    });
    thread::spawn(move || {
        for line in BufReader::new(stderr).lines().map_while(Result::ok) {
            eprintln!("[runtime] {line}");
        }
    });
    thread::spawn(move || {
        let started = Instant::now();
        loop {
            thread::sleep(Duration::from_millis(100));
            let result = runtime
                .child
                .lock()
                .ok()
                .and_then(|mut child| child.as_mut().map(|process| process.try_wait()));
            match result {
                Some(Ok(Some(exit))) => {
                    if let Ok(mut process) = runtime.child.lock() {
                        process.take();
                    }
                    if let Ok(mut value) = runtime.status.lock() {
                        value.exit_code = exit.code();
                    }
                    if !runtime.closing.load(Ordering::SeqCst) {
                        boot_failure(&app, &runtime, format!("The local runtime exited unexpectedly ({exit}). Close and reopen Agent Bay."));
                    }
                    break;
                }
                Some(Err(error)) => {
                    boot_failure(
                        &app,
                        &runtime,
                        format!("Runtime process check failed: {error}"),
                    );
                    break;
                }
                None => break,
                _ => {}
            }
            if started.elapsed() > Duration::from_secs(20)
                && status(&runtime)
                    .map(|value| value.phase == "starting")
                    .unwrap_or(false)
            {
                boot_failure(&app, &runtime, "The local runtime did not become ready within 20 seconds. Close and reopen Agent Bay.".into());
                if let Ok(mut process) = runtime.child.lock() {
                    if let Some(child) = process.as_mut() {
                        let _ = child.kill();
                    }
                }
            }
        }
    });
    Ok(())
}

fn shutdown(app: AppHandle, runtime: Arc<Runtime>) {
    if runtime.closing.swap(true, Ordering::SeqCst) {
        return;
    }
    if let Ok(mut value) = runtime.status.lock() {
        value.phase = "stopping".into();
    }
    if let Ok(mut process) = runtime.child.lock() {
        if let Some(stdin) = process.as_mut().and_then(|child| child.stdin.as_mut()) {
            let _ = stdin.write_all(b"AGENT_BAY_SHUTDOWN\n");
            let _ = stdin.flush();
        }
    }
    thread::spawn(move || {
        let started = Instant::now();
        while started.elapsed() < Duration::from_secs(6) {
            if runtime
                .child
                .lock()
                .map(|process| process.is_none())
                .unwrap_or(true)
            {
                app.exit(0);
                return;
            }
            thread::sleep(Duration::from_millis(50));
        }
        if let Ok(mut process) = runtime.child.lock() {
            if let Some(child) = process.as_mut() {
                let _ = child.kill();
                let _ = child.wait();
            }
            process.take();
        }
        app.exit(0);
    });
}

fn main() {
    let runtime = Arc::new(Runtime::new());
    let builder_state = Arc::clone(&runtime);
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(Arc::clone(&runtime))
        .invoke_handler(tauri::generate_handler![
            pick_target_path,
            save_export,
            save_video,
            desktop_status,
            desktop_preferences,
            set_window_style
        ])
        .setup(move |app| {
            let navigation_state = Arc::clone(&builder_state);
            let page_state = Arc::clone(&builder_state);
            // Keep room around the workspace, including on scaled laptop displays.
            let (width, height) = app
                .primary_monitor()
                .ok()
                .flatten()
                .map(|monitor| {
                    let available = monitor
                        .work_area()
                        .size
                        .to_logical::<f64>(monitor.scale_factor());
                    (
                        1200.0_f64.min((available.width * 0.9).floor()),
                        800.0_f64.min((available.height * 0.9).floor()),
                    )
                })
                .unwrap_or((1200.0, 800.0));
            WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
                .title("Agent Bay")
                .background_color(tauri::window::Color(10, 15, 23, 255))
                .decorations(false)
                .shadow(true)
                .inner_size(width, height)
                .min_inner_size(980.0_f64.min(width), 720.0_f64.min(height))
                .center()
                .on_navigation(move |url| {
                    let value = status(&navigation_state).ok();
                    let boot = matches!(url.scheme(), "tauri" | "http" | "https")
                        && matches!(url.host_str(), Some("localhost" | "tauri.localhost"));
                    if boot {
                        return value
                            .as_ref()
                            .map(|value| value.phase != "ready")
                            .unwrap_or(false);
                    }
                    value
                        .and_then(|value| value.backend_url)
                        .and_then(|backend| tauri::Url::parse(&backend).ok())
                        .map(|backend| url.origin() == backend.origin())
                        .unwrap_or(false)
                })
                .on_page_load(move |window, _| {
                    if let Ok(value) = status(&page_state) {
                        if let Some(message) = value.error {
                            let _ = window.eval(&format!(
                                "window.showDesktopFailure?.({})",
                                serde_json::to_string(&message)
                                    .unwrap_or_else(|_| "\"Runtime failed\"".into())
                            ));
                        }
                    }
                })
                .build()?;
            if let Err(error) = start_backend(app.handle().clone(), Arc::clone(&builder_state)) {
                boot_failure(app.handle(), &builder_state, error);
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                shutdown(
                    window.app_handle().clone(),
                    Arc::clone(&window.state::<Arc<Runtime>>()),
                );
            }
        })
        .build(tauri::generate_context!())
        .expect("build Agent Bay desktop application");
    app.run(move |handle, event| {
        if let tauri::RunEvent::ExitRequested { api, .. } = event {
            if !runtime.closing.load(Ordering::SeqCst) {
                api.prevent_exit();
                shutdown(handle.clone(), Arc::clone(&runtime));
            }
        }
    });
}
