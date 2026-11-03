# R14–R18 verification report

## Requested and implemented

Added approved R14–R18 to REQUIREMENTS.md without changing existing R1–R13 text. R10 signed downloads remain excluded. Implemented R2 alongside existing external Storage, encrypted credentials, a fixed derived account endpoint, read-only HEAD bucket probe, snapshot adapter, and backend AI list/read/write. No production mocks, arbitrary endpoint URLs, R2 delete, or probe writes.

## Requirement status

| ID | Status | Evidence and remaining gap |
| --- | --- | --- |
| R14 | Implemented, unverified | Additive schema columns confirmed by database read; generated types refreshed. Tests verify encrypted credentials, safe projections, compatibility, incomplete credentials, provider/account edits and corrupt ciphertext. Authenticated save/edit/readback through the real UI awaits PIN unlock and credentials. |
| R15 | Implemented, unverified | Simulated API tests independently reconstruct SigV4 and verify one HEAD request, real status propagation, safe auth/404/500/network/timeout errors and metadata persistence. Real R2 bucket/auth probe awaits credentials. |
| R16 | Implemented, unverified | Simulated API tests verify uploads to both external Storage and R2, row/path/UTF-8 bytes, failed uploads and exclusion of sessions/settings credentials/nested secrets. Live authenticated snapshots and object readback await credentials and authorization to write test snapshots. |
| R17 | Implemented, unverified | Simulated AI-to-backend-to-signed-request tests cover list/read/write; strict operation validation refuses delete, external URLs, traversal, binary types, oversized files and invalid JSON. Real model-to-R2 operations await authenticated session, provider readiness and R2 credentials. |
| R18 | Implemented, unverified | Safe audit success/failure/rejection and audit-persistence failure tested. No credentials or file bodies in operation audit. Live verification remains separate and unperformed. |

## Checks passed

- `bunx vitest run`: 10 files, 115 tests passed, including 37 R14–R18 tests. Test doubles simulate API/database/model responses only inside tests, never production paths.
- Automatic preview build: latest entry 2026-11-03T05:10:24Z reports `build OK`.
- Playwright on localhost: PIN screen visible; zero page runtime errors. Unauthenticated save-storage, test, safety-snapshot and storage-operation each returned 401. This does not verify the authenticated flow.
- Database read confirms storage_type default supabase, account_id and existing bucket_name. A count-only read found one existing encrypted external Storage connection and no R2 connection. No real credential values were read or displayed.

## Live verification procedure (not yet run)

1. Unlock the app, select Tools & Storage → External Storage → add Cloudflare R2. Enter Account ID, bucket and the two credentials into password fields; never paste them into chat.
2. Use bucket-scoped credentials permitting read/write only as needed. Save, reopen edit and verify credential fields remain empty. Reload to confirm saved provider/account/bucket metadata.
3. Click Test: only HEAD bucket verification should run; confirm actual status and no object changes. Test denied credentials separately if authorized.
4. With explicit authorization to write test data, create a small snapshot; read back the resulting object, confirm row count/bytes and absence of credentials/session data.
5. With explicit authorization to write, ask AI to list, read a known small text file, and write a small text/JSON test file in the configured bucket. Confirm the real objects/results and metadata-only activity records. Test delete and external URLs are rejected. This app intentionally provides no delete cleanup operation.
6. Repeat the existing external Storage probe/snapshot to confirm live compatibility. Do not infer compatibility solely from passing simulated tests.

## Implementation choices and scope

- S3 SigV4 uses aws4fetch (Web Crypto) and R2 XML parsing uses fast-xml-parser; no Node-only production runtime dependency.
- AI file operations accept UTF-8 plain text, JSON and CSV up to 1 MiB. Snapshot upload cap is 50 MiB. Lists are bounded to 100 objects with continuation cursor; read-only bucket probe never lists/uploads objects. These are implementation safety limits, not changes to approved IDs.
- Existing snapshot allowlist is retained, but recursive sensitive-column removal now also excludes settings PIN hash/salt, credential fields, payload/body/content/prompt fields. Snapshots intentionally omit these fields, including file contents in legacy activity payloads.
- R2 connection deletion is rejected; connections can be disabled. No signed download functionality or publication was added.
- Existing unrelated historical roadmap blockers remain unchanged.