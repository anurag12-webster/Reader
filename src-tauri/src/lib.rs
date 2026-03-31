use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::Manager;
use tauri_plugin_updater::UpdaterExt;

// ── PDFium binding ────────────────────────────────────────────────────────────

fn bind_pdfium() -> Option<pdfium_render::prelude::Pdfium> {
    use pdfium_render::prelude::*;
    let lib_name = if cfg!(windows) { "pdfium.dll" }
        else if cfg!(target_os = "macos") { "libpdfium.dylib" }
        else { "libpdfium.so" };

    let mut candidates: Vec<PathBuf> = Vec::new();

    // 1. Beside the executable (Windows, macOS, bundled Linux)
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            candidates.push(dir.join(lib_name));
        }
    }

    // 2. AppImage / squashfs (Linux AppImage)
    if let Ok(appdir) = std::env::var("APPDIR") {
        let base = PathBuf::from(&appdir);
        candidates.push(base.join("usr").join("lib").join(lib_name));
        candidates.push(base.join(lib_name));
    }

    // 3. ../lib relative to exe (some Tauri Linux .deb layouts)
    if let Ok(exe) = std::env::current_exe() {
        if let Some(parent) = exe.parent().and_then(|p| p.parent()) {
            candidates.push(parent.join("lib").join(lib_name));
        }
    }

    let binding = candidates.into_iter()
        .filter(|p| p.exists())
        .find_map(|lib| Pdfium::bind_to_library(&lib).ok())
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
    recents.truncate(50); // keep last 50
    save_recents(&app, &recents);
}

#[tauri::command]
fn remove_recent(app: tauri::AppHandle, path: String) {
    let mut recents = load_recents(&app);
    recents.retain(|r| r.path != path);
    save_recents(&app, &recents);
}

// ── PDF open ──────────────────────────────────────────────────────────────────

#[derive(Serialize, Clone)]
pub struct OutlineItem {
    pub title: String,
    pub dest: String,   // "__p__N" where N is 1-based page number
    pub items: Vec<OutlineItem>,
}

#[derive(Serialize)]
pub struct OpenedPdf {
    pub data: String,
    pub title: Option<String>,
    pub urls: Vec<String>,
    pub outline: Vec<OutlineItem>,
}

/// Opens a PDF: reads bytes on a blocking thread, extracts title + URLs (pdfium is CPU-bound),
/// returns base64 data. URL extraction is skipped if already cached (non-empty).
#[tauri::command]
async fn open_pdf(app: tauri::AppHandle, path: String) -> Result<OpenedPdf, String> {
    // Check cache first (fast, no blocking needed)
    let cached_urls = {
        let lib = load_library(&app);
        lib.artifact_urls.get(&path)
            .filter(|v| !v.is_empty())
            .cloned()
    };

    let path_clone = path.clone();
    let has_cache = cached_urls.is_some();

    // Offload all blocking IO + pdfium work to a dedicated thread pool thread
    // so Tauri's async runtime is never stalled
    let (data, title, urls, outline) = tokio::task::spawn_blocking(move || {
        use base64::Engine;
        let bytes = fs::read(&path_clone).map_err(|e| e.to_string())?;
        let data = base64::engine::general_purpose::STANDARD.encode(&bytes);
        let title = extract_pdf_title(&path_clone);
        let urls = if has_cache {
            vec![] // will be replaced by cached_urls below
        } else {
            extract_pdf_urls(&path_clone)
        };
        let outline = extract_pdf_outline(&path_clone);
        Ok::<_, String>((data, title, urls, outline))
    })
    .await
    .map_err(|e| e.to_string())??;

    // Use cache if available, otherwise use freshly extracted + persist
    let final_urls = if let Some(cached) = cached_urls {
        cached
    } else {
        // Persist the newly extracted URLs without touching other library data
        let mut lib = load_library(&app);
        if !urls.is_empty() || !lib.artifact_urls.contains_key(&path) {
            lib.artifact_urls.insert(path.clone(), urls.clone());
            let lib_path = library_path(&app);
            let _ = fs::create_dir_all(lib_path.parent().unwrap());
            if let Ok(json) = serde_json::to_vec_pretty(&lib) {
                let _ = fs::write(lib_path, json);
            }
        }
        urls
    };

    Ok(OpenedPdf { data, title, urls: final_urls, outline })
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
        // PDF annotation links (most reliable — these are actual hyperlinks)
        for link in page.links().iter() {
            if let Some(PdfAction::Uri(uri)) = link.action() {
                if let Ok(u) = uri.uri() { add(&u); }
            }
        }
        // Plain text URL extraction (catches URLs not wrapped in link annotations)
        if let Ok(text) = page.text() {
            for m in url_re.find_iter(&text.all()) { add(m.as_str()); }
        }
    }
    urls
}

// ── Outline extraction ────────────────────────────────────────────────────────

fn extract_pdf_outline(path: &str) -> Vec<OutlineItem> {
    let Some(pdfium) = bind_pdfium() else { return vec![] };
    let Ok(doc) = pdfium.load_pdf_from_file(path, None) else { return vec![] };

    // Regex patterns for academic section headings
    // Matches: "1 Introduction", "2.3 Method", "A Appendix", "Abstract", "References", etc.
    let numbered = regex::Regex::new(
        r"(?x)^
        (\d+(\.\d+)*)   # e.g. 1, 2.3, 4.1.2
        [\s\.\:]+
        ([A-Z][^\n]{1,60})  # heading text
        $"
    ).unwrap();
    let unnumbered = regex::Regex::new(
        r"^(Abstract|Introduction|Conclusion|Conclusions|References|Acknowledgements?|Appendix|Related Work|Background|Methodology|Experiments?|Results?|Discussion|Future Work|Overview|Summary)$"
    ).unwrap();

    let mut items: Vec<OutlineItem> = Vec::new();
    let mut seen_titles = std::collections::HashSet::new();

    for (page_idx, page) in doc.pages().iter().enumerate() {
        let page_num = page_idx + 1;
        let Ok(text_obj) = page.text() else { continue };
        let text = text_obj.all();

        for line in text.lines() {
            let line = line.trim();
            if line.is_empty() || line.len() > 80 { continue; }

            let heading = if let Some(caps) = numbered.captures(line) {
                let section = caps.get(1).map_or("", |m| m.as_str());
                let title = caps.get(3).map_or("", |m| m.as_str()).trim();
                let depth = section.chars().filter(|&c| c == '.').count();
                Some((format!("{} {}", section, title), depth))
            } else if unnumbered.is_match(line) {
                Some((line.to_string(), 0))
            } else {
                None
            };

            if let Some((title, depth)) = heading {
                if seen_titles.contains(&title) { continue; }
                seen_titles.insert(title.clone());

                let item = OutlineItem {
                    title,
                    dest: format!("__p__{}", page_num),
                    items: vec![],
                };

                if depth == 0 {
                    items.push(item);
                } else {
                    // nest under last top-level section
                    if let Some(parent) = items.last_mut() {
                        parent.items.push(item);
                    } else {
                        items.push(item);
                    }
                }
            }
        }
    }

    items
}

// ── Thumbnail ─────────────────────────────────────────────────────────────────

/// Renders the first page of a PDF as a PNG thumbnail.
/// Runs on a blocking thread since pdfium rendering is CPU-bound.
#[tauri::command]
async fn get_thumbnail(path: String, width: u32) -> Result<String, String> {
    tokio::task::spawn_blocking(move || {
        use pdfium_render::prelude::*;
        use base64::Engine;
        use image::ImageEncoder;

        let pdfium = bind_pdfium().ok_or("pdfium not available")?;
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

        let rgba = bitmap.into_rgba8();
        let (w, h) = (rgba.width(), rgba.height());
        let mut png: Vec<u8> = Vec::new();
        image::codecs::png::PngEncoder::new(&mut png)
            .write_image(rgba.as_raw(), w, h, image::ColorType::Rgba8.into())
            .map_err(|e| e.to_string())?;

        Ok(format!("data:image/png;base64,{}", base64::engine::general_purpose::STANDARD.encode(&png)))
    })
    .await
    .map_err(|e| e.to_string())?
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

// ── App settings ──────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppSettings {
    #[serde(rename = "defaultZoom", default = "default_zoom")]
    pub default_zoom: f32,
    #[serde(rename = "defaultTheme", default = "default_theme")]
    pub default_theme: String,
    #[serde(rename = "defaultLayout", default = "default_layout")]
    pub default_layout: String,
    #[serde(rename = "showThumbnails", default = "default_true")]
    pub show_thumbnails: bool,
}

fn default_zoom() -> f32 { 1.5 }
fn default_theme() -> String { "classic".into() }
fn default_layout() -> String { "single".into() }
fn default_true() -> bool { true }

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            default_zoom: default_zoom(),
            default_theme: default_theme(),
            default_layout: default_layout(),
            show_thumbnails: default_true(),
        }
    }
}

fn settings_path(app: &tauri::AppHandle) -> PathBuf {
    app.path().app_data_dir().expect("no app data dir").join("settings.json")
}

#[tauri::command]
fn get_settings(app: tauri::AppHandle) -> AppSettings {
    fs::read(settings_path(&app))
        .ok()
        .and_then(|b| serde_json::from_slice(&b).ok())
        .unwrap_or_default()
}

#[tauri::command]
fn save_settings(app: tauri::AppHandle, settings: AppSettings) {
    let path = settings_path(&app);
    let _ = fs::create_dir_all(path.parent().unwrap());
    if let Ok(json) = serde_json::to_vec_pretty(&settings) {
        let _ = fs::write(path, json);
    }
}

// ── arXiv title fetch ─────────────────────────────────────────────────────────

#[tauri::command]
async fn fetch_arxiv_title(arxiv_id: String) -> Result<String, String> {
    let url = format!("https://export.arxiv.org/api/query?id_list={}&max_results=1", arxiv_id);
    let body = reqwest::get(&url)
        .await
        .map_err(|e| e.to_string())?
        .text()
        .await
        .map_err(|e| e.to_string())?;
    body.split("<title>")
        .nth(2)
        .and_then(|chunk| chunk.split("</title>").next())
        .map(|t| t.replace('\n', " ").split_whitespace().collect::<Vec<_>>().join(" "))
        .ok_or_else(|| "title not found".to_string())
}

// ── Update check ──────────────────────────────────────────────────────────────

#[derive(Serialize)]
pub struct UpdateCheckResult {
    pub up_to_date: bool,
    pub latest_version: String,
    pub release_url: String,
}

/// Compares semver strings like "1.2.3" — returns true if `latest` > `current`.
fn is_newer(current: &str, latest: &str) -> bool {
    let parse = |s: &str| -> (u64, u64, u64) {
        let mut parts = s.trim_start_matches('v').splitn(4, '.');
        let major = parts.next().and_then(|x| x.parse().ok()).unwrap_or(0);
        let minor = parts.next().and_then(|x| x.parse().ok()).unwrap_or(0);
        let patch = parts.next().and_then(|x| x.parse().ok()).unwrap_or(0);
        (major, minor, patch)
    };
    parse(latest) > parse(current)
}

#[tauri::command]
async fn check_for_update() -> Result<UpdateCheckResult, String> {
    const CURRENT: &str = env!("CARGO_PKG_VERSION");
    const RELEASES_URL: &str = "https://github.com/anurag12-webster/Reader/releases/latest";
    const API_URL: &str = "https://api.github.com/repos/anurag12-webster/Reader/releases/latest";

    let client = reqwest::Client::builder()
        .user_agent(concat!("PDF-Reader/", env!("CARGO_PKG_VERSION")))
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| e.to_string())?;

    let response = client
        .get(API_URL)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    // Parse the JSON body as text first, then parse with serde_json for full control
    let body = response.text().await.map_err(|e| e.to_string())?;
    let resp: serde_json::Value = serde_json::from_str(&body).map_err(|e| e.to_string())?;

    let tag = resp["tag_name"]
        .as_str()
        .ok_or_else(|| "GitHub API returned no tag_name".to_string())?;

    let latest = tag.trim_start_matches('v').to_string();

    Ok(UpdateCheckResult {
        up_to_date: !is_newer(CURRENT, &latest),
        latest_version: latest,
        release_url: RELEASES_URL.to_string(),
    })
}

#[tauri::command]
async fn install_update(app: tauri::AppHandle) -> Result<(), String> {
    let updater = app.updater().map_err(|e| e.to_string())?;
    let update = updater.check().await.map_err(|e| e.to_string())?;
    if let Some(update) = update {
        update.download_and_install(|_, _| {}, || {}).await.map_err(|e| e.to_string())?;
        app.restart();
    }
    Ok(())
}

// ── Entry point ───────────────────────────────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            get_recents,
            add_recent,
            remove_recent,
            open_pdf,
            get_thumbnail,
            fetch_arxiv_title,
            get_library,
            save_library,
            get_settings,
            save_settings,
            check_for_update,
            install_update,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
