# Tools + Storage
## Phase 1 — R7–R8
- [x] Record approved R7–R10 without changing R1–R6.
- [x] R7 code and unit tests: headers, relative URLs, previous-step payload, full HTTP body.
- [x] R8 code and unit tests: bucket migration confirmed in database, bucket verification, external JSON upload, UI.
- [ ] R7/R8 authenticated end-to-end verification — blocked by PIN-locked app and unavailable real external connection; no bypass performed.
- R9–R10: recorded only; outside phase 1.

- [x] Storage URL/key normalization, compatible decryption, authenticated probes (16 tests).
- [x] Tool URL/header/sample validation, private-address block, 2xx-only success, masked keys.
- [x] Edit, enable/disable, delete logging, test latency/messages for tools and storage.
- [ ] Verify real connections through the unlocked UI — needs the user's PIN.

# R1–R6 (REQUIREMENTS.md)
- [x] R1–R6 code + 30 tests passing.
- [ ] Live check with real tools/models/snapshot — needs the user's PIN session and real provider keys.
