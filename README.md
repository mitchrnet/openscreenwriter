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

> **Note:** A `build/icon.ico` (256×256) is required before running `npm run dist`. See [Building from source](#building-from-source).

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

1. Place a 256×256 `.ico` file at `build/icon.ico`
2. Run:

```bash
npm run dist
```

Output: `dist/OpenScreenwriter Setup 1.0.0.exe`

---

## Contributing

Bug reports and pull requests are welcome on [GitHub](https://github.com/mitchrnet/openscreenwriter).

For larger changes, open an issue first to discuss the approach.

---

## License

MIT © 2026 Mitchell Reid — see [LICENSE](LICENSE) for details.
