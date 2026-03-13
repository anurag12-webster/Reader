# Reader

A fast, minimal PDF reader built for people who actually read. Open papers, books, and documents — annotate them, track your progress, and pick up right where you left off.

Built with [Tauri](https://tauri.app) + React.

---

## Download

Go to the [Releases](https://github.com/anurag12-webster/Reader/releases/latest) page and grab the installer for your platform:

| Platform | File |
|----------|------|
| Windows  | `Reader_x64_en-US.msi` or `Reader_x64-setup.exe` |
| macOS    | `Reader.dmg` |
| Linux    | `Reader_amd64.AppImage` or `Reader_amd64.deb` |

> **Windows**: Run the `.msi` or `.exe` installer.
> **macOS**: Open the `.dmg`, drag the app to Applications.
> **Linux**: Make the `.AppImage` executable (`chmod +x`) and run it, or install the `.deb`.

---

## Features

- Open multiple PDFs in tabs
- Highlight, underline, and add sticky notes — all persisted across sessions
- Track which pages you've read with a one-click read marker
- Document outline (table of contents) in the sidebar
- Thumbnail previews and recently opened files on the home screen
- Artifact panel — automatically extracts all URLs and links from a PDF
- Multiple zoom levels, page layouts (single/spread), and rotation
- Dark, light, and sepia themes
- Keyboard shortcuts: arrow keys to page through, `Ctrl +/-` to zoom

---

## Building from Source

### Prerequisites

- [Node.js](https://nodejs.org) 18+
- [Rust](https://rustup.rs) (stable)
- Tauri CLI: `npm install -g @tauri-apps/cli`
- **pdfium**: Download the prebuilt pdfium binary for your platform and place it in `src-tauri/bin/`:
  - Windows: `pdfium.dll`
  - macOS: `libpdfium.dylib`
  - Linux: `libpdfium.so`

  Prebuilt binaries are available at [bblanchon/pdfium-binaries](https://github.com/bblanchon/pdfium-binaries/releases).

### Run in development

```bash
npm install
npm run tauri dev
```

### Build for release

```bash
npm run tauri build
```

Installers will be output to `src-tauri/target/release/bundle/`.

---

## Tech Stack

- **Frontend**: React + TypeScript + Vite
- **Backend**: Rust (Tauri v2)
- **PDF rendering**: [pdfium-render](https://github.com/ajrcarey/pdfium-render) + [pdf.js](https://mozilla.github.io/pdf.js/)
- **Annotations**: HTML5 Canvas overlay

---

## License

MIT
