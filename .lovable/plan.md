# Tools + Storage: complete the server side first

## Issues found in the current code
1. **Tool keys leak partially**: saving a tool stores the last 4 characters of its key as the masked value (Storage connections no longer do this).
2. **Tool URLs are barely checked**: only `https://` is required. Whitespace, nested `https://https://`, user:pass in the URL, and private or internal addresses (localhost, 10.x, 192.168.x, 169.254.x, .internal) all get through.
3. **Tool test reports success incorrectly**: a 404 counts as success, a decryption failure crashes the whole request, the reason for failure isn't returned, and upstream error details aren't filtered.
4. **Storage test doesn't save latency** (`last_test_latency_ms`), and neither save nor test checks that the connection is enabled.
5. **Missing input validation**: no limits on header type/name, header names aren't validated (they can contain invalid characters), the sample request isn't checked as JSON or for size, and `id` isn't checked as a UUID.
6. **Delete**: no activity log entry, and no response when the item doesn't exist.
7. **No edit or enable/disable**: the UI can only add and delete, and there's no way to keep the old key while editing.
8. **safety-snapshot** only writes a log entry but answers "Snapshot created". It needs to say plainly that it only records an event and doesn't back up any data.

## What will be built
- A new server-only module `tool-connection.ts` (same pattern as `storage-connection.ts`):
  - `normalizeToolUrl`: trims whitespace, removes nested schemes, requires HTTPS, rejects credentials in the URL and private or internal addresses, and keeps the path (tool endpoints need it).
  - `normalizeHeaderName` / `buildToolHeaders`: the header name must be a valid token (default Authorization), and the type must be Bearer or raw.
  - `testToolConnection`: 6-second timeout, `redirect: "manual"`. Only 2xx counts as success. 401/403/404/5xx/TIMEOUT/NETWORK each get a clear Thai message, and upstream content is never returned.
- `services.ts`:
  - save-tool: uses the module above, masks the key as "ตั้งค่าคีย์แล้ว" (key set) for both lists, rejects invalid sample JSON or anything over 10KB, and validates the id. Leaving the key blank on edit keeps the old key.
  - test: catches decryption errors in the tool path, saves result, latency and time for both kinds, refuses to test a disabled connection, and returns a `message` every time.
  - delete: validates the id, returns 404 when not found, and writes a log entry.
  - New `toggle` action: turns a tool or storage connection on or off.
  - safety-snapshot: changes the response to say it records the event only.
- `ToolsStorage.tsx`: edit button (pre-fills the fields, key field blank = keep the existing key), enable/disable switch, test result message shown under each item, empty starting value for the tool URL, and the save button is disabled while saving.

## Tests (added to `src/test/`)
- `tool-connection.test.ts`: nested URLs, whitespace, rejection of http/credentials/localhost/private IPs, header name validation, Bearer vs raw, 2xx = success, 404/401 = failure, timeout and network errors without leaked details.
- Run together with the existing 16 tests; all must pass.

## Verification
- Check the build and the logs, and make sure the status endpoint returns 200.
- Unauthenticated tool and storage tests must still be rejected (401).
- Testing through the unlocked app still needs the PIN, so this step stays open in the roadmap.

## Technical notes
- The private-address check looks at the hostname and IP patterns only (no DNS resolution, because the server runtime limits it). Use `redirect: "manual"` so a redirect can't send the request to an internal address.
- No database changes are needed; all the columns already exist.
