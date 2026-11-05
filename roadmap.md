# Tools + Storage
## R24–R32 — Requested routing safeguards
- [x] Approve the R24–R32 draft and append it without changing R1–R23.
- [x] Implement approved policies in real model dispatch and add src/test/r24-r32.test.ts (60 tests).
- [x] Verify simulated dispatch, routing, fallback, cache identity, remote error statuses and regression suite: bunx vitest run — 194/194 passed; automatic build OK (2026-11-05 01:03:14 UTC).
- [ ] R24 — Implemented, unverified live: priority/20-sample latency checks pass; real model traffic requires authorized live requests.
- [ ] R25 — Implemented, unverified live: cooldown/fallback/expiry and terminal denial checks pass; live model failures not exercised.
- [ ] R26 — Implemented, unverified live: Thai/English heuristics and cheap/complex selection checks pass; real answer-quality comparison not performed.
- [ ] R27 — Implemented, unverified: cap boundaries, UTC spend and fail-closed dispatch pass in simulated tests; no daily cap chosen.
- [ ] R28 — Implemented, unverified live: all six statuses, timeout/cancel distinction and gateway pause/backoff checks pass; real provider/gateway failures not exercised.
- [ ] R29 — Implemented, unverified live: key-pool parsing, auth-header selection, exhaustion and terminal-denial checks pass; real multi-key connection not exercised.
- [ ] R30 — Implemented, unverified live: outbound user/system masking and unchanged originals/auth checks pass; no live external dispatch inspected.
- [ ] R31 — Implemented, unverified live: whitespace/idempotence and code/JSON preservation pass; no live external dispatch inspected.
- [ ] R32 — Implemented, unverified: rolling-window, synchronous admissions, retry counting and rejection checks pass; no RPM chosen, process-local only.
- Daily budget and per-model RPM values remain unconfigured by user choice.
- Server configuration inputs are AIH_DAILY_BUDGET_USD (recorded USD costs) and AIH_MODEL_RPM_LIMIT (per model); neither has been provisioned. No schema/UI/deployment changes or paid calls. Formatting protection conservatively skips squeezing any input containing code/indented blocks.

## R14–R18 — R2 integration
- [x] R14 code: encrypted R2 connections, additive schema confirmed in database, generated types and provider form.
- [x] R15 code: read-only signed HEAD bucket probe and safe errors; independently verified SigV4 in simulated API test.
- [x] R16 code: shared snapshots to both providers and recursive sensitive field exclusions; simulated uploads verified.
- [x] R17 code: backend-only AI list/read/write, strict path/type/size checks and rejection of delete/URLs; simulated integration verified.
- [x] R18 checks: 115/115 unit/integration tests passed, automatic build OK, metadata-only audit tested; unauthenticated actions return 401.
- R14–R18 status: Implemented, unverified in the live authenticated environment. Database has no R2 connection; supplied real credentials and unlocked PIN session are required. No live R2 claim.
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

# R19–R23 Phase 4 (approved 2026-11-04)
- [x] Tables prompt_cache, ai_snippets (seeded /line /sum /fix), user_memories, chat_summaries.
- [x] Chat pipeline: memory capture, snippets, compaction, exact cache; wired into chat-service/send.
- [x] /api/public/v1/chat/completions (Bearer api_tokens, JSON + SSE); 19 tests.
- [ ] Live chat/gateway check with real models — needs PIN session, provider keys and an API token.
