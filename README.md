# OpenScreenwriter

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Platform: Windows](https://img.shields.io/badge/platform-Windows-lightgrey.svg)](https://github.com/mitchrnet/openscreenwriter/releases)
[![Platform: macOS](https://img.shields.io/badge/platform-macOS-lightgrey.svg)](https://github.com/mitchrnet/openscreenwriter/releases)

A minimalist Electron app for writing screenplays in [Fountain](https://fountain.io/syntax) format, with a WYSIWYG editing surface and Final Draft (FDX) export and import. Runs on Windows and macOS.

<!-- screenshot -->

---

## Features

- **WYSIWYG editor** — formatted screenplay is the editing surface; no markup visible during normal writing
- **FDX import** — open Final Draft `.fdx` files and edit them as Fountain
- **FDX export** — exports valid Final Draft 5 XML (`Ctrl+E`)
- **PDF export** — exports a print-ready PDF with proper screenplay margins, page numbers, and optional scene numbers
- **Print** — prints directly via the native OS print dialog (`Cmd/Ctrl+P`)
- **Notes / Comments** — add non-printing color-coded annotations to any selection; visible in the editor, invisible in export and PDF; persisted in a sidecar file
- **Character List** — side panel listing all named characters sorted by scene count, with click-to-jump
- **Scene Numbers** — View → Scene Numbers toggle shows numbers in the editor margin and in PDF export
- **Source Mode** — toggle raw Fountain text for direct editing (`Ctrl+Shift+M`)
- **Find & Replace** — `Cmd/Ctrl+F` to find, `Cmd/Ctrl+H` to find and replace
- **Character autocomplete** — dropdown of previously used character names when typing in a CHARACTER block
- **Smart Enter** — context-aware block creation: after a character cue creates dialogue; after dialogue continues dialogue; otherwise creates action
- **Tab cycling** — cycles the current block: Action → Scene Heading → Character → Parenthetical → Transition
- **Inline formatting** — `Ctrl+B` bold, `Ctrl+I` italic, `Ctrl+U` underline; renders live in the editor
- **Title page wizard** — GUI for title, credit, author, source, draft date, and contact fields
- **Scene navigation panel** — side panel listing all scene headings with click-to-jump
- **Pagination** — animated page-break markers at 55-line intervals; running page count in status bar
- **Autosave** — debounced write to the open file 2 seconds after you stop typing
- **Ctrl/Cmd+scroll zoom** — zoom the paper in/out; `Ctrl+0` / `Cmd+0` resets to 100%
- **Dark / Light theme** — selectable at startup, persisted across sessions
- **Open / Save / Save As** — standard file operations for `.fountain` files

---

## Download

Pre-built Windows installer available from [**GitHub Releases**](https://github.com/mitchrnet/openscreenwriter/releases).

---

## Keyboard Shortcuts

| Action             | Shortcut                  |
|--------------------|---------------------------|
| Open file          | `Cmd/Ctrl+O`              |
| Save               | `Cmd/Ctrl+S`              |
| Save As            | `Cmd/Ctrl+Shift+S`        |
| Export FDX         | `Cmd/Ctrl+E`              |
| Export PDF         | `Cmd/Ctrl+Shift+E`        |
| Print              | `Cmd/Ctrl+P`              |
| Find               | `Cmd/Ctrl+F`              |
| Find & Replace     | `Cmd/Ctrl+H`              |
| Add note           | `Cmd/Ctrl+Shift+N`        |
| Toggle Source Mode | `Cmd/Ctrl+Shift+M`        |
| Bold               | `Cmd/Ctrl+B`              |
| Italic             | `Cmd/Ctrl+I`              |
| Underline          | `Cmd/Ctrl+U`              |
| Cycle element type | `Tab`                     |
| Zoom in / out      | `Cmd/Ctrl+scroll`         |
| Reset zoom         | `Cmd/Ctrl+0`              |
| Dismiss startup    | `Escape`                  |

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

Runs on Windows and macOS.

```bash
git clone https://github.com/mitchrnet/openscreenwriter.git
cd openscreenwriter
npm install
npm start        # production build + launch
npm run dev      # watch mode + launch (faster for development)
```

**Packaging:**

```bash
npm run dist     # Windows: outputs dist/OpenScreenwriter Setup x.x.x.exe
```

---

## Changelog

See [CHANGELOG.md](CHANGELOG.md) for the full version history.

---

## Contributing

Bug reports and pull requests are welcome on [GitHub](https://github.com/mitchrnet/openscreenwriter).

For larger changes, open an issue first to discuss the approach.

---

## License

MIT © 2026 Mitchell Reid — see [LICENSE](LICENSE) for details.
