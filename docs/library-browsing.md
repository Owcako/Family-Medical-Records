# Library browsing implementation

Implemented against `PRD/library-browsing.md` and pages 02, 03 and 05 of `Features.clarified.drawio`.

`src/library/LibraryBrowser.tsx` renders Member, Date, Department and Disease views over the existing `/api/files` response. `browsing.ts` handles group membership, profile/name/alias filtering and attention indicators. All placements open the existing file identity; no file is copied or merged. The existing viewer handles saved text, original sources, classification corrections, recovery and confirmed deletion through the existing API and SQLite storage.

The member filter contains managed profiles, including those with no records. Confirmed exact name/alias matches share one canonical member branch. A detected name without a match stays Unassigned and prompts for “Mistake — modify text” or “New member”; Review later preserves it for later review. Mistakes open the saved-text editor with patient-name correction guidance. New member opens a creation-only form, prefilled with the detected name. Choosing another display name retains the detected name as an alias. Missing or ambiguous identity never guesses a member. Date labels retain their printed precision and wording. Missing Disease alone does not put a file in Needs attention.

The member Actions dropdown sits beside the filter; Update and Remove target its selected profile. Add member is independent and never changes the filter. Update uses its own form. Removal requires confirmation and retains every report, source and saved text. SQLite atomically clears links and rebuilds affected retrieval indexes. Duplicate member names/aliases are rejected. Profile creation backfills exact matches in existing reports; startup also repairs missing exact links in older libraries. Printed names and source text are preserved, while display-name changes retain established member identities.

Each dimension now uses independently expandable category branches, built with native `details`/`summary` controls. Date uses year → month → reports, combining days within a month while preserving each report's original date label. Year-only dates appear under “Month not recorded”; ambiguous dates stay outside confirmed year/month branches. Unrecognized date formats retain their original labels. Branch expansion persists across dimension changes, filtering and viewer/back navigation during the current session in the mounted app.

View, member filter and attention selection persist in session storage. Back restores the view, filter, focus and scroll position. A saved correction updates the grouped views from the backend receipt; background reads started before a successful mutation cannot overwrite it. Profiles use the browser's native modal dialog for keyboard focus and Escape handling. Category tabs support arrows, Home and End.

## Verification — 2026-10-27

Run `npm test` for Playwright checks using installed Microsoft Edge. The test runner starts an isolated Vite server on port 5175. API responses are synthetic and intercepted; tests do not modify the user's library or call AI services. Screenshots are written under `test-results/`.

| Check | Result |
| --- | --- |
| Four views, multi-label identity, optional disease, profile aliases | Passed |
| Member filter persistence, viewer/back, browser history, reload, keyboard tabs | Passed at 1440 × 1000 and 390 × 844 |
| Missing and ambiguous fields, tentative dates, independent text warnings | Passed at both sizes |
| Classification correction updates groups and retains unrelated warnings | Passed at both sizes |
| Create/update profiles through separate controls, preserve active filter, empty-profile state | Passed at both sizes |
| Unmatched name review → new member / text correction; canonical alias grouping | Passed at both sizes |
| Member removal cancel/success preserves reports and clears filter | Passed at both sizes |
| Delete cancel/failure/success and unavailable old link | Passed at both sizes |
| Pending text viewer, preserved original, loading and library-read failure | Passed at both sizes |
| Chinese category/status labels and horizontal overflow | Passed at both sizes; English desktop and Chinese phone screenshots visually inspected |
| Independent branch toggles, keyboard activation and year/month grouping | Passed at both sizes |
| `npm test` | 26 checks covering desktop and phone |
| `.venv/Scripts/python.exe -m pytest backend -q` | 64 passed, including SQLite member-link backfill, duplicate rejection, startup repair and profile-removal/index checks |
| `npm run build` and `npm run lint` | Passed |

Prepared-document extraction/classification quality, the user's actual phone/browser, real chat-triggered metadata updates and Linux deployment are not established by these synthetic browser checks. Chat remains a separate feature contract; existing backend-confirmed classification changes are picked up by library polling.
