# Tools + Storage
## R14–R18 — R2 integration
- [ ] R14 encrypted R2 connections, additive schema and provider form.
- [ ] R15 read-only signed bucket probe and safe errors.
- [ ] R16 adapter snapshots with sensitive field exclusions.
- [ ] R17 backend-only AI list/read/write with path/type/size checks.
- [ ] R18 simulated API integration/regression tests and metadata-only audit.
- [ ] Live R2 and authenticated UI checks — requires R2 credentials and an unlocked PIN session; no delete or signed downloads.
## R12 — Complete PWA
- [x] Generated worker, strict cache exclusions, Thai offline fallback and guarded registration.
- [x] Install/connectivity hook and Settings install card; browser event behavior tested in unit tests.
- [x] Full unit suite (73/73), automatic build OK, preview has zero worker registrations; generated worker tested with real connection loss in an isolated browser origin.
- [ ] R12 — Implemented, unverified in published authenticated Settings and native installation: requires publication, PIN unlock and a supported browser; do not deploy without authorization. No mock production paths or auth bypass.

## Phase 1 — R7–R8
- [x] Record approved R7–R10 without changing R1–R6.
- [x] R7 code and unit tests: headers, relative URLs, previous-step payload, full HTTP body.
- [x] R8 code and unit tests: bucket migration confirmed in database, bucket verification, external JSON upload, UI.
- [ ] R7/R8 authenticated end-to-end verification — blocked by PIN-locked app and unavailable real external connection; no bypass performed.
- R9–R10: recorded only; outside phase 1.

## R11 — Run Tool UI (approved 2026-10-25)
- [x] run-tool action: decrypt key, real executeToolCall, real status/latency/body.
- [x] Run dialog with editable JSON payload, LINE presets (ObOG → Bomb/XAUUSD), live response.
- [x] LINE template fill button in the tool form.
- [x] Unit tests (r11.test.ts).
- [ ] Authenticated end-to-end run against a real tool — blocked by PIN-locked app; no bypass performed.

- [x] Storage URL/key normalization, compatible decryption, authenticated probes (16 tests).
- [x] Tool URL/header/sample validation, private-address block, 2xx-only success, masked keys.
- [x] Edit, enable/disable, delete logging, test latency/messages for tools and storage.
- [ ] Verify real connections through the unlocked UI — needs the user's PIN.

# R1–R6 (REQUIREMENTS.md)
- [x] R1–R6 code + 30 tests passing.
- [ ] Live check with real tools/models/snapshot — needs the user's PIN session and real provider keys.

# R12 build fix / R13 Chat-First (approved 2026-11-02)
- [x] existsSync guard in closeBundle.
- [x] chat-service/send direct engine + in-memory tool run + usage/activity logging.
- [x] Chat-first Home with tool status and quick prompts; chat-service tests.
- [ ] Live chat with real models/tools — needs the user's PIN session and provider keys.
