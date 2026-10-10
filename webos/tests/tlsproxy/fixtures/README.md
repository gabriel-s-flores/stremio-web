Test-only certificates for webos/tests/tlsproxy (100-year validity, never used outside the tests):
- `ca.pem`: test root (O=F37 Test CA); its key was discarded after signing `leaf.pem`.
- `leaf.pem`/`leaf.key`: localhost and 127.0.0.1, signed by `ca.pem` (the "Let's Encrypt" upstreams).
- `rogue.pem`/`rogue.key`: self-signed for localhost and 127.0.0.1 (an upstream the proxy must refuse).
