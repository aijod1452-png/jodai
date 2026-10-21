# Storage connection repair
- [x] Normalize repeated HTTPS schemes and official Dashboard project URLs; validate hostnames.
- [x] Start the Storage URL field empty; all 16 URL and routing regression tests pass, build OK.
- [x] Support compatible secret decryption and safe credential display.
- [x] Normalize Storage inputs and test authenticated endpoints with clear results.
- [x] Pass 11 regression tests; verify live status endpoint, PIN screen and rejection of unauthenticated Storage tests.
- [ ] Verify an existing Storage connection through the unlocked UI — blocked by unavailable PIN session; no authentication bypass or PIN reset performed.