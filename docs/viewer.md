# Viewer implementation and verification

Implemented against `Features.clarified.drawio` page 06 and `PRD/viewer-corrections.md`, with the original PDF's text zoom controls retained.

Opening a library file, chat evidence link, or file URL starts with current saved text. Original and initial extraction remain separate tabs. Photos support zoom; React-PDF/PDF.js provides PDF pages, zoom, selectable text, and load errors. Text and editor font size are adjustable. Original imported/entered text is served from preserved source bytes.

The editor saves text and the four classifications through the existing revision-checked manual-save endpoint. Failed saves retain the draft. Leaving for another file, browser navigation, phone Back, Cancel, and Recheck use Save/discard/stay choices. Reload/tab close uses the browser's unsaved-work warning. Saving refreshes library/index data and preserves source, initial extraction, unchanged classification evidence, and unresolved candidates.

`POST /api/files/{id}/recheck` requires processing consent and the displayed saved revision. It checks server-saved text only, without extracting again or reclassifying. A concurrent write or deletion rejects the check result. Success replaces concerns; a provider failure records failure and retains previous concerns/check revision. Text edits make earlier results stale; metadata-only edits retain text warnings. Opening a file never requests a check.

Chat shows the document context and attaches the backend's saved text, archive identity, classifications, provenance, and warnings when sending a question. Unsaved drafts are excluded. Context remains available after phone Back and resolves against current library data, including deletion. Member filtering still applies: an out-of-scope document displays a notice to change the chat member filter. Other records continue to use metadata-first retrieval.

## Automated verification

- `backend/test_viewer.py`: no checking on open/save, source preservation, metadata-only checks, unresolved candidates, stale results, failed check/retry, consent, revision validation, concurrent edit/deletion.
- `backend/test_chat.py`: server-read saved viewer context, provenance, and existing member-scope restrictions.
- `tests/viewer.spec.ts`: saved-text-first navigation, source/initial comparison, text zoom, unsaved choices, failed Save/retry, Recheck choices/failure, Chinese UI, browser/phone Back, correct save target, chat context, PDF pages/selectable text, and photo zoom. Runs in desktop and phone projects.
- Existing library and chat regression suites, TypeScript production build, and ESLint.

UI tests use synthetic records and mocked HTTP responses; backend tests use SQLite and mocked AI results. PDF rendering uses the repository's diagram PDF. Desktop/phone PDF and unsaved-dialog screenshots are produced under `test-results/` for visual review. These checks do not establish OCR quality or medical correctness. Prepared medical-document acceptance, live provider behavior, an actual phone, and Linux deployment verification remain outstanding.
