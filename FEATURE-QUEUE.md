# OpenScreenwriter — Feature Queue

*Managed by Axiom. Features are batched into v1.x releases — not released individually.*
*Last updated: 2026-04-02 (post-Sprint Sorkin)*

---

## How This Works

- Axiom picks the top **High** priority item and implements it as a named sprint (branch off `release/vX.Y`)
- Features accumulate on `release/vX.Y` until a milestone is ready, then merge to `main` as a versioned release
- Mitch reviews and merges; Axiom does not merge to main without approval
- Each sprint is named after a famous screenwriter (used: Wilder, Goldman, Ephron)

---

## Priority Queue

### HIGH

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
| Scene Navigator Panel | — | pre-existing |
| Character List / Statistics panel | Sprint 5 — Sorkin | v1.4.0 |
