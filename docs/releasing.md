# Releasing

Stable releases are built by GitHub Actions from a tag reachable from `main`.
The workflow publishes a GHCR image, attaches BuildKit and signed registry
provenance plus an SPDX SBOM, then pulls and smoke-tests the resulting immutable
digest.

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

The repository and GHCR package are public. Operators can pull the image without
a registry credential. Public package visibility cannot be reverted to private.
If a differently named future package is private, authenticate with a dedicated
read-only credential; never reuse the workflow token or place a registry token
in Compose files, shell history, repository files, or image layers.

## v1.0.0 attestation recovery

The original `v1.0.0` release run published the immutable image, BuildKit
provenance, and SPDX SBOM while the repository was private. GitHub's signed
artifact-attestation step was unavailable under that visibility and the later
smoke-test steps were skipped. After the repository and package became public,
`.github/workflows/recover-v1.0.0-attestation.yml` was added as a one-time,
manually dispatched recovery.

The recovery is hard-coded to the original release tag, source commit, workflow
run, and image digest. It verifies both discovery tags and the image labels,
validates the original in-index BuildKit SLSA provenance, repeats the PII and
full-history secret scans, and anonymously smoke-tests the image. It does not
re-sign that historical build provenance or claim that the recovery workflow
built `v1.0.0`. It creates one signed in-toto attestation using the
`https://in-toto.io/attestation/release/v0.1` predicate. Its subject is the
unchanged image-index digest, and its OCI purl binds `v1.0.0` to the GHCR package.
Before signing, it proceeds only when the GitHub API confirms repository access
and explicitly reports no existing release attestation for that fixed subject.
An existing record or indeterminate response fails closed. The recovery cannot
accept a different subject, build an image, retag, or alter the image or index.
After signing, it verifies the release attestation through GitHub and GHCR and
confirms both tag digests remain unchanged.

The signing action persists the GitHub attestation before uploading its bundle
to GHCR. If a run fails between those operations, a rerun intentionally stops at
the duplicate preflight rather than creating another signature. Preserve the
failed run as evidence, verify GitHub and GHCR separately, and use a separately
reviewed reconciliation change to attach the existing signed bundle to GHCR.

Run `33083716510` reached that split state: it persisted exactly one valid
release attestation in GitHub, then failed because the signing action could not
find the GHCR credential written to an isolated Docker configuration. The image
index and both discovery tags remained unchanged, and GHCR had no release-bundle
referrer. The protected, manually dispatched
`.github/workflows/reconcile-v1.0.0-attestation.yml` workflow repairs only that
registry attachment. It downloads the existing GitHub bundle, verifies its
signature, workflow identity, source revision, fixed subject, predicate, and
purl, then attaches those exact signed bytes to the immutable image digest. It
does not sign, create another GitHub attestation, publish an image, or move a
tag. An absent matching GHCR bundle is attached; one canonically identical
bundle is verification-only; duplicates, mismatches, and indeterminate states
fail closed. The workflow finishes by verifying the same attestation through
both GitHub and GHCR and confirming both discovery tags still resolve to the
original index digest.

The recovery job targets the protected `attestation-recovery` environment. That
environment must require at least one reviewer, prevent self-review, and disable
administrator bypass; the job also checks those rules and fails closed before
signing if they are absent.

## Verify and roll back

Before deployment, pull the image by digest and verify `/readyz` in the shared
`tools/smoke_container.sh` non-root, read-only container configuration used by
CI. Record the deployed digest with the LANtern release record.

Rollback means restoring the previously recorded digest and recreating only
the viewer and Minecraft UI services. The schematic-library volume is not
deleted or replaced during an image rollback. Back up the library separately
before any data migration.
