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
