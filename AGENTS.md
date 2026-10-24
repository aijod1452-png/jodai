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
- Model calls in jobs go through callWithFallback (402/429 → cooldown, next model in same step) so fallback behavior lives in one place.
- Safety snapshots use storage-connection.ts and its secret/session/token-excluding table allowlist; default to the private app bucket or the authenticated user's selected external connection, so both targets share the same export rules.
- Resolve relative tool endpoints against the current server request origin in the tool-connection module, and relay successful previous-step outputs as structured payload context, so scheduled and immediate executions use the same rules.
