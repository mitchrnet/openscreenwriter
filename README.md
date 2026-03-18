# OpenScreenwriter

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Platform: Windows](https://img.shields.io/badge/platform-Windows-lightgrey.svg)](https://github.com/mitchrnet/openscreenwriter/releases)

A minimalist Electron app for writing screenplays in [Fountain](https://fountain.io/syntax) format, with a WYSIWYG editing surface and Final Draft (FDX) export and import.

<!-- screenshot -->

---

## Features

- **WYSIWYG editor** — formatted screenplay is the editing surface; no markup visible during normal writing
- **FDX import** — open Final Draft `.fdx` files and edit them as Fountain
- **FDX export** — exports valid Final Draft 5 XML (`Ctrl+E`)
- **Source Mode** — toggle raw Fountain text for direct editing (`Ctrl+Shift+M`)
- **Smart Enter** — context-aware block creation: after a character cue creates dialogue; after dialogue continues dialogue; otherwise creates action
- **Tab cycling** — cycles the current block: Action → Scene Heading → Character → Parenthetical → Transition
- **Inline formatting** — `Ctrl+B` bold, `Ctrl+I` italic, `Ctrl+U` underline; renders live in the editor
- **Title page wizard** — GUI for title, credit, author, source, draft date, and contact fields
- **Scene navigation panel** — side panel listing all scene headings with click-to-jump
- **Pagination** — animated page-break markers at 55-line intervals; running page count in status bar
- **Ctrl+scroll zoom** — zoom the paper in/out; `Ctrl+0` resets to 100%
- **Dark / Light theme** — selectable at startup, persisted across sessions
- **Open / Save / Save As** — standard file operations for `.fountain` files

---

## Download

Pre-built Windows installer available from [**GitHub Releases**](https://github.com/mitchrnet/openscreenwriter/releases).

---

## Keyboard Shortcuts

| Action             | Shortcut           |
|--------------------|--------------------|
| Open file          | `Ctrl+O`           |
| Save               | `Ctrl+S`           |
| Save As            | `Ctrl+Shift+S`     |
| Export FDX         | `Ctrl+E`           |
| Toggle Source Mode | `Ctrl+Shift+M`     |
| Bold               | `Ctrl+B`           |
| Italic             | `Ctrl+I`           |
| Underline          | `Ctrl+U`           |
| Cycle element type | `Tab`              |
| Zoom in / out      | `Ctrl+scroll`      |
| Reset zoom         | `Ctrl+0`           |
| Dismiss startup    | `Escape`           |

---

## Fountain Syntax Quick Reference

Source Mode accepts standard Fountain markup. The WYSIWYG editor handles most elements automatically via smart Enter / Tab, but knowing the syntax is useful when editing source directly.

| Element         | Syntax                                      |
|-----------------|---------------------------------------------|
| Scene heading   | `INT. LOCATION - DAY` (auto) or `.Forced`   |
| Action          | Any paragraph not matching another rule      |
| Character       | `ALL CAPS` before dialogue, or `@Forced`    |
| Dialogue        | Line immediately after a character cue       |
| Parenthetical   | `(beat)` within dialogue                    |
| Transition      | `> CUT TO:` (forced) or `FADE OUT.` (auto)  |
| Centered text   | `> centered text <`                         |
| Lyric           | `~ And she sang...`                         |
| Page break      | `===`                                       |
| Bold            | `**bold**`                                  |
| Italic          | `*italic*`                                  |
| Underline       | `_underline_`                               |
| Bold + italic   | `***bold italic***`                         |
| Note            | `[[This is a note]]`                        |
| Boneyard        | `/* hidden text */`                         |
| Title page      | `Title: My Script` at top of file           |

---

## Building from Source

**Prerequisites:** [Node.js](https://nodejs.org/) 18+

```bash
git clone https://github.com/mitchrnet/openscreenwriter.git
cd openscreenwriter
npm install
npm start
```

**Packaging (Windows installer):**

Run:

```bash
npm run dist
```

Output: `dist/OpenScreenwriter Setup 1.1.0.exe`

---

## Changelog

### v1.1.0 — 2026-03-17

**Layout & formatting fixes**
- Corrected paper width to 816px (8.5in at 96 dpi) — was 680px
- WGA-standard binding margins: 1.5in left, 1in top/right/bottom
- Dialogue indent corrected to 1.0in left (was 1.5in)
- Parenthetical indent corrected to 1.6in left / 1.5in right (was 1.9in / 2.1in)
- Page break markers and page number labels now bleed correctly across the 1.5in left margin

**Pagination**
- Rewrote pagination engine: ResizeObserver-based height tracking replaces manual DOM measurement — now zoom-aware and font-aware
- Every page now fills exactly 9in (864px) via bottom-padding decoration, giving a consistent fixed-height page card
- Fixed page 1 number position when no title page: now sits at 0.5in from paper top (matching pages 2+), was incorrectly at 1in
- Manual page breaks (`===`) now render as zero-height invisible atoms instead of visible `===` text

**UI**
- Side panel now slides in/out with a CSS transition instead of a hard display toggle
- Element type pill centered in toolbar via absolute positioning

### v1.0.0 — 2026-02-24 *(initial release)*

- WYSIWYG Fountain editor on ProseMirror
- FDX import and export
- Title page wizard, scene navigation panel, source mode
- Dark/light theme, Ctrl+scroll zoom, smart Enter/Tab key bindings

---

## Contributing

Bug reports and pull requests are welcome on [GitHub](https://github.com/mitchrnet/openscreenwriter).

For larger changes, open an issue first to discuss the approach.

---

## License

MIT © 2026 Mitchell Reid — see [LICENSE](LICENSE) for details.
