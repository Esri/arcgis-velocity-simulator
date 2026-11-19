#![cfg_attr(target_os = "windows", windows_subsystem = "windows")]

use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    io::{BufRead, BufReader, Read, Write},
    path::{Path, PathBuf},
    process::{Child, ChildStdin, Command, Stdio},
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, Mutex,
    },
};
use tauri::{
    menu::{
        AboutMetadata, CheckMenuItem, Menu, MenuItem, MenuItemKind, PredefinedMenuItem, Submenu,
    },
    AppHandle, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder,
};
use tokio::sync::oneshot;

const MAX_FRAME: usize = 16 * 1024 * 1024;
const FILES: &[&str] = &[
    "index.html",
    "splash.html",
    "about.html",
    "help.html",
    "cli.html",
    "config.html",
    "launch-config.html",
    "error.html",
    "velocity-login.html",
    "protocol-settings.html",
];
type Reply = Result<Value, String>;
type Waiting = HashMap<u64, oneshot::Sender<Reply>>;

struct Bridge {
    input: Mutex<ChildStdin>,
    child: Mutex<Child>,
    pending: Mutex<Waiting>,
    evaluations: Mutex<HashMap<u64, String>>,
    windows: Mutex<HashMap<String, String>>,
    modal_parents: Mutex<HashMap<String, String>>,
    menu_roles: Mutex<HashMap<String, String>>,
    menu_checks: Mutex<HashMap<String, CheckMenuItem<tauri::Wry>>>,
    clipboard: Mutex<Option<arboard::Clipboard>>,
    about: Mutex<Value>,
    zoom: Mutex<HashMap<String, f64>>,
    next_id: AtomicU64,
}

impl Bridge {
    fn send(&self, message: Value) -> Result<(), String> {
        let text = serde_json::to_string(&message).map_err(|e| e.to_string())?;
        if text.len() > MAX_FRAME {
            return Err("Desktop IPC frame exceeds 16 MiB".into());
        }
        let mut input = self.input.lock().map_err(|e| e.to_string())?;
        writeln!(input, "{text}").map_err(|e| e.to_string())?;
        input.flush().map_err(|e| e.to_string())
    }
    fn result(&self, id: u64, result: Reply) {
        let message = match result {
            Ok(value) => json!({"type":"result", "id":id, "value":value}),
            Err(error) => {
                eprintln!("[Tauri] {error}");
                json!({"type":"result", "id":id, "error":error})
            }
        };
        if let Err(error) = self.send(message) {
            eprintln!("[Tauri] Backend response failed: {error}");
        }
    }
}

#[tauri::command]
async fn desktop_ipc(
    window: WebviewWindow,
    state: tauri::State<'_, Arc<Bridge>>,
    message: Value,
) -> Reply {
    let label = window.label().to_string();
    let file = state
        .windows
        .lock()
        .map_err(|e| e.to_string())?
        .get(&label)
        .cloned()
        .ok_or("Unknown desktop window")?;
    let url = window.url().map_err(|e| e.to_string())?;
    if !document_matches(&url, &file) {
        return Err("Desktop IPC is restricted to its original application document".into());
    }
    if serde_json::to_vec(&message)
        .map_err(|e| e.to_string())?
        .len()
        > MAX_FRAME
    {
        return Err("Desktop IPC frame exceeds 16 MiB".into());
    }
    let id = state.next_id.fetch_add(1, Ordering::Relaxed);
    let (tx, rx) = oneshot::channel();
    state
        .pending
        .lock()
        .map_err(|e| e.to_string())?
        .insert(id, tx);
    if let Err(error) =
        state.send(json!({"type":"frontend", "id":id, "label":label, "message":message}))
    {
        state.pending.lock().map_err(|e| e.to_string())?.remove(&id);
        return Err(error);
    }
    // Login and native save dialogs may legitimately wait for user input.
    let result = tokio::time::timeout(std::time::Duration::from_secs(900), rx).await;
    state.pending.lock().map_err(|e| e.to_string())?.remove(&id);
    match result {
        Ok(Ok(value)) => value,
        Ok(Err(_)) => Err("Desktop backend stopped".into()),
        Err(_) => Err("Desktop request timed out".into()),
    }
}

#[tauri::command]
fn desktop_eval_result(
    window: WebviewWindow,
    state: tauri::State<'_, Arc<Bridge>>,
    id: u64,
    value: Option<Value>,
    error: Option<String>,
) -> Result<(), String> {
    let mut pending = state.evaluations.lock().map_err(|e| e.to_string())?;
    if pending.get(&id) != Some(&window.label().to_string()) {
        return Err("Evaluation response belongs to a different window".into());
    }
    pending.remove(&id);
    state.result(
        id,
        match error {
            Some(e) => Err(e),
            None => Ok(value.unwrap_or(Value::Null)),
        },
    );
    Ok(())
}

fn local_url(url: &tauri::Url) -> bool {
    (url.scheme() == "tauri" && url.host_str() == Some("localhost"))
        || (matches!(url.scheme(), "http" | "https") && url.host_str() == Some("tauri.localhost"))
}

fn document_matches(url: &tauri::Url, file: &str) -> bool {
    let document = url.path().trim_start_matches('/');
    local_url(url) && (document == file || (document.is_empty() && file == "index.html"))
}

fn text<'a>(value: &'a Value, key: &str) -> Result<&'a str, String> {
    value
        .get(key)
        .and_then(Value::as_str)
        .ok_or_else(|| format!("Missing string {key}"))
}
fn number(value: &Value, key: &str, fallback: f64) -> f64 {
    value
        .get(key)
        .and_then(Value::as_f64)
        .filter(|n| n.is_finite())
        .unwrap_or(fallback)
}
fn flag(value: &Value, key: &str, fallback: bool) -> bool {
    value.get(key).and_then(Value::as_bool).unwrap_or(fallback)
}

fn initialization(file: &str) -> String {
    let preload = match file {
        "protocol-settings.html" => include_str!("../../src/protocol-settings-preload.js"),
        "velocity-login.html" => include_str!("../../src/velocity-login-preload.js"),
        "splash.html" => "",
        _ => include_str!("../../src/preload.js"),
    };
    let splash = if file == "splash.html" {
        "Object.defineProperty(window,'require',{value:(name)=>{if(name==='electron')return window.__velocityDesktop;throw new Error('Node integration is disabled')}});"
    } else {
        ""
    };
    format!("{}\n{splash}\n(()=>{{const require=(name)=>{{if(name==='electron')return window.__velocityDesktop;throw new Error('Node integration is disabled')}};\n{preload}\n}})();",
        include_str!("../../src/tauri-frontend.js"))
}

fn document_url(file: &str, query: &Value) -> Result<WebviewUrl, String> {
    if !FILES.contains(&file) {
        return Err("Unknown desktop document".into());
    }
    let mut path = file.to_string();
    if let Some(fields) = query.as_object() {
        let mut url = tauri::Url::parse("https://tauri.localhost/").map_err(|e| e.to_string())?;
        for (key, value) in fields {
            if let Some(value) = value.as_str() {
                url.query_pairs_mut().append_pair(key, value);
            }
        }
        if let Some(query) = url.query() {
            path.push('?');
            path.push_str(query);
        }
    }
    Ok(WebviewUrl::App(PathBuf::from(path)))
}

fn bounds(window: &WebviewWindow) -> Result<Value, String> {
    let scale = window.scale_factor().map_err(|e| e.to_string())?;
    let pos = window
        .outer_position()
        .map_err(|e| e.to_string())?
        .to_logical::<f64>(scale);
    let size = window
        .inner_size()
        .map_err(|e| e.to_string())?
        .to_logical::<f64>(scale);
    Ok(json!({"x":pos.x,"y":pos.y,"width":size.width,"height":size.height}))
}

fn create_window(app: &AppHandle, bridge: &Arc<Bridge>, message: &Value) -> Reply {
    let label = text(message, "label")?;
    let file = text(message, "file")?;
    if !label.starts_with("desktop-") || app.get_webview_window(label).is_some() {
        return Err("Invalid or duplicate window label".into());
    }
    let options = &message["options"];
    let mut builder = WebviewWindowBuilder::new(app, label, document_url(file, &message["query"])?)
        .title(
            options["title"]
                .as_str()
                .unwrap_or(&app.package_info().name),
        )
        .inner_size(
            number(options, "width", 800.0),
            number(options, "height", 600.0),
        )
        .visible(flag(options, "show", true))
        .resizable(flag(options, "resizable", true))
        .decorations(flag(options, "frame", true))
        .always_on_top(flag(options, "alwaysOnTop", false))
        .minimizable(flag(options, "minimizable", true))
        .maximizable(flag(options, "maximizable", true))
        .on_page_load(|window, payload| {
            eprintln!(
                "[Tauri] Page {:?}: {} ({})",
                payload.event(),
                payload.url(),
                window.label()
            );
        })
        .initialization_script(initialization(file));
    if options["x"].is_number() && options["y"].is_number() {
        builder = builder.position(number(options, "x", 0.0), number(options, "y", 0.0));
    } else {
        builder = builder.center();
    }
    if options["minWidth"].is_number() || options["minHeight"].is_number() {
        builder = builder.min_inner_size(
            number(options, "minWidth", 1.0),
            number(options, "minHeight", 1.0),
        );
    }
    let mut modal_parent = None;
    if let Some(parent) = message["parent"]
        .as_str()
        .and_then(|label| app.get_webview_window(label))
    {
        builder = builder.parent(&parent).map_err(|e| e.to_string())?;
        if flag(options, "modal", false) {
            modal_parent = Some(parent);
        }
    }
    let b = bridge.clone();
    let navigation_label = label.to_string();
    builder = builder.on_navigation(move |url| {
        if local_url(url) {
            return true;
        }
        if let Err(error) = b.send(
            json!({"type":"window","event":"external","label":navigation_label,"url":url.as_str()}),
        ) {
            eprintln!("[Tauri] Navigation notification failed: {error}");
        }
        false
    });
    let b = bridge.clone();
    let popup_label = label.to_string();
    builder = builder.on_new_window(move |url, _features| {
        if let Err(error) = b.send(
            json!({"type":"window","event":"external","label":popup_label,"url":url.as_str()}),
        ) {
            eprintln!("[Tauri] External window notification failed: {error}");
        }
        tauri::webview::NewWindowResponse::Deny
    });
    bridge
        .windows
        .lock()
        .unwrap()
        .insert(label.into(), file.into());
    let window = match builder.build() {
        Ok(window) => window,
        Err(error) => {
            bridge.windows.lock().unwrap().remove(label);
            return Err(error.to_string());
        }
    };
    if let Some(parent) = modal_parent {
        if let Err(error) = parent.set_enabled(false) {
            if let Err(cleanup) = window.destroy() {
                eprintln!("[Tauri] Failed to close incomplete modal window: {cleanup}");
            }
            bridge.windows.lock().unwrap().remove(label);
            return Err(error.to_string());
        }
        bridge
            .modal_parents
            .lock()
            .unwrap()
            .insert(label.into(), parent.label().into());
    }
    bridge.send(json!({"type":"window","event":"theme","label":label,"dark":window.theme().map_err(|e|e.to_string())? == tauri::Theme::Dark}))?;
    let event_window = window.clone();
    let b = bridge.clone();
    let app_handle = app.clone();
    let event_label = label.to_string();
    window.on_window_event(move |event| {
        let message = match event {
            tauri::WindowEvent::CloseRequested { api, .. } => {
                api.prevent_close();
                Some(json!({"type":"window","event":"close","label":event_label}))
            },
            tauri::WindowEvent::Destroyed => {
                b.windows.lock().unwrap().remove(&event_label);
                b.zoom.lock().unwrap().remove(&event_label);
                b.evaluations.lock().unwrap().retain(|_, label| label != &event_label);
                if let Some(parent) = b.modal_parents.lock().unwrap().remove(&event_label) {
                    if let Some(parent) = app_handle.get_webview_window(&parent) {
                        if let Err(error) = parent.set_enabled(true) { eprintln!("[Tauri] Parent enable failed: {error}"); }
                        if let Err(error) = parent.set_focus() { eprintln!("[Tauri] Parent focus failed: {error}"); }
                    }
                }
                Some(json!({"type":"window","event":"closed","label":event_label}))
            },
            tauri::WindowEvent::Resized(_) | tauri::WindowEvent::Moved(_) => bounds(&event_window).ok()
                .map(|bounds| json!({"type":"window","event":"bounds","label":event_label,"bounds":bounds})),
            tauri::WindowEvent::Focused(focused) => Some(json!({"type":"window","event":"focus","label":event_label,"focused":focused})),
            tauri::WindowEvent::ThemeChanged(theme) => Some(json!({"type":"window","event":"theme","label":event_label,"dark":*theme == tauri::Theme::Dark})),
            _ => None,
        };
        if let Some(mut message) = message {
            if matches!(event, tauri::WindowEvent::Focused(_) | tauri::WindowEvent::Resized(_) | tauri::WindowEvent::Moved(_)) {
                match (event_window.is_minimized(), event_window.is_fullscreen()) {
                    (Ok(minimized), Ok(fullscreen)) => {
                        message["minimized"] = json!(minimized);
                        message["fullscreen"] = json!(fullscreen);
                    }
                    (Err(error), _) | (_, Err(error)) => eprintln!("[Tauri] Window state query failed: {error}"),
                }
            }
            if let Err(error) = b.send(message) { eprintln!("[Tauri] Window notification failed: {error}"); }
        }
    });
    Ok(json!({"bounds":bounds(&window)?}))
}

fn menu_item(
    app: &AppHandle,
    bridge: &Arc<Bridge>,
    item: &Value,
) -> Result<MenuItemKind<tauri::Wry>, String> {
    let id = text(item, "id")?;
    let label = item["label"].as_str().unwrap_or("");
    let enabled = flag(item, "enabled", true);
    if let Some(children) = item["submenu"].as_array() {
        let menu = Submenu::with_id(app, id, label, enabled).map_err(|e| e.to_string())?;
        for child in children {
            menu.append(&menu_item(app, bridge, child)?)
                .map_err(|e| e.to_string())?;
        }
        return Ok(MenuItemKind::Submenu(menu));
    }
    if item["type"] == "separator" {
        return Ok(MenuItemKind::Predefined(
            PredefinedMenuItem::separator(app).map_err(|e| e.to_string())?,
        ));
    }
    if let Some(role) = item["role"].as_str() {
        let native = match role.to_lowercase().as_str() {
            "undo" => Some(PredefinedMenuItem::undo(app, Some(label))),
            "redo" => Some(PredefinedMenuItem::redo(app, Some(label))),
            "cut" => Some(PredefinedMenuItem::cut(app, Some(label))),
            "copy" => Some(PredefinedMenuItem::copy(app, Some(label))),
            "paste" => Some(PredefinedMenuItem::paste(app, Some(label))),
            "selectall" => Some(PredefinedMenuItem::select_all(app, Some(label))),
            "hide" => Some(PredefinedMenuItem::hide(app, Some(label))),
            "hideothers" => Some(PredefinedMenuItem::hide_others(app, Some(label))),
            "unhide" => Some(PredefinedMenuItem::show_all(app, Some(label))),
            "about" => {
                let info = bridge.about.lock().unwrap();
                Some(PredefinedMenuItem::about(
                    app,
                    Some(label),
                    Some(AboutMetadata {
                        name: info["applicationName"].as_str().map(str::to_string),
                        version: info["applicationVersion"].as_str().map(str::to_string),
                        copyright: info["copyright"].as_str().map(str::to_string),
                        credits: info["credits"].as_str().map(str::to_string),
                        ..Default::default()
                    }),
                ))
            }
            "quit" => None,
            _ => None,
        };
        if let Some(native) = native {
            return Ok(MenuItemKind::Predefined(native.map_err(|e| e.to_string())?));
        }
        bridge
            .menu_roles
            .lock()
            .unwrap()
            .insert(id.into(), role.into());
    }
    let accelerator = item["accelerator"].as_str().map(|s| {
        s.replace("CmdOrCtrl", "CommandOrControl")
            .replace("Plus", "Equal")
    });
    if item["type"] == "checkbox" || item["type"] == "radio" {
        let check = CheckMenuItem::with_id(
            app,
            id,
            label,
            enabled,
            flag(item, "checked", false),
            accelerator.as_deref(),
        )
        .map_err(|e| e.to_string())?;
        bridge
            .menu_checks
            .lock()
            .unwrap()
            .insert(id.into(), check.clone());
        Ok(MenuItemKind::Check(check))
    } else {
        Ok(MenuItemKind::MenuItem(
            MenuItem::with_id(app, id, label, enabled, accelerator.as_deref())
                .map_err(|e| e.to_string())?,
        ))
    }
}

fn make_menu(
    app: &AppHandle,
    bridge: &Arc<Bridge>,
    value: &Value,
) -> Result<Menu<tauri::Wry>, String> {
    let menu = Menu::new(app).map_err(|e| e.to_string())?;
    for item in value.as_array().ok_or("Invalid menu items")? {
        menu.append(&menu_item(app, bridge, item)?)
            .map_err(|e| e.to_string())?;
    }
    Ok(menu)
}

#[cfg(all(unix, any(target_os = "linux", test)))]
fn require_zenity(search_path: Option<&std::ffi::OsStr>) -> Result<(), String> {
    use std::os::unix::fs::PermissionsExt;

    if search_path.is_some_and(|paths| {
        std::env::split_paths(paths).any(|directory| {
            !directory.as_os_str().is_empty()
                && std::fs::metadata(directory.join("zenity")).is_ok_and(|metadata| {
                    metadata.is_file() && metadata.permissions().mode() & 0o111 != 0
                })
        })
    }) {
        return Ok(());
    }
    Err("Linux native dialogs require Zenity. Install the zenity package and ensure it is on PATH; no dialog was opened.".into())
}

fn native_dialog(message: &Value) -> Reply {
    #[cfg(target_os = "linux")]
    require_zenity(std::env::var_os("PATH").as_deref())?;

    let options = &message["options"];
    let title = options["title"].as_str().unwrap_or("");
    let kind = text(message, "kind")?;
    if kind == "error" || kind == "message" {
        let result = rfd::MessageDialog::new()
            .set_title(title)
            .set_description(options["message"].as_str().unwrap_or(""))
            .set_level(if kind == "error" {
                rfd::MessageLevel::Error
            } else {
                rfd::MessageLevel::Info
            })
            .show();
        return Ok(json!({"response":if result == rfd::MessageDialogResult::Ok {0} else {1}}));
    }
    let mut dialog = rfd::FileDialog::new().set_title(title);
    if let Some(default) = options["defaultPath"].as_str() {
        let path = Path::new(default);
        if path.is_dir() {
            dialog = dialog.set_directory(path);
        } else {
            if let Some(parent) = path.parent() {
                if parent.is_dir() {
                    dialog = dialog.set_directory(parent);
                }
            }
            if let Some(name) = path.file_name() {
                dialog = dialog.set_file_name(name.to_string_lossy());
            }
        }
    }
    if let Some(filters) = options["filters"].as_array() {
        for filter in filters {
            let extensions: Vec<&str> = filter["extensions"]
                .as_array()
                .ok_or("Invalid file filter")?
                .iter()
                .filter_map(Value::as_str)
                .collect();
            dialog = dialog.add_filter(filter["name"].as_str().unwrap_or("Files"), &extensions);
        }
    }
    if kind == "save" {
        let file = dialog.save_file();
        return Ok(json!({"canceled":file.is_none(),"filePath":file}));
    }
    let properties = options["properties"]
        .as_array()
        .cloned()
        .unwrap_or_default();
    let files = if properties.contains(&json!("openDirectory")) {
        dialog.pick_folder().map(|file| vec![file])
    } else if properties.contains(&json!("multiSelections")) {
        dialog.pick_files()
    } else {
        dialog.pick_file().map(|file| vec![file])
    };
    Ok(json!({"canceled":files.is_none(),"filePaths":files.unwrap_or_default()}))
}

fn native_operation(
    app: &AppHandle,
    bridge: &Arc<Bridge>,
    message: &Value,
) -> Result<Option<Value>, String> {
    let op = text(message, "op")?;
    match op {
        "create" => return create_window(app, bridge, message).map(Some),
        "menu" => {
            app.set_menu(make_menu(app, bridge, &message["menu"])?)
                .map_err(|e| e.to_string())?;
            return Ok(Some(Value::Null));
        }
        "dialog" => {
            let message = message.clone();
            let b = bridge.clone();
            std::thread::spawn(move || {
                b.result(message["id"].as_u64().unwrap(), native_dialog(&message))
            });
            return Ok(None);
        }
        "clipboard" => {
            let mut clipboard = bridge.clipboard.lock().map_err(|e| e.to_string())?;
            if clipboard.is_none() {
                *clipboard = Some(arboard::Clipboard::new().map_err(|e| e.to_string())?);
            }
            clipboard
                .as_mut()
                .unwrap()
                .set_text(text(message, "text")?)
                .map_err(|e| e.to_string())?;
            return Ok(Some(Value::Null));
        }
        "open-external" => {
            let url = tauri::Url::parse(text(message, "url")?).map_err(|e| e.to_string())?;
            if !matches!(url.scheme(), "http" | "https" | "mailto") {
                return Err("External URL scheme is not permitted".into());
            }
            open::that(url.as_str()).map_err(|e| e.to_string())?;
            return Ok(Some(Value::Null));
        }
        "dock" => {
            #[cfg(target_os = "macos")]
            app.set_activation_policy(if flag(message, "visible", true) {
                tauri::ActivationPolicy::Regular
            } else {
                tauri::ActivationPolicy::Accessory
            })
            .map_err(|e| e.to_string())?;
            return Ok(Some(Value::Null));
        }
        "dock-icon" => {
            set_dock_icon(text(message, "icon")?)?;
            return Ok(Some(Value::Null));
        }
        "about" => {
            if !message["options"].is_object() {
                return Err("Invalid About metadata".into());
            }
            *bridge.about.lock().unwrap() = message["options"].clone();
            return Ok(Some(Value::Null));
        }
        _ => {}
    }
    let label = text(message, "label")?;
    let window = app
        .get_webview_window(label)
        .ok_or("Desktop window is closed")?;
    match op {
        "emit" => {
            let channel = serde_json::to_string(&message["channel"]).unwrap();
            let args = serde_json::to_string(&message["args"]).unwrap();
            window
                .eval(&format!(
                    "window.__velocityDesktop.deliver({channel},{args})"
                ))
                .map_err(|e| e.to_string())?;
        }
        "eval" => {
            let id = message["id"].as_u64().ok_or("Invalid evaluation id")?;
            let script = text(message, "script")?
                .trim()
                .trim_end_matches(';')
                .trim_end();
            bridge.evaluations.lock().unwrap().insert(id, label.into());
            window.eval(&format!("Promise.resolve().then(()=>({script})).then(value=>window.__TAURI_INTERNALS__.invoke('desktop_eval_result',{{id:{id},value:value??null,error:null}}),error=>window.__TAURI_INTERNALS__.invoke('desktop_eval_result',{{id:{id},value:null,error:String(error)}}));"))
                .map_err(|e| e.to_string())?;
            return Ok(None);
        }
        "show" => window.show().map_err(|e| e.to_string())?,
        "hide" => window.hide().map_err(|e| e.to_string())?,
        "focus" => window.set_focus().map_err(|e| e.to_string())?,
        "restore" => window.unminimize().map_err(|e| e.to_string())?,
        "center" => window.center().map_err(|e| e.to_string())?,
        "title" => window
            .set_title(text(message, "title")?)
            .map_err(|e| e.to_string())?,
        "destroy" => window.destroy().map_err(|e| e.to_string())?,
        "reload" => window
            .eval("window.location.reload()")
            .map_err(|e| e.to_string())?,
        "size" => {
            let wanted = tauri::LogicalSize::new(
                number(message, "width", 800.0),
                number(message, "height", 600.0),
            );
            let current = window
                .inner_size()
                .map_err(|e| e.to_string())?
                .to_logical::<f64>(window.scale_factor().map_err(|e| e.to_string())?);
            if wanted != current {
                window.set_size(wanted).map_err(|e| e.to_string())?;
            }
        }
        "position" => window
            .set_position(tauri::LogicalPosition::new(
                number(message, "x", 0.0),
                number(message, "y", 0.0),
            ))
            .map_err(|e| e.to_string())?,
        "opacity" => set_opacity(&window, number(message, "opacity", 1.0).clamp(0.1, 1.0))?,
        "devtools" => {
            if flag(message, "open", false) {
                window.open_devtools()
            } else {
                window.close_devtools()
            }
        }
        "devtools-state" => return Ok(Some(json!(window.is_devtools_open()))),
        "inspect" => {
            window.open_devtools();
            let x = number(message, "x", 0.0);
            let y = number(message, "y", 0.0);
            window
                .eval(&format!(
                    "console.log('Selected element:',document.elementFromPoint({x},{y}))"
                ))
                .map_err(|e| e.to_string())?;
        }
        "menu-visible" => {
            if flag(message, "visible", true) {
                window.show_menu().map_err(|e| e.to_string())?
            } else {
                window.hide_menu().map_err(|e| e.to_string())?
            }
        }
        "window-menu" => {
            if message["menu"].is_null() {
                window.remove_menu().map_err(|e| e.to_string())?;
            } else {
                window
                    .set_menu(make_menu(app, bridge, &message["menu"])?)
                    .map_err(|e| e.to_string())?;
            }
        }
        "popup-menu" => window
            .popup_menu(&make_menu(app, bridge, &message["menu"])?)
            .map_err(|e| e.to_string())?,
        "navigate" => {
            let file = text(message, "file")?;
            if bridge
                .windows
                .lock()
                .unwrap()
                .get(label)
                .map(String::as_str)
                != Some(file)
            {
                return Err("Cannot change a window's IPC role".into());
            }
            let url = document_url(file, &message["query"])?;
            if let WebviewUrl::App(path) = url {
                let base = window.url().map_err(|e| e.to_string())?;
                window
                    .navigate(
                        base.join(&format!("/{}", path.to_string_lossy()))
                            .map_err(|e| e.to_string())?,
                    )
                    .map_err(|e| e.to_string())?;
            }
        }
        _ => return Err(format!("Unsupported native desktop operation: {op}")),
    }
    Ok(Some(Value::Null))
}

#[cfg(target_os = "macos")]
fn set_opacity(window: &WebviewWindow, opacity: f64) -> Result<(), String> {
    use objc2::msg_send;
    let native = window.ns_window().map_err(|e| e.to_string())?;
    unsafe {
        let _: () = msg_send![native as *mut objc2::runtime::AnyObject, setAlphaValue: opacity];
    }
    Ok(())
}
#[cfg(target_os = "windows")]
fn set_opacity(window: &WebviewWindow, opacity: f64) -> Result<(), String> {
    use windows_sys::Win32::UI::WindowsAndMessaging::*;
    let hwnd = window.hwnd().map_err(|e| e.to_string())?.0 as windows_sys::Win32::Foundation::HWND;
    unsafe {
        let style = GetWindowLongW(hwnd, GWL_EXSTYLE);
        SetWindowLongW(hwnd, GWL_EXSTYLE, style | WS_EX_LAYERED as i32);
        if SetLayeredWindowAttributes(hwnd, 0, (opacity * 255.0).round() as u8, LWA_ALPHA) == 0 {
            return Err(std::io::Error::last_os_error().to_string());
        }
    }
    Ok(())
}
#[cfg(target_os = "linux")]
fn set_opacity(window: &WebviewWindow, opacity: f64) -> Result<(), String> {
    use gtk::prelude::*;
    window
        .gtk_window()
        .map_err(|e| e.to_string())?
        .set_opacity(opacity);
    Ok(())
}
#[cfg(target_os = "macos")]
fn set_dock_icon(path: &str) -> Result<(), String> {
    use objc2::{class, msg_send};
    let bytes = std::ffi::CString::new(path).map_err(|e| e.to_string())?;
    unsafe {
        let string: *mut objc2::runtime::AnyObject =
            msg_send![class!(NSString), stringWithUTF8String:bytes.as_ptr()];
        let image: *mut objc2::runtime::AnyObject = msg_send![class!(NSImage), alloc];
        let image: *mut objc2::runtime::AnyObject = msg_send![image, initWithContentsOfFile:string];
        if image.is_null() {
            return Err("Could not load dock icon".into());
        }
        let app: *mut objc2::runtime::AnyObject =
            msg_send![class!(NSApplication), sharedApplication];
        let _: () = msg_send![app, setApplicationIconImage:image];
        let _: () = msg_send![image, release];
    }
    Ok(())
}
#[cfg(not(target_os = "macos"))]
fn set_dock_icon(_: &str) -> Result<(), String> {
    Err("Dock icons are only available on macOS".into())
}

fn run_menu_role(app: &AppHandle, role: &str) -> Result<(), String> {
    if role == "quit" {
        app.state::<Arc<Bridge>>().send(json!({"type":"quit"}))?;
        return Ok(());
    }
    let window = app
        .webview_windows()
        .into_values()
        .find(|w| w.is_focused().unwrap_or(false))
        .ok_or("No focused window")?;
    match role.to_lowercase().as_str() {
        "reload" | "forcereload" => window
            .eval("location.reload()")
            .map_err(|e| e.to_string())?,
        "togglefullscreen" => window
            .set_fullscreen(!window.is_fullscreen().map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string())?,
        "resetzoom" | "zoomin" | "zoomout" => {
            let bridge = app.state::<Arc<Bridge>>();
            let mut levels = bridge.zoom.lock().unwrap();
            let previous = *levels.get(window.label()).unwrap_or(&1.0);
            let next = if role.eq_ignore_ascii_case("resetzoom") {
                1.0
            } else {
                (previous
                    + if role.eq_ignore_ascii_case("zoomin") {
                        0.1
                    } else {
                        -0.1
                    })
                .clamp(0.5, 3.0)
            };
            window.set_zoom(next).map_err(|e| e.to_string())?;
            levels.insert(window.label().into(), next);
        }
        _ => return Err(format!("Unsupported menu role: {role}")),
    }
    Ok(())
}

fn backend_paths(context: &tauri::Context<tauri::Wry>) -> Result<(PathBuf, PathBuf), String> {
    let resources =
        tauri::utils::platform::resource_dir(context.package_info(), &tauri::Env::default())
            .map_err(|e| e.to_string())?;
    let mut roots = vec![resources];
    if cfg!(debug_assertions) {
        roots.push(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources"));
    }
    for root in roots {
        let node = root.join(if cfg!(windows) { "node.exe" } else { "node" });
        let entry = root.join("backend/src/tauri-backend.js");
        if node.is_file() && entry.is_file() {
            return Ok((node, entry));
        }
    }
    Err("Bundled Node backend is missing. Run the Tauri preparation step before building.".into())
}

fn node_command(node: &Path, entry: &Path) -> Command {
    let mut command = Command::new(node);
    command
        .arg(entry)
        .env_remove("NODE_OPTIONS")
        .env_remove("NODE_PATH")
        .env_remove("ELECTRON_RUN_AS_NODE")
        .env("VELOCITY_DESKTOP_RUNTIME", "tauri");
    if let Ok(exe) = std::env::current_exe() {
        command.env("VELOCITY_TAURI_EXE", exe);
    }
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        // Explicit inherited handles still work for CLI; GUI children never open a console.
        command.creation_flags(0x08000000);
    }
    command
}

fn read_message(reader: &mut impl BufRead) -> Result<Option<Value>, String> {
    let mut assembled = Vec::new();
    loop {
        let mut line = Vec::new();
        let count = (&mut *reader)
            .take((MAX_FRAME + 1) as u64)
            .read_until(b'\n', &mut line)
            .map_err(|e| e.to_string())?;
        if count == 0 {
            return if assembled.is_empty() {
                Ok(None)
            } else {
                Err("Incomplete backend chunk sequence".into())
            };
        }
        if count > MAX_FRAME || line.last() != Some(&b'\n') {
            return Err("Oversized or incomplete backend frame".into());
        }
        let message: Value = serde_json::from_slice(&line).map_err(|e| e.to_string())?;
        if message["type"] == "chunk" {
            let data = text(&message, "data")?;
            assembled.extend(BASE64.decode(data).map_err(|e| e.to_string())?);
            let last = message["last"]
                .as_bool()
                .ok_or("Missing chunk terminator")?;
            if last {
                return serde_json::from_slice(&assembled)
                    .map(Some)
                    .map_err(|e| e.to_string());
            }
        } else {
            if !assembled.is_empty() {
                return Err("Interleaved backend chunk sequence".into());
            }
            return Ok(Some(message));
        }
    }
}

fn run() -> Result<(), String> {
    let context = tauri::generate_context!();
    let (node, entry) = backend_paths(&context)?;
    let args: Vec<_> = std::env::args_os().skip(1).collect();
    let probe = node_command(&node, &entry)
        .arg("--tauri-probe")
        .args(&args)
        .output()
        .map_err(|e| e.to_string())?;
    if !probe.status.success() {
        return Err(format!(
            "CLI preflight failed: {}",
            String::from_utf8_lossy(&probe.stderr)
        ));
    }
    if probe.stdout == b"cli" {
        let status = node_command(&node, &entry)
            .args(&args)
            .env("VELOCITY_TAURI_CLI", "1")
            .status()
            .map_err(|e| e.to_string())?;
        std::process::exit(status.code().unwrap_or(1));
    }
    if probe.stdout != b"gui" {
        return Err("Backend returned an invalid startup mode".into());
    }
    let mut child = node_command(&node, &entry)
        .args(&args)
        .env_remove("VELOCITY_TAURI_CLI")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit())
        .spawn()
        .map_err(|e| e.to_string())?;
    let output = child.stdout.take().ok_or("Backend stdout unavailable")?;
    let bridge = Arc::new(Bridge {
        input: Mutex::new(child.stdin.take().ok_or("Backend stdin unavailable")?),
        child: Mutex::new(child),
        pending: Mutex::new(HashMap::new()),
        evaluations: Mutex::new(HashMap::new()),
        windows: Mutex::new(HashMap::new()),
        modal_parents: Mutex::new(HashMap::new()),
        menu_roles: Mutex::new(HashMap::new()),
        menu_checks: Mutex::new(HashMap::new()),
        next_id: AtomicU64::new(1),
        clipboard: Mutex::new(None),
        about: Mutex::new(Value::Null),
        zoom: Mutex::new(HashMap::new()),
    });
    let setup_bridge = bridge.clone();
    let application = tauri::Builder::default()
        .manage(bridge.clone())
        .invoke_handler(tauri::generate_handler![desktop_ipc, desktop_eval_result])
        .setup(move |app| {
            let app_handle = app.handle().clone();
            let b = setup_bridge.clone();
            let displays: Vec<Value> = app.available_monitors()?.iter().map(|monitor| {
                let scale = monitor.scale_factor();
                let area = monitor.work_area();
                let pos = area.position.to_logical::<f64>(scale);
                let size = area.size.to_logical::<f64>(scale);
                json!({"workArea":{"x":pos.x,"y":pos.y,"width":size.width,"height":size.height}})
            }).collect();
            b.send(json!({"type":"init","displays":displays,"dark":false}))
                .map_err(std::io::Error::other)?;
            std::thread::spawn(move || {
                let mut reader = BufReader::new(output);
                loop {
                    let message = match read_message(&mut reader) {
                        Ok(Some(message)) => message,
                        Ok(None) => break,
                        Err(error) => {
                            eprintln!("[Tauri] Invalid backend message: {error}");
                            break;
                        }
                    };
                    match message["type"].as_str() {
                        Some("response") => {
                            if let Some(id) = message["id"].as_u64() {
                                if let Some(tx) = b.pending.lock().unwrap().remove(&id) {
                                    let result = if let Some(error) = message["error"].as_str() {
                                        Err(error.into())
                                    } else {
                                        Ok(message["value"].clone())
                                    };
                                    let _ = tx.send(result);
                                }
                            }
                        }
                        Some("exit") => {
                            app_handle.exit(message["code"].as_i64().unwrap_or(1) as i32);
                            return;
                        }
                        Some("native") => {
                            let handle = app_handle.clone();
                            let bridge = b.clone();
                            let id = message["id"].as_u64().unwrap_or(0);
                            if let Err(error) = app_handle.run_on_main_thread(move || {
                                match native_operation(&handle, &bridge, &message) {
                                    Ok(Some(value)) => bridge.result(id, Ok(value)),
                                    Ok(None) => {}
                                    Err(error) => bridge.result(id, Err(error)),
                                }
                            }) {
                                b.result(id, Err(error.to_string()));
                            }
                        }
                        _ => {
                            eprintln!("[Tauri] Unknown backend message");
                            break;
                        }
                    }
                }
                b.pending.lock().unwrap().clear();
                let code = b
                    .child
                    .lock()
                    .unwrap()
                    .try_wait()
                    .ok()
                    .flatten()
                    .and_then(|s| s.code())
                    .unwrap_or(1);
                app_handle.exit(code);
            });
            Ok(())
        })
        .on_menu_event(|app, event| {
            let bridge = app.state::<Arc<Bridge>>();
            let id = event.id().as_ref();
            let role = bridge.menu_roles.lock().unwrap().get(id).cloned();
            if let Some(role) = role {
                if let Err(error) = run_menu_role(app, &role) {
                    eprintln!("[Tauri] Menu action failed: {error}");
                }
            } else {
                let checked = bridge
                    .menu_checks
                    .lock()
                    .unwrap()
                    .get(id)
                    .and_then(|item| item.is_checked().ok());
                if let Err(error) = bridge.send(json!({"type":"menu","id":id,"checked":checked})) {
                    eprintln!("[Tauri] Menu delivery failed: {error}");
                }
            }
        })
        .build(context)
        .map_err(|e| e.to_string())?;
    application.run(move |_, event| match event {
        tauri::RunEvent::ExitRequested { api, code, .. } if code.is_none() => {
            api.prevent_exit();
            if let Err(error) = bridge.send(json!({"type":"quit"})) {
                eprintln!("[Tauri] Shutdown delivery failed: {error}");
            }
        }
        tauri::RunEvent::Exit => {
            let mut child = bridge.child.lock().unwrap();
            if child.try_wait().ok().flatten().is_none() {
                if let Err(error) = child.kill() {
                    eprintln!("[Tauri] Backend cleanup failed: {error}");
                }
            }
            if let Err(error) = child.wait() {
                eprintln!("[Tauri] Backend wait failed: {error}");
            }
        }
        _ => {}
    });
    Ok(())
}

fn main() {
    #[cfg(target_os = "windows")]
    unsafe {
        // A terminal launch retains its console; Explorer launches remain windowless.
        windows_sys::Win32::System::Console::AttachConsole(
            windows_sys::Win32::System::Console::ATTACH_PARENT_PROCESS,
        );
    }
    if let Err(error) = run() {
        eprintln!("[Tauri] {error}");
        std::process::exit(1);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(unix)]
    #[test]
    fn missing_zenity_is_an_error_not_dialog_cancellation() {
        let directory = std::env::temp_dir().join(format!(
            "velocity-zenity-check-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir(&directory).unwrap();
        let result = require_zenity(Some(directory.as_os_str()));
        std::fs::remove_dir(directory).unwrap();
        assert!(result.unwrap_err().contains("Install the zenity package"));
        assert!(require_zenity(None).is_err());
    }

    #[test]
    fn document_role_is_bound_to_local_origin_and_path() {
        for origin in [
            "tauri://localhost",
            "http://tauri.localhost",
            "https://tauri.localhost",
        ] {
            assert!(document_matches(
                &tauri::Url::parse(&format!("{origin}/")).unwrap(),
                "index.html"
            ));
            assert!(document_matches(
                &tauri::Url::parse(&format!("{origin}/index.html")).unwrap(),
                "index.html"
            ));
            assert!(document_matches(
                &tauri::Url::parse(&format!("{origin}/protocol-settings.html?theme=dark")).unwrap(),
                "protocol-settings.html"
            ));
            assert!(!document_matches(
                &tauri::Url::parse(&format!("{origin}/")).unwrap(),
                "protocol-settings.html"
            ));
            assert!(!document_matches(
                &tauri::Url::parse(&format!("{origin}/index.html")).unwrap(),
                "velocity-login.html"
            ));
        }
        for url in [
            "https://example.com/index.html",
            "file:///index.html",
            "tauri://attacker/index.html",
        ] {
            assert!(!document_matches(
                &tauri::Url::parse(url).unwrap(),
                "index.html"
            ));
        }
    }

    #[test]
    fn windows_cannot_load_backend_files_or_remote_documents() {
        for file in [
            "../backend/src/main.js",
            "https://example.com",
            "tauri-host.js",
        ] {
            assert!(document_url(file, &Value::Null).is_err());
        }
        assert!(document_url("index.html", &json!({"theme":"dark&role=login"})).is_ok());
    }

    #[test]
    fn large_backend_response_round_trips_in_bounded_frames() {
        let expected =
            json!({"type":"response","id":9,"value":"Unicode \u{1f30e}".repeat(MAX_FRAME / 8)});
        let serialized = serde_json::to_vec(&expected).unwrap();
        assert!(serialized.len() > MAX_FRAME);
        let mut wire = Vec::new();
        for (index, chunk) in serialized.chunks(768 * 1024).enumerate() {
            let frame = json!({"type":"chunk","data":BASE64.encode(chunk),"last":(index + 1) * 768 * 1024 >= serialized.len()});
            let frame = serde_json::to_vec(&frame).unwrap();
            assert!(frame.len() < MAX_FRAME);
            wire.extend(frame);
            wire.push(b'\n');
        }
        wire.extend(b"{\"type\":\"response\",\"id\":10,\"value\":true}\n");
        let mut reader = std::io::Cursor::new(wire);
        assert_eq!(read_message(&mut reader).unwrap(), Some(expected));
        assert_eq!(read_message(&mut reader).unwrap().unwrap()["id"], 10);
        assert!(read_message(&mut reader).unwrap().is_none());
    }

    #[test]
    fn malformed_or_oversized_frames_fail_before_dispatch() {
        let mut oversized = std::io::Cursor::new(vec![b'x'; MAX_FRAME + 2]);
        assert!(read_message(&mut oversized).is_err());
        assert_eq!(oversized.position(), (MAX_FRAME + 1) as u64);
        let mut unfinished = std::io::Cursor::new(
            b"{\"type\":\"chunk\",\"data\":\"e30=\",\"last\":false}\n".to_vec(),
        );
        assert!(read_message(&mut unfinished).is_err());
    }
}
