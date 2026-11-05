<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

- Keep external Storage URL/key normalization, authenticated probes and safe diagnostic results in the server-only storage-connection module so save and test paths use consistent rules.
- Encrypt new connection secrets with the preferred configured source; decrypt with both current and historical sources without downgrading corrupted encrypted records to plaintext, preserving compatibility without exposing credentials.
- Keep tool endpoint URL/header/sample validation, private-address blocking and safe probes in the server-only tool-connection module so save and test share one rule set.
- REQUIREMENTS.md holds user-approved R-IDs; never edit it without user approval (workspace rule).
- Model calls go through callWithFallback and router-core dispatch; routing-policy owns pure safeguards and process-local latency/RPM state so chat, compaction, queue and gateway share terminal-denial, budget, key-pool, masking and fallback rules. Budget/RPM are optional server configuration, not distributed guarantees.
- Safety snapshots use storage-connection.ts with its table allowlist and recursive sensitive-field exclusion; all providers share the same export rules to keep credentials and session data out of backups.
- R2 signing, fixed account/bucket endpoints and bounded text operations live in r2-storage.ts; storage-service.ts owns encrypted connection lifecycle, safe projections and metadata-only audit so UI and chat share one server-only security boundary.
- Resolve relative tool endpoints against the current server request origin in the tool-connection module, and relay successful previous-step outputs as structured payload context, so scheduled and immediate executions use the same rules.
- LINE tool template and run presets live in src/hub/line-presets.ts so the tool form, the Run Tool dialog and tests share one source; manual runs go through the run-tool action which reuses executeToolCall.
- Generate app workers only with vite-plugin-pwa; the build ordering check puts generated NetworkOnly privacy routing before precache, and the single registration wrapper rejects dev/preview/iframe contexts to avoid private caching and stale previews. Navigation HTML is never persisted; only public fixed/hashed assets may be cached.
- Chat-first direct engine logic lives in src/server/hub/chat.ts with injected deps (model call, tool run, usage, log) so services and tests share one flow without the task queue.
- The generated worker reads fixed precache assets from public/ (globDirectory) because the client build pass does not copy public files; the closeBundle ordering hook skips passes where dist/client/sw.js does not exist.
- Cache, snippets, memories and compaction live in src/server/hub/chat-pipeline.ts with an injected PipelineStore (DB impl in pipeline-store.ts) so chat-service and tests share one flow; the OpenAI gateway logic lives in openai-gateway.ts with injected deps.
