# Releasing

Stable releases are built by GitHub Actions from a tag reachable from `main`.
The workflow publishes a private GHCR image, attaches BuildKit and signed
registry provenance plus an SPDX SBOM, then pulls and smoke-tests the resulting
immutable digest.

## Preconditions

1. Merge all release changes through reviewed feature branches.
2. Require green Linux, Windows, container, Git-history secret-scan, and PII
   heuristic-scan jobs on `main`.
3. Confirm `package.json`, `package-lock.json`, and `CHANGELOG.md` use the same
   stable semantic version.
4. Confirm the release tag does not already exist. Release tags are never
   moved or reused.

Run `npm run check:pii` before pushing the release branch. The scanner checks
tracked text for email addresses, formatted phone numbers, and user home paths,
and checks commit-author emails while allowing GitHub no-reply identities. It
reports locations with values redacted. The release workflow repeats this scan
before registry authentication and publication.

## Publish

Create a non-draft, non-prerelease GitHub release whose tag is
`vMAJOR.MINOR.PATCH` and whose target is `main`. Publishing the release triggers
`.github/workflows/release.yml`.

The workflow refuses tags that do not match `package.json` or that point to a
commit outside `main`. It publishes two discovery tags: the stable release tag
and a full commit-SHA tag. Neither is used as the deployment identity; use the
`ghcr.io/scotsgamez/create-schematic-viewer@sha256:...` coordinate written to
the workflow summary.

## Package access

The image remains private unless the repository owner deliberately changes the
GHCR package visibility. Operators authenticate with a dedicated credential
that has read-only package access. Do not reuse the workflow token or place a
registry token in Compose files, shell history, repository files, or image
layers.

## Verify and roll back

Before deployment, pull the image by digest and verify `/readyz` in the shared
`tools/smoke_container.sh` non-root, read-only container configuration used by
CI. Record the deployed digest with the LANtern release record.

Rollback means restoring the previously recorded digest and recreating only
the viewer and Minecraft UI services. The schematic-library volume is not
deleted or replaced during an image rollback. Back up the library separately
before any data migration.
