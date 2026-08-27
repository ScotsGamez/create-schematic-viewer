# Create Schematic Viewer

A local browser GUI for inspecting Create mod NBT schematics.

## Run it

Install the local Python converter dependencies once:

```powershell
npm run setup
```

Start the local app:

```powershell
npm start
```

Then open:

```text
http://localhost:4173
```

The server is intentionally small. It serves the GUI, parses uploaded schematics, and indexes uploaded mod/resource assets. It does not call external asset APIs. Run the app through `npm start`; direct `file://` use is not supported because parsing is server-backed.

The viewer currently uses Three.js from a CDN, so the browser needs internet access the first time it loads the page.

## Current features

- Admin panel for loading multiple mod `.jar` and resource-pack `.zip` files.
- In-page `.litematic`/`.schem` converter panel using the local `litematic-converter` Python CLI.
- Converter output can be kept as one `.nbt` or split into Y-layer part zips by a remembered KB target.
- Server-side asset indexing for `assets/<namespace>/textures`, `models`, and `blockstates`.
- Local asset texture/model resolution is used; no external website API is required.
- Server-side NBT parsing with gzip/deflate support.
- Create/structure-style palette and block list normalization.
- Sponge `.schem` v2 parsing with palette/varint `BlockData` support.
- 3D schematic preview with orbit, pan, zoom, layer slicing, grid, and hologram transparency.
- Transparency controls for overall hologram opacity and glass/pane opacity.
- Orientation calibration panel for NSWE/facing mapping, schematic yaw, axis flips, and clipboard JSON export.
- Local block face textures are applied when a loaded asset pack resolves them; missing local textures use generated visible materials.
- Local model JSON is used for model element geometry when available.
- Opaque full-cube blocks use face culling against solid neighbors.
- Explicit Minecraft-style geometry is preferred for known partial blocks: plants, flowers, crops, panes, slabs, stairs, pipes, faucets/spouts, shafts, girders, scaffolding, ladders, rails, torches, levers, buttons, plates, and carpets.
- Palette/block count inspector.
- Hover readout for block ID and position.
- Client-side block replacement preview with checked wood-family swaps such as Spruce to Oak.
- Replacement export writes modified palette entries back to a downloadable schematic file.
- Converter and replacement logs can be printed to the running CMD/server console from the UI.
- Graceful placeholder coloring for Create/modded/unknown blocks.

## Schematic Conversion

Use the **Litematic Converter** panel in the sidebar:

1. Choose a `.litematic` or `.schem` file.
2. Click **Convert**.
3. Download the generated `.nbt` or click **Load result** to inspect it immediately.

The web app uses the in-repo converter at `converter/litematic_to_nbt.py`, so a fresh clone has the converter code with the app. Python packages are installed into the local `.venv` by `npm run setup`.

## Planned next steps

- Add persistent local asset library selection so loaded packs survive app restarts.
- Improve model geometry beyond the current cube/slab/stair/pane approximations.
- Export edited schematics after block replacement.
