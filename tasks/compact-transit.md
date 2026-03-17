# Plan: Compact Transit Encoding for jseeqret

## Overview

When sharing secrets between users, jseeqret currently serialises a `SecretPacket`
as a pretty-printed JSON object (~600 B for a typical two-secret payload).
Because **both sender and receiver already know the schema**, we can strip all
key names, hoist repeated fields, and store encrypted values as raw bytes instead
of their base64 representation — reducing the wire payload to ~240–280 B
(~53 % of original) before any transport-layer encoding.

This plan describes the design, implementation steps, test strategy, and
cross-language compatibility notes for adding a `compact` codec to
`src/core/compact.js`.

---

## Background: Size Analysis

| Format | Bytes | vs. pretty JSON |
|---|---|---|
| Pretty JSON | 596 | 100 % |
| Minified JSON | 434 | 72.8 % |
| Raw → zlib → base64 | 468 | 78.5 % |
| **Pipe-delimited (schema-aware)** | **274** | **46 %** |
| Pipe-delimited → zlib → base64 | 324 | 54.4 % |
| Binary struct + raw secret bytes | 237 | 39.8 % |
| Binary → zlib → base64 | 320 | 53.7 % |

Key observations:
1. Key names (`"app"`, `"env"`, `"key"`, `"value"`, `"type"`) repeated per-secret
   account for ~150 B.
2. The `value` fields are already base64-encoded ciphertext; storing them as raw
   bytes saves another ~33 % on those fields and improves compressibility.
3. `app`, `env`, and `type` are typically identical across all secrets in a
   packet — they can be hoisted to a single header line.

**Chosen format**: pipe-delimited text with raw-byte values stored as hex or
re-encoded base64 only at the outermost transport boundary. This keeps the codec
simple, human-debuggable, and free of binary framing concerns.

---

## Wire Format Specification (`SQP/1` — SeQret Packet v1)

```
SQP/1|<version>|<from>|<to>|<signature>|<app>|<env>|<type>|<N>|<key1>|<val1>|...|<keyN>|<valN>
```

### Fields

| Position | Field | Notes |
|---|---|---|
| 0 | Magic | Always `SQP/1` — version of the compact format itself |
| 1 | `version` | Packet schema version integer (currently `1`) |
| 2 | `from` | Sender username |
| 3 | `to` | Recipient username |
| 4 | `signature` | SHA-256 signature (hex or truncated) |
| 5 | `app` | Shared app name (hoisted from secrets array) |
| 6 | `env` | Shared env (hoisted) |
| 7 | `type` | Shared secret type, e.g. `str` (hoisted) |
| 8 | `N` | Number of secrets (integer) |
| 9 … 9+2N-1 | `key_i`, `val_i` | Alternating key / base64url-encoded encrypted value |

### Value encoding

Encrypted `value` fields arrive from the DB as standard base64 (with `+`, `/`,
`=`). For transport they are re-encoded as **base64url** (URL-safe, no padding)
so the pipe delimiter cannot collide with value content.

```
value_transport = btoa(atob(value_db)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
```

Decoding reverses this before writing back to the DB.

### Example

```
SQP/1|1|bjorn|VebjørnKarisari|ae947|yerbu|dev|str|2|GITHUB_CLIENT_ID|Ig2AvSSzsGY21hNkoUBX4h02fEcbtfOwwdIj6YHkN-ASu2jZ9c6BAO5or0kMOF9PNfk4C1iYAwRX5T36|GITHUB_CLIENT_SECRET|JBxPZtWfojWKEVrY2QUkaqv2R625OShvvTAalzjYqdzFdlnmtq76WMSuoBMj2iEAIn8-ycG4Xw77yd1CkA1K3H2eCpcI_bjW43rvbEBv_x4
```

Length: **274 B** (vs 596 B original).

### Heterogeneous secrets (different app/env/type)

If secrets in a packet span multiple `(app, env, type)` combinations — which
the current seeqret model allows — the hoisted header fields are set to the
**most common** combination and the remaining secrets fall back to an extended
per-secret notation:

```
SQP/1|1|from|to|sig|dominant_app|dominant_env|dominant_type|N|key1|val1|[app2:env2:type2]key2|val2|...
```

Bracket-prefixed keys carry their own `app:env:type` context. This is detected
by the decoder via the `[` prefix character, which cannot appear in a valid key
name.

---

## Implementation Plan

### Phase 1 — Core codec (`src/core/compact.js`)

**File**: `src/core/compact.js`

#### 1.1 `encode(packet)` → `string`

```js
/**
 * Encode a SecretPacket to compact SQP/1 wire format.
 *
 * @param {object} packet
 * @param {number} packet.version
 * @param {string} packet.from
 * @param {string} packet.to
 * @param {string} packet.signature
 * @param {Array<{app:string, env:string, key:string, value:string, type:string}>} packet.secrets
 * @returns {string} Compact pipe-delimited string
 */
export function encode(packet) { ... }
```

Steps:
1. Validate packet shape; throw `CompactEncodeError` on bad input.
2. Find dominant `(app, env, type)` by frequency count.
3. Re-encode each `value` from standard base64 → base64url (no padding).
4. For each secret: if `(app, env, type)` matches dominant, emit `key|val`;
   otherwise emit `[app:env:type]key|val`.
5. Join all parts with `|` and prepend `SQP/1|`.

#### 1.2 `decode(str)` → `object`

```js
/**
 * Decode a SQP/1 compact string back to a SecretPacket.
 *
 * @param {string} str
 * @returns {object} SecretPacket
 * @throws {CompactDecodeError} on malformed input or unknown magic
 */
export function decode(str) { ... }
```

Steps:
1. Split on `|`; check magic `SQP/1` and minimum field count.
2. Parse header fields (positions 1–8).
3. Iterate key/value pairs; detect `[app:env:type]` prefix and override per
   secret.
4. Re-encode value from base64url → standard base64 (restore `+`, `/`, `=`).
5. Return structured packet object.

#### 1.3 Error classes

```js
export class CompactEncodeError extends Error {}
export class CompactDecodeError extends Error {}
```

#### 1.4 Helpers

```js
// base64 ↔ base64url conversion (no external deps — pure string ops)
function toBase64url(b64) { ... }
function fromBase64url(b64url) { ... }

// Dominant value by frequency
function dominant(values) { ... }
```

---

### Phase 2 — Tests (`tests/compact.test.js`)

Use the existing **vitest** setup.

#### Test cases

```
encode → decode roundtrip (single secret)
encode → decode roundtrip (multiple secrets, same app/env/type)
encode → decode roundtrip (heterogeneous app/env/type)
encode produces SQP/1 magic prefix
encode produces correct field count
encode: base64url values contain no +, /, = characters
decode: throws CompactDecodeError on truncated input
decode: throws CompactDecodeError on wrong magic
decode: throws CompactDecodeError on non-integer N
decode: handles base64url padding-free values correctly
encode/decode: packet with Unicode username (VebjørnKarisari)
size: encoded string is ≤ 50% of JSON.stringify(packet) for typical payload
```

Write tests **before** implementation (TDD) to lock the API.

---

### Phase 3 — CLI integration (`src/cli/`)

Add two new subcommands to the CLI:

#### `seeqret send <filter> --to <user>`

1. Query secrets matching `<filter>` (reuse existing filter logic).
2. Encrypt values for recipient's public key (reuse existing `transit` crypto).
3. Encode packet with `compact.encode()`.
4. Print the compact string to stdout (can be pasted / QR-coded / emailed).

#### `seeqret receive <compact-string>`

1. Call `compact.decode()`.
2. Decrypt values using own private key.
3. Import secrets into local vault (reuse existing storage layer).

Alternatively, if `send`/`receive` commands already exist using the JSON format,
add a `--compact` flag to both and keep backward compatibility with raw JSON
(auto-detect on `receive` by checking for `SQP/1` prefix).

---

### Phase 4 — Python seeqret compatibility

The compact format must be decodable by the Python `seeqret` tool as well.
Add a `seeqret/transit/compact.py` module there with equivalent `encode` /
`decode` functions following the same spec.

Compatibility test: encode in JS, decode in Python and vice-versa — add as a
cross-language integration test using a shared fixture file
(`tests/fixtures/compact_roundtrip.txt`).

---

## Files to Create / Modify

| File | Action | Notes |
|---|---|---|
| `src/core/compact.js` | **Create** | Core codec |
| `tests/compact.test.js` | **Create** | Vitest unit tests |
| `src/cli/commands/send.js` | **Create or modify** | CLI send command |
| `src/cli/commands/receive.js` | **Create or modify** | CLI receive command |
| `src/cli/index.js` | **Modify** | Register new commands |
| `README.md` | **Update** | Document compact format and new CLI commands |
| `TODO.md` | **Update** | Track implementation tasks |
| `TASKS.md` | **Update** | Detailed next steps |
| `STATUS.md` | **Update** | After implementation |

---

## Open Questions / Decisions Needed

1. **Pipe character in usernames/keys?**  
   Current seeqret schema probably forbids `|` in usernames and key names — confirm
   and add a validator. If not, switch delimiter to `\x1F` (unit separator) and
   base64-encode the whole string for text-safe transport.

2. **Multi-app packets in practice?**  
   The heterogeneous fallback (`[app:env:type]key`) adds complexity. If real usage
   always sends homogeneous packets, remove this and enforce it with a
   pre-encode assertion.

3. **Compression layer?**  
   At ~274 B, adding zlib + base64 brings it back to ~324 B — a net loss vs the
   compact string alone. Skip compression unless payloads regularly exceed ~2 KB
   (i.e., ~15+ secrets per packet).

4. **QR code output?**  
   274 B fits comfortably in a QR code at error correction level M (~1273
   byte capacity). Consider a `--qr` flag on `send` using the `qrcode` npm
   package.

5. **Versioning of the compact format?**  
   The magic `SQP/1` carries a format version. Future breaking changes bump to
   `SQP/2`. The decoder should reject unknown magic with a clear error message.

---

## Acceptance Criteria

- [ ] `encode(decode(encode(packet))) === encode(packet)` for all valid inputs
- [ ] Encoded string is ≤ 50 % of minified JSON for a standard two-secret packet
- [ ] `SQP/1` magic is present and checked on decode
- [ ] All vitest tests pass (`npm test`)
- [ ] CLI `send` / `receive` work end-to-end on a local vault
- [ ] Python seeqret can decode a JS-produced compact string (cross-language test)
- [ ] No new runtime dependencies required (pure JS, no extra npm packages)
