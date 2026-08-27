# Changelog

All notable changes to Create Schematic Viewer are recorded here.

## 1.0.0 - 2026-08-27

### Added

- A modular browser viewer for Create, Sponge, Litematica, and vanilla
  structure formats.
- A persistent, searchable schematic library with validation, previews,
  version-ready manifests, soft deletion, backup, and restore tooling.
- A non-root production container with health and readiness probes.
- A trusted-proxy contract for embedding the viewer in LANtern without
  exposing administrator credentials to browsers.
- Linux and Windows CI, secret-history scanning, container smoke tests, and
  immutable GHCR release publishing with signed provenance and an SPDX SBOM.
- Redacted PII heuristic scanning for tracked files and commit authors before
  release publication.

### Security

- Library mutation is disabled by default and requires an explicit local or
  trusted-proxy authorization mode.
- Browser credentials, proxy credentials, and file-mounted service tokens are
  isolated from viewer responses and public container ports.
