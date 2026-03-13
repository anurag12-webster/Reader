# Reader

A fast, minimal PDF reader built for people who actually read. Open papers, books, and documents — annotate them, track your progress, and pick up right where you left off.

Built with [Tauri](https://tauri.app) + React.

---

## Download

**[Download the latest release](https://github.com/anurag12-webster/Reader/releases/latest)**

| Platform | File to download |
|----------|-----------------|
| Windows (x64) | `PDF.Reader_x.x.x_x64_en-US.msi` or `PDF.Reader_x.x.x_x64-setup.exe` |
| macOS (Apple Silicon) | `PDF.Reader_x.x.x_aarch64.dmg` |
| Linux (x64) | `PDF.Reader_x.x.x_amd64.AppImage` or `PDF.Reader_x.x.x_amd64.deb` |

> **Windows**: Run the `.msi` installer.
> **macOS**: Open the `.dmg`, drag Reader to Applications. If blocked by Gatekeeper, right-click → Open.
> **Linux**: `chmod +x Reader_amd64.AppImage` then run it, or `sudo dpkg -i Reader_amd64.deb`.

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
- **pdfium**: Download the prebuilt binary for your platform from [bblanchon/pdfium-binaries](https://github.com/bblanchon/pdfium-binaries/releases) and place it in `src-tauri/bin/`:
  - Windows: `pdfium.dll`
  - macOS: `libpdfium.dylib`
  - Linux: `libpdfium.so`

### Run in development

```bash
npm install
npm run tauri dev
```

### Build for release

```bash
npm run tauri build
```

Installers output to `src-tauri/target/release/bundle/`.

---

## Tech Stack

- **Frontend**: React + TypeScript + Vite
- **Backend**: Rust (Tauri v2)
- **PDF rendering**: [pdfium-render](https://github.com/ajrcarey/pdfium-render) + [pdf.js](https://mozilla.github.io/pdf.js/)
- **Annotations**: HTML5 Canvas overlay

---

## License

MIT
