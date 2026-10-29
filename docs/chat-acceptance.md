# Chat acceptance — 2026-10-28

Implemented against `Features.clarified.drawio` and tested against `Chat test questions.md`, using the ten fictional John Smith PDFs. Real requests use the configured `.env` credentials and OpenAI Python library. The backup uses `BACKUP_API_KEY`, `BACKUP_BASE_URL` and `BACKUP_MODEL` together after a primary HTTP 429.

## Companion conversation — 2026-10-29

Replaced the diagnosis/record inventory presentation with a conversational message separate from the internal evidence ledger. The prompt uses everyday language and avoids clinical inventory phrasing. It prohibits suggestions, independent conclusions, data analysis, calculations and health judgments. It can relay recorded clinician assessments/instructions with attribution. Broad portfolio summaries describe documented care without enumerating every diagnosis, drug or measurement. Greetings and concerns can receive a natural reply without a records search. Past reports cannot justify a blanket verdict about current health.

Source links and quotes are grouped once under a collapsed Sources section. Retrieval counts, provider details, provenance and warnings stay there. The model can separately request at most two prominent references when inspecting a report would help; those IDs must refer to cited, retrieved evidence. Internal quote validation, full metadata/history, member scope and quota fallback remain in place.

Validation: 99 backend tests and 40 desktop/phone Edge UI checks passed; ESLint and production build passed. UI checks cover quiet sources by default, a conversational message instead of the evidence ledger, one source section per reply, and optional prominent references that open the Viewer. Backend checks reject prominent references to an uncited report even if that report was retrieved, and ordinary conversation does not require a document read. The earlier 25-case acceptance results below predate the records-only constraint; they are not a claim that the bot still calculates ages, stay durations, changes, or gives its own clinical interpretation.

Live Edge check used the exact portfolio-summary / 'am I in good shape' question against the fictional John Smith records. The final reply described documented care, made no independent health assessment or suggestions, and kept prominent references empty. It qualified the answer once: 'I can tell you what is written in your records, but these notes cannot tell me how you are doing today.' Supporting evidence remained under Sources. [Current chat screenshot](../data/chat-acceptance/companion-records-only.png).

## Context rework — 2026-10-28

Chat now supplies the complete selected-member metadata catalog and full conversation history automatically. The model selects relevant saved texts through read tools; automatic companion-lab reads and manual chat attachment/context/action controls are removed. The member selector remains, and switching members restores separate conversations. Source links open the existing Viewer.

- Backend: 97 passed, including literal OCR-control decoding and schema rejection checks.
- Edge desktop/phone UI: 36 passed, including the simplified composer, complete history and member switching.
- ESLint and production build: passed.
- Current real-provider acceptance: allergy (1.1), HbA1c trend (2.2), kidney trend (2.3), omitted discharge (4.3), and omitted follow-up imaging (4.4) passed across the initial run and targeted trend rerun. This rework did not rerun the complete 25-case suite.
- The first trend answers omitted intermediate measurements. Final review now explicitly checks each retrieved lab and requires the intermediate dated result; the rerun includes HbA1c 8.4 → 7.4 → 6.9 and eGFR 74 → 70 → 65.
- Primary quota exhaustion and the configured backup were observed again in the current live run.
- The real PNG import → OCR → filing → automatically available chat answer → saved text/original image check passed in desktop Edge, including phone navigation and Chinese controls. The final image run required no retry. Earlier runs exposed literal tabs/newlines in the backup provider's JSON arguments; decoding now preserves those characters while retaining Pydantic schema and evidence validation.

Current evidence: [initial five-case responses](../data/chat-acceptance/live-195df133-6113-4073-8f55-25c5e55c9eb5.json), [trend rerun](../data/chat-acceptance/live-8519923e-31e7-4453-ad3d-0a60b68a9134.json), [image answer](../data/chat-acceptance/photo-retest.json), [desktop](../data/chat-acceptance/context-desktop.png), [phone](../data/chat-acceptance/context-phone.png). Initial trend failures remain visible in the first artifact.

## Original implementation results (before context rework)

| Check | Result |
| --- | --- |
| Backend tests, including quota routing and evidence boundaries | 93 passed |
| Edge UI checks, desktop and phone | 36 passed |
| Production build and ESLint | Passed |
| Level 1: five single-document questions | 5/5 passed |
| Level 2: seven medication/history/trend questions | 7/7 passed |
| Level 3: four explanation/context questions | 4/4 passed |
| Level 4: six safety/missing-evidence questions | 6/6 passed |
| Duplicate discharge document, shuffled insertion order, two-page discharge content | 3/3 passed |
| Real image upload → OCR → checking → filing → sourced chat answer | Passed in Edge |
| Evidence button → saved text → original image; phone Back/navigation; Chinese controls | Passed with the real uploaded image |
| Actual primary quota exhaustion → configured backup | Observed in live requests |

The 25 question/robustness results combine a full live run with targeted retests after fixes. Early runs had failures; the table uses the latest verified response for each case, not an assertion that every intermediate run passed. The opt-in live tests are skipped during routine offline UI checks.

The image test uses a PNG rendered from the prepared laboratory PDF, not a physical camera photograph. Real OCR preserved HbA1c 8.4, fasting glucose 168, creatinine 1.10, eGFR 74 and LDL 142. A physical print-and-phone-photo test remains unperformed.

## Changes driven by testing

- Preserved real tabs and line breaks in retrieved report text. JSON-escaped text had caused repeated invalid citation attempts and unnecessary API calls.
- Initially added companion laboratory retrieval for comparisons, including intermediate results. The context rework below replaces automatic companion reads with model-selected retrieval.
- Added final evidence review, rejection of years absent from cited reports, explicit missing-documentation limits, and separation of retrospective resolution notes from supporting follow-up reports.
- Ordinary questions cannot prepare metadata changes. The original UI offered a metadata mode and revision-checked Apply action; the context rework removes these controls. Chat cannot edit report text or delete files.
- Restarted conversations on quota fallback rather than mixing provider-specific tool histories. Accepted batched read calls from the backup provider and acknowledged every call ID. DeepSeek forced tool calls use its supported non-thinking mode, preserving the configured model.
- Fixed the image-test proxy to forward actual browser multipart bytes. The application correctly rejected the test proxy's earlier empty file; that harness failure was not counted as an OCR failure.
- Excluded stored data and test artifacts from development file watching, and localized saved conversation-context labels and upload status.

For missing follow-up imaging (4.4), the later cardiology note explicitly calls the pneumonia resolved. The answer preserves that documented narrative and explains that no supporting follow-up assessment or imaging was retrieved for independent confirmation. It does not discard the later note or claim imaging was inspected.

## Evidence and reproduction

- [Consolidated live responses and factual checks](../data/chat-acceptance/live-final.json)
- [Image extraction and sourced answer](../data/chat-acceptance/photo-retest.json)
- [Desktop screenshot](../data/chat-acceptance/chat-desktop.png)
- [Phone screenshot](../data/chat-acceptance/chat-phone.png)
- [Implementation and test commands](chat.md)

Response artifacts contain fictional medical text and remain in ignored local `data/`. The fixture server copies only originals matching the prepared PDF hashes and uses separate databases for omitted, duplicated and shuffled scenarios. The user's main library is not modified by these tests.

Passing these fixture checks and quote validation does not prove that every future model paraphrase is correct. Missing or conflicting records and source inspection remain part of the experience.
