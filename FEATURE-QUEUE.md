# OpenScreenwriter — Feature Queue

*Managed by Axiom. Features are batched into v1.x releases — not released individually.*
*Last updated: 2026-04-01*

---

## How This Works

- Axiom picks the top **High** priority item and implements it as a named sprint (branch off `release/vX.Y`)
- Features accumulate on `release/vX.Y` until a milestone is ready, then merge to `main` as a versioned release
- Mitch reviews and merges; Axiom does not merge to main without approval
- Each sprint is named after a famous screenwriter (used: Wilder, Goldman, Ephron)

---

## Priority Queue

### HIGH

#### Scene Navigator Panel
- **Description:** Sidebar panel listing all scene headings in document order. Click to jump. Drag to reorder scenes (reorders the underlying ProseMirror nodes).
- **Acceptance criteria:**
  - Panel shows all `scene_heading` nodes in order, updating live as document changes
  - Click scrolls editor to that scene
  - Drag-to-reorder moves the full scene block (heading + content until next heading)
  - Panel toggle via keyboard shortcut and View menu
- **Status:** Pending

#### Live Page Count
- **Description:** Accurate running page count shown in toolbar/footer. Not an approximation — uses real text measurement.
- **Acceptance criteria:**
  - Page count updates on every edit
  - Matches industry standard (1 page ≈ 55 lines of action, roughly 1 min of screen time)
  - Survives zoom level changes
  - Does not require a visible rendered area to compute
- **Notes:** `pretext` library (canvas-based DOM-free measurement) is the recommended approach. Research spike needed before implementation.
- **Status:** Pending

#### Auto Scene Numbering
- **Description:** Scene headings display auto-incrementing numbers (e.g., `1.`, `2.`) as decorations — not embedded in the text, so they don't export to Fountain unless explicitly toggled.
- **Acceptance criteria:**
  - Numbers render as ProseMirror decorations, not document content
  - Numbers update live as scenes are added/removed/reordered
  - Toggle on/off via View menu
  - Export to PDF includes numbers when toggle is on
- **Status:** Pending

---

### MEDIUM

#### Character List / Statistics
- **Description:** Panel or modal showing all unique character names in the script, scene count per character, line count.
- **Acceptance criteria:**
  - Derived from document content, updates live
  - Sortable by name / scene count
  - Click character name to jump to first appearance
- **Status:** Pending

#### Notes / Comments (Non-Printing Annotations)
- **Description:** Attach color-coded notes to text ranges. Notes are visible in editor but don't export to PDF or Fountain.
- **Acceptance criteria:**
  - Select text → add note via keyboard shortcut or right-click
  - Notes stored as ProseMirror decorations (position-mapped through edits)
  - Notes panel shows all annotations with context
  - Notes survive save/reload (serialized alongside document)
- **Status:** Pending

#### Export to PDF (Improved)
- **Description:** Improve the current PDF export to correctly handle title page, scene numbers (if toggled), and ensure proper formatting margins.
- **Acceptance criteria:**
  - Title page renders correctly
  - Scene numbers appear if toggle is on
  - Standard screenplay margins (1.5" left, 1" all others)
  - Page breaks match editor pagination
- **Status:** Pending (title page and basic margin fixes shipped in Sprint Ephron v1.3.0; scene numbers and page-break alignment still open)

---

### LOW / BACKLOG

#### Revision Mode
- **Description:** Track changes mode — mark revised content with asterisks in the right margin (industry standard revision marks).
- **Status:** Backlog

#### Collaboration (Read-Only Share Link)
- **Description:** Share a link that opens a read-only view of the current document state.
- **Status:** Backlog — requires server infrastructure

#### Mobile / iPad Support
- **Description:** Responsive layout for tablet viewing (not editing — ProseMirror + contenteditable on mobile is a known problem).
- **Status:** Backlog

---

## Completed (Shipped)

| Feature | Sprint | Release |
|---------|--------|---------|
| Core screenplay formatting (scene heading, action, character, dialogue, parenthetical, transition) | Sprint 2 — Wilder | v1.1.0 |
| Fountain import/export | Sprint 2 — Wilder | v1.1.0 |
| FDX import/export | Sprint 3 — Goldman | v1.2.0 |
| Autosave + close guard | Sprint 3 — Goldman | v1.2.0 |
| Recent files | Sprint 3 — Goldman | v1.2.0 |
| Pagination (visual page breaks) | Sprint 3 — Goldman | v1.2.0 |
| Find & Replace (Cmd+F/H) | Sprint 3 — Goldman | v1.3.0 |
| Character autocomplete | Sprint 3 — Goldman | v1.3.0 |
| Context menu copy/cut fix | Sprint 3 — Goldman | v1.3.0 |
| Title Page wizard + side panel | Sprint 4 — Ephron | v1.3.0 |
| Print support (Cmd+P) | Sprint 4 — Ephron | v1.3.0 |
| Title page in PDF export | Sprint 4 — Ephron | v1.3.0 |
