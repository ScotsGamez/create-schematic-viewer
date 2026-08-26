# Library operations

The shared schematic and asset libraries live under `DATA_DIR` (`.data` by
default and `/data` in the container image). Keep this directory on persistent
storage. It contains immutable content-addressed objects plus small JSON
manifests; it is application data and must not be committed to Git.

The server is read-only by default. Set `LIBRARY_WRITE_ENABLED=true` only for
a trusted curator session or behind an authenticated reverse-proxy route. The
flag does not identify users and must not be treated as authentication.

## Import boundary

The shared schematic library accepts validated `.nbt` files. Convert
`.litematic` and `.schem` files in the viewer before importing them. Each import
retains the exact uploaded bytes as the original, stores a deterministic
gzip-canonicalized `.nbt` object, records normalized metadata and provenance,
and creates a deterministic SVG preview. Trash is recoverable and does not
delete stored objects.

Imported mod JARs and resource-pack ZIPs are archived after successful
indexing. The server rehydrates them in original import order at startup.

## Backup

Stop the application, then provide a new destination directory:

```shell
npm run library:backup -- ../schematic-library-backup-2026-08-26
```

The command copies the complete data directory and writes a format marker. It
will not follow symbolic links, copy special filesystem entries, use a nested
destination, or overwrite an existing directory.

## Restore

Restore into a new, empty destination. The command intentionally refuses to
replace an existing `DATA_DIR`:

```powershell
$env:DATA_DIR = "..\restored-schematic-data"
npm run library:restore -- ..\schematic-library-backup-2026-08-26
```

Start the application and check `/readyz`. Then open the library, verify a
schematic preview and download, and confirm the expected asset packs appear.
Keep the source backup until those checks succeed.
