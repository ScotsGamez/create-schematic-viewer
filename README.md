# Create Schematic Viewer

[![CI](https://github.com/ScotsGamez/create-schematic-viewer/actions/workflows/ci.yml/badge.svg)](https://github.com/ScotsGamez/create-schematic-viewer/actions/workflows/ci.yml)

Inspect, convert, and prepare Minecraft schematics in a local browser workspace.

Create Schematic Viewer provides a 3D preview, palette inspection, orientation
tools, local resource-pack rendering, and conversion to vanilla structure NBT.
It is designed to work without sending schematic files to a third-party
schematic service.

> [!IMPORTANT]
> This is an unofficial community project. It is not affiliated with or
> endorsed by Mojang Studios, Microsoft, or the Create mod team. Minecraft and
> Create names belong to their respective owners. No game or mod assets are
> distributed with this repository.

## What it does

- Previews vanilla structure `.nbt`, Sponge `.schem`, and zipped `.nbt` parts.
- Renders schematics in 3D with orbit, pan, zoom, layer slicing, grid, and
  transparency controls.
- Inspects palettes, block counts, block positions, and orientation mappings.
- Loads user-supplied mod `.jar` and resource-pack `.zip` files for local
  texture and model resolution.
- Converts Litematica `.litematic` and Sponge `.schem` files to
  vanilla/Create-compatible `.nbt` for preview or export.
- Previews selected wood-family replacements and exports a modified schematic.

The viewer is under active development. Back up important schematics and verify
converted files in a safe test world before relying on them.

## Requirements

- [Node.js](https://nodejs.org/) 22 or newer
- [Python](https://www.python.org/) 3.10 or newer

Minecraft, a game launcher, and Create are not required to run the viewer.

## Quick start

```shell
git clone https://github.com/ScotsGamez/create-schematic-viewer.git
cd create-schematic-viewer
npm run setup
npm start
```

Open <http://localhost:4173>.

`npm run setup` creates a repository-local Python environment for the converter.
Set `PORT` before starting the app to use another port. The server binds to
`127.0.0.1` by default; set `HOST` only when deliberately exposing it to a
trusted network. The browser UI must be served by the Node application; opening
`public/index.html` through `file://` is not supported.

### Container

Build and run the pinned, non-root container while publishing it only on the
local machine:

```shell
docker build --tag create-schematic-viewer .
docker run --rm --publish 127.0.0.1:4173:4173 --read-only --tmpfs /app/.tmp:rw,noexec,nosuid,size=512m create-schematic-viewer
```

Liveness and readiness probes are available at `/healthz` and `/readyz`.

## Typical workflow

1. Start the app and open the local URL.
2. Optionally load resource packs or mod JARs in the **Admin** panel.
3. Select a supported schematic file.
4. Inspect its blocks, layers, orientation, and replacement preview.
5. Download a converted or modified `.nbt` file.

To use an exported structure with Create, place the `.nbt` file in the
appropriate client schematic directory and follow Create's in-game Schematic
Table workflow. Exact paths and behavior depend on the Minecraft instance and
Create version.

## Development

Run the JavaScript checks and tests:

```shell
npm run check
npm test
```

Run the converter tests after `npm run setup`:

```shell
npm run check:converter
```

Tests use synthetic fixtures and do not require Minecraft files. See
[CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request.

## Security and privacy

Uploaded files are processed by the local Node and Python application. The
server does not provide authentication, so do not expose it directly to the
public internet or run untrusted uploads on a sensitive host. Review
[SECURITY.md](SECURITY.md) for reporting guidance and operational cautions.

## LANtern integration

Create Schematic Viewer is planned to become the schematic workspace inside
the **LANtern Minecraft** UI. LANtern will own the surrounding product shell
while this project remains a reusable viewer. That integration is planned work;
it is not included in the current standalone application.

## Contributing and support

Contributions are welcome. Start with the [contribution guide](CONTRIBUTING.md)
and use the issue templates for reproducible bugs or focused feature proposals.
For usage help, see [SUPPORT.md](SUPPORT.md).

## License

Licensed under the [MIT License](LICENSE).
