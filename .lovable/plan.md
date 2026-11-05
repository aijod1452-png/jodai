# R24–R32: Model routing and dispatch safeguards

## Approval and scope
The full current REQUIREMENTS.md (R1–R23) has been read. R24–R32 are not yet recorded there. Approval of this plan authorizes appending the following stable IDs without changing or removing existing IDs. Where R25/R28 expand the old R2 fallback rule, the new section will explicitly state that precedence.

No changes to model IDs, providers, endpoints, UI, publication, or live paid requests. Production paths must use real routing and recorded spend; simulated APIs are only for tests.

## Requirements draft

- **R24 — Lowest-Latency Dynamic Priority:** Add `rankModelsByLatency` in router-core. Rank eligible models using configured priority plus a rolling mean of their latest 20 real dispatch latencies. Proposed score: priority + mean latency in seconds, ascending. Unknown latency contributes zero; equal scores preserve existing fallback order. Record timing on success and failure. Measurements are process-local, reset on restart, and never use provider connection-test latency.
- **R25 — Smart Circuit Breaker:** Cool down a model after a dispatch exhausts eligible keys with a retryable transient error. Reuse the configured cooldown duration, exclude cooled-down models, and release expired cooldowns. Never loop over the same model indefinitely. HTTP 400/401/403/404 and provider refusals are terminal, not reasons to rotate credentials or switch models.
- **R26 — Cost-Aware Tier Routing:** Add `classifyPromptComplexity`. Proposed deterministic classification: simple for short ordinary requests of at most 500 characters; complex for longer requests or explicit code, analysis, planning, tool-action, or reasoning requests in Thai/English. For simple requests, prefer the lowest-priced eligible models using the existing per-model pricing; break equal-cost ties with R24. Complex requests retain priority/latency ordering. No invented model IDs or provider changes. Tests will document classification boundaries; this is a heuristic, not a guarantee of equal answer quality.
- **R27 — Daily Budget Guardrail:** Add `isBudgetExceeded` and check actual usage_records spend for the current UTC day before each external dispatch. Compare in the same currency as recorded cost; reject at or above a configured cap and fail safely if spend cannot be read. The user has not set a cap: keep it explicitly unconfigured, not an invented numeric limit. A pre-dispatch guard does not guarantee that an in-flight request or concurrent requests cannot overshoot; strict reservations are excluded from this draft.
- **R28 — Timeout and Expanded Fallback Errors:** Add `isExpandedFallbackError` for exactly 402, 429, 408, 502, 503, 504, with recognized timeout failures mapped to 408. Expand R2 for ordinary configured external providers while retaining terminal errors. Do not add generation-abort timers. For Lovable AI Gateway, apply its stricter rules: 402 pauses rather than switching models; provider denial/refusal is terminal; transient recovery honors Retry-After or bounded backoff. Do not treat explicit user cancellation as a timeout.
- **R29 — Multi-Key Pool and Failover:** Add `parseApiKeys` to trim, remove empty entries, and deduplicate comma-separated keys from the existing encrypted provider secret. For ordinary external providers, try the next key only after an eligible quota/rate-limit response (402/429); after keys are exhausted, use the model circuit breaker/fallback. No rotation on 401/403, denial, or refusal. Do not rotate Lovable-managed credentials or use custom headers to silently override the chosen key. Keys remain server-side and encrypted at rest; never include keys or key indices in user responses or logs.
- **R30 — Secret & PII Auto-Masker:** Add `maskSensitiveData` and apply it to user and system prompt content at the final external-model dispatch boundary, including history, memory, tool descriptions, and tool-result summaries. Mask known configured secrets, recognizable API-key prefixes, JWTs, labeled key/token/secret values, and Thai/international phone patterns. Keep authentication headers intact and do not mutate stored originals or real tool payloads. Pattern-based masking cannot guarantee detection of all possible PII or unknown key formats; test both masking and ordinary text preservation.
- **R31 — Adaptive Token Squeezer:** Add `squeezePrompt` before dispatch to remove redundant spaces and extra blank lines while preserving meaning, fenced code, indentation-sensitive content, and structured payload text. Do not truncate content or remove history. Tests cover idempotence and code/JSON preservation.
- **R32 — Model RPM Throttler:** Add a process-local `ModelRpmThrottler` with a rolling 60-second window per model and atomic synchronous admission before each actual request, including key retries. Exhausted models are skipped without sending another request; report throttled if none is eligible. The user has not set RPM limits: keep enforcement unconfigured until supplied. In-memory limits are per running process, not distributed guarantees, and reset on restart. Expire inactive entries to bound memory.

## Implementation details

- Keep policy helpers and process-local state together behind the existing server-only dispatch boundary; export the requested helpers from router-core.
- Integrate selection in `pickBestModel`, dispatch preparation and key attempts in `callAIModel`, and model fallback in `callWithFallback`, covering chat, compaction, jobs, and the OpenAI-compatible endpoint.
- Align prompt-aware cache model selection with dispatch so latency/tier selection cannot cache a response under the wrong model ID.
- Use existing encrypted secrets, cooldown configuration, pricing, and usage records. Proposed unset budget/RPM configuration lives in the server configuration; do not add schema or UI without approval.
- Record the structural rule in AGENTS.md and progress in roadmap.md. Append REQUIREMENTS.md only after this approval.

## Verification by ID

Create `src/test/r24-r32.test.ts` with concrete assertions and fake clocks/injected APIs:

| ID | Evidence required |
|---|---|
| R24 | Priority versus latency ranking, rolling window, unknown latency, deterministic ties, timing recorded from real dispatch responses in simulated integration |
| R25 | Cooldown after exhaustion, no repeated model, expiry releases model, terminal denial stops |
| R26 | Thai/English classification, 500-character boundary, cheap eligible model selection, complex ordering and capability/cooldown exclusions |
| R27 | Below/equal/above cap, unset cap, UTC day boundary, spend-query error, blocked dispatch sends no request |
| R28 | Each of six statuses separately; terminal statuses, timeout versus cancellation, gateway-specific pause/backoff |
| R29 | Parsing and deduplication, actual selected auth header, second-key success, exhaustion, no denial rotation or credential leakage |
| R30 | Keys/JWTs/phones/known secrets masked in outgoing user and system content; auth headers and original tool payloads unchanged |
| R31 | Whitespace reduction, idempotence, code/JSON and non-whitespace content preserved in outgoing requests |
| R32 | Exact RPM boundary, 60-second expiry, model isolation, concurrent admission, retry counting, unset configuration and no fetch after rejection |

Run the full existing unit/integration suite and inspect automatic build errors. Separate code written, simulated checks passed, and live behavior verified in the report. No live paid calls without authorization; unset budget/RPM enforcement and any unavailable real-environment checks remain explicitly unverified. Do not report all IDs complete solely because helpers or unit tests exist.