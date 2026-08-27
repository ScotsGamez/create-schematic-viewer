# LANtern embed contract

This document defines contract version 1 between LANtern's Minecraft UI and
Create Schematic Viewer. It deliberately uses an HTTP boundary: neither project
imports the other's application code, and no browser messaging bridge is
required.

## Deployment shape

LANtern publishes the Minecraft UI on port `8093`. The viewer runs as a private
sidecar on port `4173`; its port must not be published to the host or LAN.

```text
Browser :8093
  /                 LANtern Minecraft shell
  /schematics/      prefix-stripping reverse proxy
                           -> http://schematic-viewer:4173/
```

The proxy must return `308 Permanent Redirect` from `/schematics` to
`/schematics/`, then remove the `/schematics` prefix before forwarding. The
trailing slash is required because browser assets and API bases are relative.
The viewer remains independently runnable at `/` when used outside LANtern.

LANtern may show `/schematics/` in a same-origin, full-height iframe. Viewer
responses allow same-origin framing and deny cross-origin framing. No CORS or
`postMessage` interface is part of this contract.

## Discovery and health

After prefix removal, the following upstream routes are stable:

| Route | Purpose |
| --- | --- |
| `GET /api/v1/capabilities` | Contract version and request-scoped features |
| `GET /healthz` | Process liveness |
| `GET /readyz` | Static runtime, persistent storage, and asset rehydration readiness |

LANtern should verify `application=create-schematic-viewer` and
`contractVersion=1` before treating the sidecar as compatible. Health probes
should address the sidecar directly over its private network. `/readyz`
requires a writable persistent `DATA_DIR` even when library changes are
disabled.

## Persistent-library authorization

Production embedding uses:

```text
LIBRARY_WRITE_MODE=trusted-proxy
LIBRARY_ADMIN_TOKEN_FILE=/run/secrets/schematic_viewer_admin_token
```

The token file must contain at least 32 bytes and be generated outside Git. The
viewer compares it in constant time and never returns it in a response.

LANtern owns administrator login, session expiry, rate limiting, and
same-origin request protection. Its proxy must remove every client-supplied
`X-Lantern-Schematic-Admin` header. It may inject that header with the file
token only after authenticating the current request as an administrator. The
viewer returns `403` for missing or invalid credentials and does not issue an
HTTP authentication challenge.

The credential protects all persistent mutations:

- `POST /api/v1/library/assets`
- `POST /api/v1/library/schematics`
- `POST /api/v1/library/schematics/:id/versions`
- `POST /api/v1/library/schematics/:id/restore`
- `DELETE /api/v1/library/schematics/:id`
- legacy `POST /api/assets/upload`

Library reads, local schematic parsing, conversion, replacement generation,
and downloads remain available without administrator credentials. Capability
responses are request-scoped so the viewer hides mutation controls from
ordinary users.

## Proxy behavior

The proxy must:

- strip client-supplied `Forwarded`, `X-Forwarded-*`, and trusted-admin headers;
- preserve query strings, status codes, binary bodies, `Content-Disposition`,
  cache headers, and converter metadata headers;
- stream uploads and downloads rather than buffering entire archives;
- allow request bodies up to 250 MiB;
- allow a bounded conversion timeout of at least five minutes;
- rewrite any future root-absolute upstream `Location` value beneath
  `/schematics/`;
- keep the sidecar and its persistent `/data` volume available independently of
  the Minecraft game server's running state.

Security headers are emitted by the viewer, including a same-origin frame
policy, `nosniff`, a restrictive permissions policy, and no-referrer behavior.
LANtern must preserve them. HSTS is intentionally absent while LANtern uses
plain HTTP on a private LAN.

## Non-goals

This contract covers catalogue browsing, viewing, conversion, download, and
curation. It does not place structures into a world, copy files into a player's
Create directory, expose the viewer sidecar publicly, or combine the Minecraft
UI with the CS2 or Stardew applications. Each of those would require a separate
design and approval gate.
