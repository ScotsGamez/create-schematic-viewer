# Security Policy

## Supported versions

The project has not published a stable release. Security fixes are currently
made on the default branch and will be included in the next release candidate.

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

The standalone server currently has no authentication or authorization. It
accepts schematic, mod JAR, and resource-pack uploads and invokes a local Python
converter. Treat uploaded files as untrusted, run the application with minimal
host privileges, and do not expose it directly to the public internet.

Never commit or attach real player data, private server files, credentials,
access tokens, or proprietary game/mod assets when reporting an issue.
