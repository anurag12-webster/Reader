use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::Manager;

fn bind_pdfium() -> Option<pdfium_render::prelude::Pdfium> {
    use pdfium_render::prelude::*;
    let lib_name = if cfg!(windows) { "pdfium.dll" }
        else if cfg!(target_os = "macos") { "libpdfium.dylib" }
        else { "libpdfium.so" };
    let binding = std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|d| d.join(lib_name)))
        .filter(|lib| lib.exists())
        .and_then(|lib| Pdfium::bind_to_library(&lib).ok())
        .or_else(|| Pdfium::bind_to_system_library().ok())?;
    Some(Pdfium::new(binding))
}

// ── Recent files ──────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RecentFile {
    pub path: String,
    pub name: String,
    #[serde(rename = "openedAt")]
    pub opened_at: u64,
}

fn recents_path(app: &tauri::AppHandle) -> PathBuf {
    app.path().app_data_dir().expect("no app data dir").join("recents.json")
}

fn load_recents(app: &tauri::AppHandle) -> Vec<RecentFile> {
    fs::read(recents_path(app))
        .ok()
        .and_then(|b| serde_json::from_slice(&b).ok())
        .unwrap_or_default()
}

fn save_recents(app: &tauri::AppHandle, recents: &[RecentFile]) {
    let path = recents_path(app);
    let _ = fs::create_dir_all(path.parent().unwrap());
    if let Ok(json) = serde_json::to_vec_pretty(recents) {
        let _ = fs::write(path, json);
    }
}

#[tauri::command]
fn get_recents(app: tauri::AppHandle) -> Vec<RecentFile> {
    load_recents(&app)
}

#[tauri::command]
fn add_recent(app: tauri::AppHandle, path: String, name: String) {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64;
    let mut recents = load_recents(&app);
    recents.retain(|r| r.path != path);
    recents.insert(0, RecentFile { path, name, opened_at: now });
    save_recents(&app, &recents);
}

#[tauri::command]
fn remove_recent(app: tauri::AppHandle, path: String) {
    let mut recents = load_recents(&app);
    recents.retain(|r| r.path != path);
    save_recents(&app, &recents);
}

// ── PDF open ──────────────────────────────────────────────────────────────────

#[derive(Serialize)]
pub struct OpenedPdf {
    pub data: String,
    pub title: Option<String>,
    pub urls: Vec<String>,
}

#[tauri::command]
fn open_pdf(app: tauri::AppHandle, path: String) -> Result<OpenedPdf, String> {
    use base64::Engine;
    let bytes = fs::read(&path).map_err(|e| e.to_string())?;
    let data = base64::engine::general_purpose::STANDARD.encode(&bytes);
    let title = extract_pdf_title(&path);

    let mut lib = load_library(&app);
    let urls = if let Some(cached) = lib.artifact_urls.get(&path) {
        cached.clone()
    } else {
        let extracted = extract_pdf_urls(&path);
        lib.artifact_urls.insert(path.clone(), extracted.clone());
        let lib_path = library_path(&app);
        let _ = fs::create_dir_all(lib_path.parent().unwrap());
        if let Ok(json) = serde_json::to_vec_pretty(&lib) { let _ = fs::write(lib_path, json); }
        extracted
    };

    Ok(OpenedPdf { data, title, urls })
}

fn extract_pdf_title(path: &str) -> Option<String> {
    use pdfium_render::prelude::*;
    let pdfium = bind_pdfium()?;
    let doc = pdfium.load_pdf_from_file(path, None).ok()?;
    if let Some(tag) = doc.metadata().get(PdfDocumentMetadataTagType::Title) {
        let s = tag.value().trim().to_string();
        if !s.is_empty() { return Some(s); }
    }
    let page = doc.pages().get(0).ok()?;
    let text = page.text().ok()?;
    text.all()
        .lines()
        .map(|l| l.trim())
        .find(|l| l.len() > 8)
        .map(|l| l.chars().take(120).collect())
}

fn extract_pdf_urls(path: &str) -> Vec<String> {
    use pdfium_render::prelude::*;
    let Some(pdfium) = bind_pdfium() else { return vec![] };
    let Ok(doc) = pdfium.load_pdf_from_file(path, None) else { return vec![] };

    let url_re = regex::Regex::new(r#"https?://[^\s\]\[(){}<>"'\\,;]+"#).unwrap();
    let clean = |s: &str| s.trim_end_matches(|c: char| ".,;:)]}>'\"".contains(c)).to_string();

    let mut seen = std::collections::HashSet::new();
    let mut urls: Vec<String> = Vec::new();
    let mut add = |raw: &str| {
        let u = clean(raw);
        if u.len() > 10 && seen.insert(u.clone()) { urls.push(u); }
    };

    for page in doc.pages().iter() {
        for link in page.links().iter() {
            if let Some(PdfAction::Uri(uri)) = link.action() {
                if let Ok(u) = uri.uri() { add(&u); }
            }
        }
        if let Ok(text) = page.text() {
            for m in url_re.find_iter(&text.all()) { add(m.as_str()); }
        }
    }
    urls
}

// ── Thumbnail ─────────────────────────────────────────────────────────────────

#[tauri::command]
fn get_thumbnail(path: String, width: u32) -> Result<String, String> {
    use pdfium_render::prelude::*;
    use base64::Engine;

    let pdfium = bind_pdfium().ok_or("pdfium not found")?;
    let doc = pdfium.load_pdf_from_file(&path, None).map_err(|e| e.to_string())?;
    let page = doc.pages().get(0).map_err(|e| e.to_string())?;

    let scale = width as f32 / page.width().value;
    let h = (page.height().value * scale).round() as u32;
    let bitmap = page
        .render_with_config(
            &PdfRenderConfig::new()
                .set_target_width(width as i32)
                .set_target_height(h as i32)
                .rotate_if_landscape(PdfPageRenderRotation::None, false),
        )
        .map_err(|e| e.to_string())?
        .as_image();

    use image::ImageEncoder;
    let rgba = bitmap.into_rgba8();
    let (w, h) = (rgba.width(), rgba.height());
    let mut png: Vec<u8> = Vec::new();
    image::codecs::png::PngEncoder::new(&mut png)
        .write_image(rgba.as_raw(), w, h, image::ColorType::Rgba8.into())
        .map_err(|e| e.to_string())?;

    Ok(format!("data:image/png;base64,{}", base64::engine::general_purpose::STANDARD.encode(&png)))
}

// ── Library store ─────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct Folder {
    pub id: String,
    pub name: String,
    #[serde(rename = "createdAt")]
    pub created_at: u64,
    #[serde(rename = "filePaths")]
    pub file_paths: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct LibraryStore {
    #[serde(rename = "completedPaths", default)]
    pub completed_paths: Vec<String>,
    #[serde(default)]
    pub folders: Vec<Folder>,
    #[serde(rename = "readPages", default)]
    pub read_pages: std::collections::HashMap<String, Vec<u32>>,
    #[serde(rename = "artifactUrls", default)]
    pub artifact_urls: std::collections::HashMap<String, Vec<String>>,
    #[serde(default)]
    pub annotations: std::collections::HashMap<String, serde_json::Value>,
}

fn library_path(app: &tauri::AppHandle) -> PathBuf {
    app.path().app_data_dir().expect("no app data dir").join("library.json")
}

fn load_library(app: &tauri::AppHandle) -> LibraryStore {
    fs::read(library_path(app))
        .ok()
        .and_then(|b| serde_json::from_slice(&b).ok())
        .unwrap_or_default()
}

#[tauri::command]
fn get_library(app: tauri::AppHandle) -> LibraryStore {
    load_library(&app)
}

#[tauri::command]
fn save_library(app: tauri::AppHandle, store: LibraryStore) {
    let path = library_path(&app);
    let _ = fs::create_dir_all(path.parent().unwrap());
    if let Ok(json) = serde_json::to_vec_pretty(&store) {
        let _ = fs::write(path, json);
    }
}

// ── arXiv title fetch ─────────────────────────────────────────────────────────

#[tauri::command]
fn fetch_arxiv_title(arxiv_id: String) -> Result<String, String> {
    let url = format!("https://export.arxiv.org/api/query?id_list={}&max_results=1", arxiv_id);
    let body = reqwest::blocking::get(&url)
        .map_err(|e| e.to_string())?
        .text()
        .map_err(|e| e.to_string())?;
    body.split("<title>")
        .nth(2)
        .and_then(|chunk| chunk.split("</title>").next())
        .map(|t| t.replace('\n', " ").split_whitespace().collect::<Vec<_>>().join(" "))
        .ok_or_else(|| "title not found".to_string())
}

// ── Entry point ───────────────────────────────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![
            get_recents,
            add_recent,
            remove_recent,
            open_pdf,
            get_thumbnail,
            fetch_arxiv_title,
            get_library,
            save_library,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
