fn main() {
    let manifest_dir = std::env::var("CARGO_MANIFEST_DIR").unwrap();

    // Tell the linker where to find the pdfium import lib / dylib
    println!("cargo:rustc-link-search=native={}/lib", manifest_dir);
    println!("cargo:rustc-link-search=native={}/bin", manifest_dir);
    println!("cargo:rustc-link-lib=dylib=pdfium");

    // Copy the pdfium shared library next to the output binary so it's found at runtime.
    // OUT_DIR is something like target/debug/build/tauri-app-.../out — walk up 4 levels
    // to reach target/debug (or target/release).
    let out_dir = std::env::var("OUT_DIR").unwrap();
    let mut target_dir = std::path::PathBuf::from(&out_dir);
    for _ in 0..4 { target_dir.pop(); }

    #[cfg(target_os = "windows")]
    {
        let src = format!("{}/bin/pdfium.dll", manifest_dir);
        let dst = target_dir.join("pdfium.dll");
        if std::path::Path::new(&src).exists() {
            let _ = std::fs::copy(&src, &dst);
        }
    }

    #[cfg(target_os = "macos")]
    {
        let src = format!("{}/bin/libpdfium.dylib", manifest_dir);
        let dst = target_dir.join("libpdfium.dylib");
        if std::path::Path::new(&src).exists() {
            let _ = std::fs::copy(&src, &dst);
        }
    }

    #[cfg(target_os = "linux")]
    {
        let src = format!("{}/bin/libpdfium.so", manifest_dir);
        let dst = target_dir.join("libpdfium.so");
        if std::path::Path::new(&src).exists() {
            let _ = std::fs::copy(&src, &dst);
        }
    }

    tauri_build::build()
}
