# Reader

**A fast, distraction-free PDF reader built for people who actually read.**

Open papers, textbooks, and docs. Annotate them. Track your progress. Pick up exactly where you left off. No cloud. No accounts. No bloat.

[**Download for Windows or Linux →**](https://github.com/anurag12-webster/Reader/releases/latest)

---

## Why Reader?

Most PDF readers are either too heavy (Acrobat), too bare-bones (browser built-ins), or designed for casual viewing — not serious reading. Reader is built for researchers, students, and anyone who reads long documents and wants to stay focused.

- Reads fast even on large PDFs
- Stays out of your way while reading
- Remembers everything — your position, annotations, progress
- Works fully offline, no account needed

---

## Features

### Reading
- **Multiple layouts** — single page, side-by-side spread, or continuous scroll
- **Smooth zoom** — Ctrl+scroll with instant visual feedback, no lag
- **Rotation** — rotate pages left or right
- **Themes** — Classic (light), Dark, Warm, and Blue night modes
- **Reading defaults** — set your preferred zoom, theme, and layout once; applied to every file you open

### Annotations
- **Highlight** — select text and mark it in yellow
- **Underline** — draw underlines across any region
- **Sticky notes** — drop a note anywhere on the page
- All annotations are saved automatically and persist across sessions

### Organization
- **Tabs** — open multiple PDFs side by side
- **Library** — all your recent files in one place, organized into folders
- **Progress tracking** — mark pages as read, see your completion per document
- **Thumbnails** — visual previews in the library (can be disabled for performance)

### Navigation
- **Document outline** — table of contents sidebar for fast chapter jumping
- **Page input** — jump to any page directly
- **Keyboard shortcuts** — navigate without touching the mouse

### Extras
- **Artifact panel** — automatically extracts every URL and link from a PDF
- **Settings page** — dedicated tab for all preferences
- **Update checker** — check for new versions from inside the app

---

## Download

**[Latest release](https://github.com/anurag12-webster/Reader/releases/latest)**

| Platform | Installer |
|----------|-----------|
| Windows (x64) | `PDF.Reader_x64_en-US.msi` — recommended |
| Windows (x64) | `PDF.Reader_x64-setup.exe` — portable |
| Linux (x64) | `PDF.Reader_amd64.AppImage` — no install needed |
| Linux (x64) | `PDF.Reader_amd64.deb` — for Debian/Ubuntu |

### Installation notes

**Windows** — Run the `.msi` or `.exe` installer and launch Reader from the Start menu.

**Linux (AppImage)**
```bash
chmod +x Reader_amd64.AppImage
./Reader_amd64.AppImage
```

**Linux (deb)**
```bash
sudo dpkg -i Reader_amd64.deb
```

---

## Keyboard Shortcuts

| Action | Shortcut |
|--------|----------|
| Next page | `→` or `Space` |
| Previous page | `←` |
| Zoom in | `Ctrl +` or `Ctrl Scroll Up` |
| Zoom out | `Ctrl -` or `Ctrl Scroll Down` |
| Reset zoom | `Ctrl 0` |
| Horizontal scroll | `Shift Scroll` |

---

## Building from Source

### Prerequisites

- [Node.js](https://nodejs.org) 18+
- [Rust](https://rustup.rs) stable

**pdfium** — download the prebuilt binary for your platform from [bblanchon/pdfium-binaries](https://github.com/bblanchon/pdfium-binaries/releases) and place it in `src-tauri/bin/`:

| Platform | File |
|----------|------|
| Windows | `pdfium.dll` |
| Linux | `libpdfium.so` |

### Development

```bash
npm install
npm run tauri dev
```

### Production build

```bash
npm run tauri build
```

Output is in `src-tauri/target/release/bundle/`.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| UI | React 18 + TypeScript + Vite |
| Desktop shell | Tauri v2 (Rust) |
| PDF rendering | pdfium-render (Rust) + pdf.js |
| Annotations | HTML5 Canvas |
| Persistence | JSON files in app data dir |

---

## Contributing

Bug reports and pull requests are welcome. Open an issue to discuss changes before submitting a PR.

---

## License

MIT
