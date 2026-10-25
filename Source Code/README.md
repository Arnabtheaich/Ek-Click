# EkClick

EkClick is a Manifest V3 browser extension for finding file attachments on the open Google Classroom post and downloading them with either Brave's native Downloads API or direct writes to a selected folder. Settings and queue metadata stay in local browser storage; EkClick does not upload files.

## Install in Chrome or Brave

1. Open `chrome://extensions` or `brave://extensions` and enable **Developer mode**.
2. Choose **Load unpacked** and select this `Source Code` folder (the folder containing `manifest.json`).
3. Open or reload a signed-in Google Classroom course Stream or an individual post, material, or assignment details page, then open EkClick from the toolbar.

There is no build step or runtime dependency download.

## Choose a destination and download

1. **Selected EkClick folder** is the default destination. Choose a folder under **Download Location** and grant write access once. In Settings, choose **Project root** to save files directly there, or **EkClick/{course}/{topic}** to create that folder structure beneath it. EkClick stores the actual `FileSystemDirectoryHandle` in extension-origin IndexedDB and streams validated file bytes directly into the chosen location. Existing installs are migrated to this mode once while retaining the previously selected folder handle.
2. To use browser-managed downloads, select **Default browser location** in Settings. EkClick builds the Drive `/uc?export=download&id=...&confirm=t` URL, preserves the reviewed filename, and calls `chrome.downloads.download()` from Download Manager with the signed-in browser session. It runs one item at a time and pauses the remaining queue after the first failed download. Each new batch has an isolated ID, so old queued records cannot join a newly selected batch. The default browser location and its save-dialog preference apply; the selected EkClick folder is not used in this mode.
3. In the popup, review/select attachments and choose **Download selected**. **Individual files** creates one queue record per attachment. **ZIP archive** packages the selected attachments into one store-only archive in the chosen EkClick folder; it uses Drive's signed-in Classroom session and reports the archive as one Download Manager record. ZIP archives are available only with **Selected EkClick folder** mode. Download Manager tracks browser download progress and terminal results in Default browser location mode, or per-file/archive progress in selected-folder mode. Names that collide are uniquified by Brave or EkClick according to the active method.

Download Manager displays the combined EkClick history across Classroom pages and sessions, newest first. **Clear all** clears EkClick's local records only; it does not remove downloaded files or the browser download history. Opening the popup on a different Classroom page does not clear download history. If older browser-managed download records were removed from EkClick storage, the manager rebuilds them from the browser download history. The popup's attachment list is scoped to the currently open page.

The directory picker is feature-detected in Settings and is invoked directly from its button. Settings shows whether the actual extension page is a secure context, exposes `showDirectoryPicker`, and has IndexedDB. If the API is absent, a site permission cannot enable it and EkClick does not fall back to Downloads. Brave has reported builds where File System Access is feature-gated; inspect `brave://flags/#file-system-access-api` only if the runtime diagnostic says the picker is absent. [Chrome File System Access API](https://developer.chrome.com/docs/capabilities/web-apis/file-system-access), [Brave issue #29411](https://github.com/brave/brave-browser/issues/29411)

The browser UI could not be inspected by the coding agent in this session, so the installed Brave version and live Settings-page API values are not asserted here. The new diagnostics display those values in **Settings → Download Location → Folder picker diagnostics** after reloading the unpacked extension.

## Drive retrieval and validation

The content script discovers attachment IDs and Classroom labels. Both modes use the canonical Drive direct-download URL `https://drive.google.com/uc?export=download&id=<id>&confirm=t`, preserving a resource key and an existing `authuser` value. If the Classroom page URL is account-scoped (for example `/u/3/`), EkClick carries that account index as `authuser=3` so Drive can select the same signed-in account. Default browser location mode lets the browser retrieve the URL with its normal signed-in session. Selected EkClick folder mode first obtains optional Drive host access, fetches with the signed-in browser session and Classroom referrer, then validates and streams the response into the chosen directory. The custom-folder path checks redirects, status, MIME type, PDF signatures and an MP4 `ftyp` marker when Drive declares MP4/MOV before writing. Login, preview, denied, referrer-blocked, malformed, and untrusted redirect responses fail visibly in Download Manager; the browser-managed path flags terminal HTML/HTM downloads as failures when the browser exposes that response type.

Default browser location mode calls `chrome.downloads.download()` and tracks terminal status through `downloads.onChanged` in Download Manager. This mode uses the browser's configured location; use Selected EkClick folder mode for a chosen folder. [Chrome Downloads API](https://developer.chrome.com/docs/extensions/reference/api/downloads)

The implementation uses the currently signed-in browser session and does not add OAuth scopes or retrieve/store OAuth tokens. Google documents authenticated Drive API media downloads separately (`files.get?alt=media` and `files.export`), which require OAuth authorization; native Docs/Sheets/Slides export is not implemented here. Drive session cookies, Classroom referrer behavior, sharing policy, and Brave privacy settings can still prevent a specific download. The relevant supported API and permission guidance is in the [Drive downloads documentation](https://developers.google.com/workspace/drive/api/guides/manage-downloads) and [Chrome cross-origin request documentation](https://developer.chrome.com/docs/extensions/develop/concepts/network-requests).

## Names and discovery

EkClick flags uncertain Classroom names. A non-generic response `Content-Disposition` filename is preferred as the original server filename; a rename made in the popup takes precedence. Known file type is checked against response bytes; EkClick will not fix a mismatch by changing only the extension. Unicode, including Bangla, is preserved; invalid path characters are replaced.

Discovery supports an individual Classroom post/material/assignment page and inline attachments in rendered course Stream announcements. Stream attachments are grouped by announcement; choose one announcement in the popup before selecting files. If more posts load while scrolling, refresh EkClick after they appear. Native Google Docs editor downloads are not supported. ZIP archives require Selected EkClick folder mode and use store-only ZIP entries (no compression), with a 4 GB classic-ZIP size limit.

## Architecture

- `content.js`: discovers visible attachment links from an individual post or scopes inline Drive links to individual Stream announcement cards, with diagnostics and fallback card markers.
- `popup.js`: announcement selection, attachment selection, rename review, optional permission request, and queue creation.
- `shared/download.js`: Drive URL resolution, trusted confirmation handling, response validation, duplicate resolution, and streamed writes.
- `shared/directory-store.js`: IndexedDB persistence and read/write permission checks for the chosen directory handle.
- `background.js`: local queue state, browser Downloads API transfers and completion notifications.
- `manager.js`: processes the persisted queue and reports browser download or selected-folder progress, completion, and per-file failures.
- `settings.js`: local preferences and directory selection/permission renewal.

## Permissions and privacy

- `activeTab`, `scripting`, `downloads`: discover attachments and use browser-managed downloads.
- `storage`: save preferences and queue metadata locally.
- `https://classroom.google.com/*`: run attachment discovery on Classroom.
- Optional `drive.google.com`, `drive.usercontent.google.com`, and Googleusercontent host access: requested only for Selected EkClick folder mode, which fetches authenticated bytes itself.
- Extension-origin IndexedDB: stores the chosen directory handle. File bytes are streamed to the selected folder; large file blobs are not stored in Chrome storage or IndexedDB.

EkClick does not log full file URLs, page text, or authentication tokens and has no analytics or upload service. Queue entries for completed/skipped downloads discard their source URLs. Completed/skipped queue history can be cleared in Download Manager.

## Development checks

Requires Node.js 18+.

```sh
npm test
npm run check
```

Tests cover Stream discovery across multiple announcements, lazy-loaded Stream rescans, individual details-page discovery, Drive URL resolution, PDF/MP4 validation, confirmation and redirect handling, filename and extension handling, duplicates, directory-handle persistence/permissions, multi-file success/failure behavior, and chunked writes. Automated tests do not use a signed-in Google account and cannot confirm Google's live Classroom/Drive response behavior.

## Manual Brave verification

1. Reload the unpacked extension in `brave://extensions`, then reload the signed-in Classroom tab.
2. Open Settings, select a test folder once, and confirm its name appears. Confirm the displayed status indicates granted access.
3. To test individual post discovery, open a Classroom post with the target PDF/video attachments, refresh EkClick discovery, review names, and select the files.
4. To test Stream discovery, open a course Stream with multiple announcement cards and inline Drive attachments. Scroll until several posts have loaded, open EkClick, press **Refresh**, choose an announcement from **Choose an announcement**, and confirm only that post's attachments appear. Select one or more files and verify only those selected files enter Download Manager.
5. The default destination is **Selected EkClick folder**. Select/grant a test folder once, choose each folder template in turn, start a batch, and verify files appear directly in the selected folder or under `EkClick/<course>/<topic>` as selected.
6. To check the optional browser-managed path, change Settings to **Default browser location**. Confirm the browser receives the files and Download Manager changes each item to Completed or Failed. Check the browser Downloads page and open one PDF/video to verify its contents.

A real authenticated Brave session is required for this last check; it must be completed manually in the target account/browser.
