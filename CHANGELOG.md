# Changelog

### v1.2.0 — 2026-03-24

**Unsaved Changes Close Guard**
- Native OS dialog when closing a window or quitting with unsaved changes — Save, Don't Save, or Cancel
- Smart: skips the dialog when autosave is on and the file already has a path (autosave has already written every change to disk)

**Pagination Stability**
- Debounced pagination recalculation from 0ms → 60ms — rapid keystrokes now batch into a single layout pass instead of recalculating on every character
- Added fallback retry when height reporting stalls — page break decorations no longer get stuck after certain node type changes

**Recent Files**
- Last 5 opened or saved `.fountain` files now appear in the startup modal for quick access
- Persisted across sessions; missing files are silently removed from the list

---

### v1.1.2 — 2026-03-23

**Autosave**
- Debounced autosave writes to the real `.fountain` file 2 seconds after you stop typing — no more worrying about unsaved work
- Spinning "Autosaving..." animation in the status bar transitions to ✓ "Autosaved" on success
- Autosave toggle button (AS) in the toolbar next to the theme switch; also available in the View menu

**macOS improvements**
- File / Edit / Insert / View / Help menus now appear correctly on macOS (previously hidden under the app name)
- `.fountain` file association registered in the installer — set OpenScreenwriter as your default editor via Finder's "Open With"
- Opening a `.fountain` file from Finder always opens in a new window, preserving your existing document

**Window management**
- Each window independently tracks its own open document
- Added **Cmd+N / New Window** to the File menu

---

### v1.1.1 — 2026-03-22

**Developer tooling**
- Added 43 unit tests for the Fountain parser and inline markup renderer (Vitest)
- Added `npm run dev` script — esbuild in watch mode alongside Electron for faster development iteration
- Added GitHub Actions CI: unit tests run on every push; Windows installer builds automatically on merges to main

---

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

---

### v1.0.0 — 2026-02-24 *(initial release)*

- WYSIWYG Fountain editor on ProseMirror
- FDX import and export
- Title page wizard, scene navigation panel, source mode
- Dark/light theme, Ctrl+scroll zoom, smart Enter/Tab key bindings
