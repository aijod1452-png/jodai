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
