# Litematic Converter

Offline CLI converter for Minecraft Litematica `.litematic` and Sponge
`.schem` files to vanilla structure block `.nbt` files.

The tool reads gzipped NBT Litematica or Sponge schematic files, extracts
regions, decodes packed block states, preserves block state properties, rewrites
block entity positions into vanilla structure-local coordinates, and writes
gzipped vanilla structure NBT.

## Install

Use Python 3.10 or newer.

```bash
pip install -r requirements.txt
```

No Minecraft, Fabric, Forge, Litematica, game assets, or web services are
required.

## Usage

```bash
python litematic_to_nbt.py input.litematic output.nbt
python litematic_to_nbt.py input.schem output.nbt
```

When `output.nbt` is a file path, all selected regions are merged into one
vanilla structure using a single bounding box.

Export multiple regions separately by passing an output directory:

```bash
python litematic_to_nbt.py input.litematic output_folder/
```

List regions:

```bash
python litematic_to_nbt.py --list-regions input.litematic
```

Dry run:

```bash
python litematic_to_nbt.py --dry-run input.litematic out.nbt
```

Export one region:

```bash
python litematic_to_nbt.py --region House input.litematic house.nbt
```

Verbose logging:

```bash
python litematic_to_nbt.py --verbose input.litematic out.nbt
```

## Output Format

The current output format is vanilla Minecraft structure NBT:

- `DataVersion`
- `size`: `[x, y, z]`
- `palette`: block state compounds with `Name` and optional `Properties`
- `blocks`: compounds with `state`, `pos`, and optional `nbt`
- `entities`: only when entity data can be safely represented

The CLI includes `--format nbt` so additional formats such as Sponge `.schem`
can be added later without changing the command shape.

## Region Handling

Litematica regions can have negative sizes. This converter normalizes each
region into the vanilla structure coordinate space while preserving the intended
world placement. For merged exports, it computes a bounding box across all
selected regions and offsets every block into that shared local coordinate
space.

If a directory is used as the output, each selected region is exported as its
own `.nbt` file named after the region.

## Block Entities

Block entity NBT is preserved where possible. Coordinates are rewritten to
structure-local positions:

- `x`, `y`, `z` integer fields are updated when present.
- `Pos` list fields are updated when present.

The converter accepts block entity coordinates that are already absolute world
coordinates or local region coordinates. Ambiguous coordinates outside the
region are preserved with a warning.

## Entities

Entity conversion is conservative. Entities are exported only when they have:

- an `id`
- a numeric `Pos` list

Unsupported or ambiguous entity records are skipped with a warning rather than
being written incorrectly.

## Minecraft Version Notes

The output `DataVersion` is copied from `MinecraftDataVersion` in the litematic
root, falling back to `DataVersion` or `0` if absent. Minecraft structure block
format has stayed broadly stable across modern versions, but block and entity
IDs remain version-specific. For best results, load the generated `.nbt` in a
Minecraft version compatible with the source litematic.

## Limitations

- The converter focuses on `.litematic` / Sponge `.schem` -> vanilla `.nbt`.
- Exact Litematica edge cases can vary between versions. This tool validates the
  common NBT shape: root metadata, regions, positions, sizes, palettes, packed
  block states, block entities, and entities.
- Entity conversion intentionally skips records without safe vanilla structure
  position data.
- The converter does not validate that block IDs are available in the target
  Minecraft version.

## Development

Run tests:

```bash
pytest
```

The tests use synthetic NBT fixtures and do not require Minecraft files.
