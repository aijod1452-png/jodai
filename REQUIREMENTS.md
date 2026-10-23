# JodAI — Approved Requirements (approved 2026-10-23)

- R1 Tool execution in worker: steps of type TOOL_CALL call the real tool endpoint (validated URL, auth header, JSON payload checked against the tool's sample_request keys) and record the real HTTP status and response.
- R2 In-step router fallback: when a model returns HTTP 402 or 429, put it in cooldown and immediately try the next eligible model within the same step; fail only when no model remains or on a non-402/429 error.
- R3 Real safety snapshot: snapshot copies real rows of the requested hub table (secret/session tables excluded) as JSON into the app's own Storage bucket, checking/creating the bucket first.
- R4 Worker drain + immediate trigger: submitting a task starts processing immediately; worker runs repeatedly until the queue is empty, paused, or a time budget is reached.
- R5 PWA manifest: public/manifest.json linked from the root route head (install to home screen only, no offline mode).
- R6 Router: expired cooldowns are released automatically and cost is computed per provider/model pricing. Model IDs in the database are NOT changed (user will handle them).
