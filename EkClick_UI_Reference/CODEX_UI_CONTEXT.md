# EkClick — UI/UX Context for Codex

## Goal
Build a polished browser extension named **EkClick** for batch-downloading Google Classroom attachments. The attached `index.html` is an interactive visual reference prototype, not production extension code. Use it for visual guidance and expected interaction patterns; do not copy placeholder/mock behavior as real download functionality.

## Product UX principles
1. **Fast by default:** the common path should take very few clicks: inspect current post, select attachments, choose a download mode if needed, start batch.
2. **Original filenames:** preserve the best available source filename and real extension. Never silently use generic labels such as `PDF` or `Video` as filenames. If the true title cannot be resolved confidently, show a warning and let the user review/rename.
3. **Batch destination workflow:** avoid prompting the user separately for every file wherever browser capabilities and user settings allow. Support browser Downloads-relative subfolders and optionally package selected files into a ZIP so the user can choose one location for the archive. Explain the constraints clearly; do not imply an extension can arbitrarily write files to any local folder without permission.
4. **Trustworthy status:** show actual queue progress, completed/failed state, clear errors, retry actions and cancellation. Do not use fake progress in production.
5. **Light / Dark / System theme:** apply consistently to popup, manager and settings; persist preference in extension storage. Respect system theme if System is chosen.
6. **Privacy and least privilege:** request only the permissions needed. Do not transmit Classroom files or account information to an external server.
7. **Accessibility:** keyboard navigation, visible focus, adequate contrast, meaningful accessible names and reduced-motion respect.

## Reference screens
### 1. Quick Download popup
- Extension brand in the header, theme toggle and settings access.
- Current class and post context with connection/scan state.
- Summary of discovered attachments and filename-recognition warnings.
- Attachment checklist; type icons, filename, useful sublabel; select all / deselect all; rename/review affordance.
- Smart destination/folder summary and Individual files / ZIP selector.
- One prominent `Download N Files` action.
- Link to full Download Manager.

### 2. Download Manager
- Search and filter by all, file type, and failed state.
- Summary cards and overall progress based on real browser download events.
- List/table with filename, type, state, percentage, and appropriate actions.
- Retry failed, pause/cancel where supported, selection, and completed/failed summary.
- Don't claim that a file is complete until the browser confirms it.

### 3. Settings
- Appearance: System / Light / Dark, optional compact density.
- Downloads: individual / ZIP default, folder template, duplicate filename behavior.
- File handling: preserve original filename, warn on generic/uncertain filenames, sanitize invalid path characters.
- Privacy & permissions: explain browser permission needs and the `Ask where to save each file` browser preference.

## Visual language
- Minimal, modern, productivity-first; avoid visual clutter.
- Light palette: off-white/white surfaces, soft neutral borders, navy text, indigo as main UI accent, green success, amber warning, red error.
- Dark palette: deep navy/charcoal surfaces, soft contrast borders, light text, accessible indigo accents.
- Rounded cards (about 12–16px), compact readable type, consistent spacing, subtle shadow, clear primary button.
- Use the actual EkClick logo asset once supplied by the project owner; until then use a simple temporary mark and do not invent a final logo.
- Keep the visible product copy in English for this prototype, while allowing future localization.

## Architecture expectations (visual context only; reconcile with repo constraints)
- Content script: detect Classroom attachment cards and extract robust metadata (display title, file type, URLs/IDs where available).
- Background service worker: queue, throttling, progress/status, retry/cancel and download API interaction.
- Popup: selection and batch start.
- Manager: longer queues and richer status.
- Settings/storage: persisted theme and user preferences.
- ZIP path: use a maintained ZIP implementation with safe streaming/memory handling for large files; do not load several large videos fully into memory.

## Technical truth / constraints
- Browser extension downloads generally use the configured Downloads directory and relative paths. Do not promise arbitrary filesystem location selection for each file unless an explicit supported API/permission path is implemented.
- ZIP mode can reduce the location picker to one archive save operation, subject to implementation and browser behavior.
- Google Docs/Sheets/Slides exports require appropriate supported export mechanisms and the user's access; don't fabricate direct-download URLs.
- Classroom's DOM is dynamic and can change; use resilient metadata extraction, test on different attachment types, and handle missing titles explicitly.
- Do not bypass access controls, permission restrictions, or Google authentication.

## Prototype behavior
`index.html` has basic screen navigation, theme toggle, selection controls, filters/search and placeholder toast messages. These are only for exploring the interaction design; no files are fetched and no real downloads occur.
