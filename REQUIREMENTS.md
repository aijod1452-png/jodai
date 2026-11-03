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
