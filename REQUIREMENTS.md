# JodAI — Approved Requirements (approved 2026-10-23)

- R1 Tool execution in worker: steps of type TOOL_CALL call the real tool endpoint (validated URL, auth header, JSON payload checked against the tool's sample_request keys) and record the real HTTP status and response.
- R2 In-step router fallback: when a model returns HTTP 402 or 429, put it in cooldown and immediately try the next eligible model within the same step; fail only when no model remains or on a non-402/429 error.
- R3 Real safety snapshot: snapshot copies real rows of the requested hub table (secret/session tables excluded) as JSON into the app's own Storage bucket, checking/creating the bucket first.
- R4 Worker drain + immediate trigger: submitting a task starts processing immediately; worker runs repeatedly until the queue is empty, paused, or a time budget is reached.
- R5 PWA manifest: public/manifest.json linked from the root route head (install to home screen only, no offline mode).
- R6 Router: expired cooldowns are released automatically and cost is computed per provider/model pricing. Model IDs in the database are NOT changed (user will handle them).

## Phase 1 and later requirements (approved 2026-10-24)

- R7 Tool execution: Bearer uses Authorization: Bearer <key>; raw sends the key directly through the custom header or Authorization. Support relative URLs (/api/...) resolved against the app origin. Send actual previous-step data into the tool payload and record real HTTP status, latency and response body.
- R8 External Storage: add bucket_name to storage_connections and its form. Verify the actual bucket through the Storage API. Safety Snapshot accepts storageId to upload real table JSON to the external bucket and records the path and file size.
- R9 Context relay & Tool UI: relay full context between steps without the 800-character truncation and display tool results in the UI. Deferred beyond phase 1.
- R10 Signed download URL: request a signed download URL for snapshots in private buckets and provide a download button in the UI. Deferred beyond phase 1.

## Tool UI additions (approved 2026-10-25)

- R11 Run Tool: a run-tool action in tools-storage-service decrypts the tool's API key and executes the real request via executeToolCall, returning the real HTTP status, latency and response body. The Tools page has a Run button (Play icon) per tool opening a dialog with an editable JSON payload, quick LINE presets (account ObOG, send to Bomb or XAUUSD) and a live response view. The tool create/edit form has a button that fills the LINE template (description + sample_request) automatically.

## Complete PWA (R12 approved 2026-10-26)

- R12 Complete PWA: extend R5 with a generated /sw.js using vite-plugin-pwa generateSW, fixed public asset precaching (offline.html, icons, manifest), network-first navigation with a Thai offline.html fallback in theme #141a2e, and no caching of /api/, /_server/, ?_data=, supabase.co or requests with x-session-token. Add src/hub/use-pwa.ts for beforeinstallprompt, standalone and connectivity status, and an in-app install card in Settings. Register from a single guarded wrapper called by RootComponent only in production outside development, Lovable previews and iframes; support ?sw=off and unregister matching stale app workers in refused contexts. This approved safe approach replaces handwritten public/sw.js and SSR-only registration checks. Add src/test/r12-pwa.test.ts and run all unit tests. Offline behavior is available only in the published app, not the editor preview.

## R12 build fix and R13 Chat-First Engine (approved 2026-11-02)

- R12 build fix: the closeBundle hook in vite.config.ts checks existsSync before reading dist/client/sw.js so SSR/multi-pass builds never fail with ENOENT.
- R13 Chat-First Direct Engine: chat-service (action "send") in src/server/hub/services.ts loads enabled Tools and calls models directly through callWithFallback without the DB queue. When the AI decides to call a Tool, executeToolCall runs in memory immediately, with logActivity and usage_records written. src/hub/pages/Home.tsx becomes a full Chat-First page with live conversation, clear Tool Execution status and Quick Prompts. Unit tests in src/test/chat-service.test.ts; build and all tests must pass.

## R14–R18 Storage providers (approved 2026-11-03)

- R14 Storage types: support Supabase and Cloudflare R2. R2 accepts Account ID, bucket, Access Key ID and Secret Access Key; derive the endpoint automatically. Store credentials encrypted server-side and never return them to UI or AI.
- R15 Real R2 probe: verify the configured bucket with a read-only authenticated request and report actual results/errors. Never create, upload or delete files as a probe side effect.
- R16 Snapshot adapter: Safety Snapshot supports Supabase or R2 through an adapter, retaining the table allowlist and excluding secrets and session data. Report path, byte size and row count.
- R17 AI R2 access: AI may list/read/write only inside the configured bucket through the backend. No delete, no arbitrary endpoint URLs; validate paths, content types and sizes. Never include credentials in prompts.
- R18 Safe audit and verification: record actual call results and necessary metadata, never credentials or file contents. Run unit/integration tests with simulated APIs; separately verify live R2 after the user supplies credentials. Cover signing/auth/errors, encrypted/masked credentials, existing Supabase compatibility, snapshots to both targets, AI list/read/write and rejection of delete/out-of-bucket URLs. Report code written, checks passed, live verification and blockers separately. R10 signed download URLs are excluded.

## Phase 4: Performance, Shortcuts, Context, Memory & External Gateway (approved 2026-11-04)

- R19 Exact Prompt Cache: prompt_cache table stores the SHA-256 hash of prompt + model_id, response, hit_count, cost_saved and expires_at (24 h). chat-service checks the cache before calling a model; on a match with no live-run condition (skip for Tool Calls and time-related prompts) it replies immediately (<30 ms) with no credit use, recording hit_count and cost_saved.
- R20 Quick Action Snippets: ai_snippets table with defaults /line (send LINE), /sum (summarize), /fix (debug). A leading / in chat is converted into a Template and System Instruction before sending to the model.
- R21 Adaptive User Memory: user_memories table. Commands such as "จำไว้ว่า..." or "remember:" are saved to the DB, and enabled memories are injected into the System Prompt automatically.
- R22 Rolling Context Compactor: chat_summaries table. When a conversation exceeds 10 turns, older history is compressed into a running summary sent together with the latest 4 turns.
- R23 OpenAI-Compatible Remote Gateway: /api/public/v1/chat/completions authenticated with a Bearer token from api_tokens; converts the standard OpenAI payload into callWithFallback and returns OpenAI wire format so Cursor, Shortcuts or Obsidian can call JodAI Hub directly.


## R24–R32 routing safeguards (approved 2026-11-05)

R25/R28 expand the ordinary external-provider R2 error set; R2 remains recorded unchanged above. Managed Lovable AI Gateway uses its stricter terminal/pause rules.

- **R24 — Lowest-Latency Dynamic Priority:** Add `rankModelsByLatency` in router-core. Rank eligible models using configured priority plus a rolling mean of their latest 20 real dispatch latencies. Proposed score: priority + mean latency in seconds, ascending. Unknown latency contributes zero; equal scores preserve existing fallback order. Record timing on success and failure. Measurements are process-local, reset on restart, and never use provider connection-test latency.
- **R25 — Smart Circuit Breaker:** Cool down a model after a dispatch exhausts eligible keys with a retryable transient error. Reuse the configured cooldown duration, exclude cooled-down models, and release expired cooldowns. Never loop over the same model indefinitely. HTTP 400/401/403/404 and provider refusals are terminal, not reasons to rotate credentials or switch models.
- **R26 — Cost-Aware Tier Routing:** Add `classifyPromptComplexity`. Proposed deterministic classification: simple for short ordinary requests of at most 500 characters; complex for longer requests or explicit code, analysis, planning, tool-action, or reasoning requests in Thai/English. For simple requests, prefer the lowest-priced eligible models using the existing per-model pricing; break equal-cost ties with R24. Complex requests retain priority/latency ordering. No invented model IDs or provider changes. Tests will document classification boundaries; this is a heuristic, not a guarantee of equal answer quality.
- **R27 — Daily Budget Guardrail:** Add `isBudgetExceeded` and check actual usage_records spend for the current UTC day before each external dispatch. Compare in the same currency as recorded cost; reject at or above a configured cap and fail safely if spend cannot be read. The user has not set a cap: keep it explicitly unconfigured, not an invented numeric limit. A pre-dispatch guard does not guarantee that an in-flight request or concurrent requests cannot overshoot; strict reservations are excluded from this draft.
- **R28 — Timeout and Expanded Fallback Errors:** Add `isExpandedFallbackError` for exactly 402, 429, 408, 502, 503, 504, with recognized timeout failures mapped to 408. Expand R2 for ordinary configured external providers while retaining terminal errors. Do not add generation-abort timers. For Lovable AI Gateway, apply its stricter rules: 402 pauses rather than switching models; provider denial/refusal is terminal; transient recovery honors Retry-After or bounded backoff. Do not treat explicit user cancellation as a timeout.
- **R29 — Multi-Key Pool and Failover:** Add `parseApiKeys` to trim, remove empty entries, and deduplicate comma-separated keys from the existing encrypted provider secret. For ordinary external providers, try the next key only after an eligible quota/rate-limit response (402/429); after keys are exhausted, use the model circuit breaker/fallback. No rotation on 401/403, denial, or refusal. Do not rotate Lovable-managed credentials or use custom headers to silently override the chosen key. Keys remain server-side and encrypted at rest; never include keys or key indices in user responses or logs.
- **R30 — Secret & PII Auto-Masker:** Add `maskSensitiveData` and apply it to user and system prompt content at the final external-model dispatch boundary, including history, memory, tool descriptions, and tool-result summaries. Mask known configured secrets, recognizable API-key prefixes, JWTs, labeled key/token/secret values, and Thai/international phone patterns. Keep authentication headers intact and do not mutate stored originals or real tool payloads. Pattern-based masking cannot guarantee detection of all possible PII or unknown key formats; test both masking and ordinary text preservation.
- **R31 — Adaptive Token Squeezer:** Add `squeezePrompt` before dispatch to remove redundant spaces and extra blank lines while preserving meaning, fenced code, indentation-sensitive content, and structured payload text. Do not truncate content or remove history. Tests cover idempotence and code/JSON preservation.
- **R32 — Model RPM Throttler:** Add a process-local `ModelRpmThrottler` with a rolling 60-second window per model and atomic synchronous admission before each actual request, including key retries. Exhausted models are skipped without sending another request; report throttled if none is eligible. The user has not set RPM limits: keep enforcement unconfigured until supplied. In-memory limits are per running process, not distributed guarantees, and reset on restart. Expire inactive entries to bound memory.

