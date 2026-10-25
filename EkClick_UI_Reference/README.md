# EkClick UI/UX Reference

This package is a design handoff for Codex while building the EkClick browser extension.

## Files
- `index.html` — self-contained, offline-capable interactive UI reference with Quick Download, Download Manager, Settings, and Light/Dark theme controls.
- `CODEX_UI_CONTEXT.md` — requirements, design principles, screen notes, and browser/API constraints written for implementation context.

## Open the prototype
Open `index.html` in Chrome or Brave. Use the left navigation to switch screens. Use the top-right theme control to switch between Light and Dark. This prototype contains illustrative data only; its controls do not download real files.

## Using with Codex
Provide `CODEX_UI_CONTEXT.md` and `index.html` as context. Ask Codex to inspect the existing repository first, preserve its architecture where practical, and implement the UI as production components without confusing prototype interactions with actual functionality. Provide the EkClick logo asset separately when ready.

## Font rendering note
This revision uses an explicit Arial/Segoe UI/Tahoma stack instead of trying Inter first. This is intended to avoid symbol-like glyph rendering on systems with unusual local font substitution. If text is still garbled, check browser font settings or extensions that override page fonts.
