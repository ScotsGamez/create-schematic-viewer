# Security Policy

## Supported versions

| Version | Supported |
| --- | --- |
| 1.0.x | Yes |
| Earlier versions | No |

Security fixes are developed on the default branch and released in the next
available patch version. Deployments should use an immutable container digest
from a supported release rather than a mutable tag.

## Report a vulnerability

Do not disclose a suspected vulnerability in a public issue, discussion, pull
request, or log.

Use GitHub's **Report a vulnerability** option in this repository's Security
tab when it is available. If that option is unavailable, open a minimal issue
asking a maintainer to establish private contact; do not include exploit steps,
sensitive files, secrets, personal information, or server details in that
issue.

Please include, through the private channel:

- The affected revision or version.
- The impact and prerequisites.
- Minimal reproduction steps or a proof of concept.
- Suggested mitigations, if known.
- Whether the issue has been disclosed elsewhere.

Allow maintainers a reasonable period to investigate and coordinate a fix
before public disclosure.

## Deployment cautions

The standalone server has no end-user authentication. Persistent library
changes are disabled by default and can be guarded by the trusted-proxy mode,
but parsing and conversion endpoints still accept user-controlled files. Treat
uploads as untrusted, run the application with minimal host privileges, and do
not expose it directly to the public internet. See the
[LANtern embed contract](docs/lantern-embed-contract.md) for the private-sidecar
authorization boundary.

Never commit or attach real player data, private server files, credentials,
access tokens, or proprietary game/mod assets when reporting an issue.
