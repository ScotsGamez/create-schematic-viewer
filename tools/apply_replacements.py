from __future__ import annotations

import gzip
import json
import sys
from io import BytesIO
from pathlib import Path

import nbtlib
from nbtlib import Compound, String


def main() -> int:
    if len(sys.argv) != 4:
        print("Usage: apply_replacements.py <input> <output> <replacements-json>", file=sys.stderr)
        return 2

    input_path = Path(sys.argv[1])
    output_path = Path(sys.argv[2])
    replacements = json.loads(sys.argv[3])

    nbt_file = nbtlib.load(input_path, gzipped=True)
    root = nbt_file.root if hasattr(nbt_file, "root") else nbt_file
    if not isinstance(root, Compound):
        raise ValueError("Schematic root must be a compound.")

    replacement_map = {
        str(item["from"]): parse_block_state(str(item["to"]))
        for item in replacements
        if item.get("from") and item.get("to")
    }

    changed = 0
    changed += update_structure_palette(root, replacement_map)
    changed += update_litematic_palettes(root, replacement_map)
    changed += update_sponge_palette(root, replacement_map)

    if changed == 0:
        raise ValueError("No palette entries matched the requested replacements.")

    raw_output = BytesIO()
    nbt_file.write(raw_output)
    output_path.write_bytes(gzip.compress(raw_output.getvalue(), compresslevel=9, mtime=0))
    print(json.dumps({"changed": changed}))
    return 0


def update_structure_palette(root: Compound, replacements: dict[str, Compound]) -> int:
    changed = 0
    for key in ("palette", "Palette"):
        palette = root.get(key)
        if isinstance(palette, list):
            changed += update_palette_list(palette, replacements)
    return changed


def update_litematic_palettes(root: Compound, replacements: dict[str, Compound]) -> int:
    regions = root.get("Regions")
    if not isinstance(regions, Compound):
        return 0

    changed = 0
    for region in regions.values():
        if not isinstance(region, Compound):
            continue
        palette = region.get("BlockStatePalette")
        if isinstance(palette, list):
            changed += update_palette_list(palette, replacements)
    return changed


def update_sponge_palette(root: Compound, replacements: dict[str, Compound]) -> int:
    palette = root.get("Palette")
    if not isinstance(palette, Compound):
        return 0

    changed = 0
    updated = Compound()
    for key, index in palette.items():
        replacement = replacements.get(str(key))
        next_key = format_block_state(replacement) if replacement is not None else str(key)
        if next_key in updated:
            raise ValueError(
                f"Sponge .schem replacement would merge duplicate palette key {next_key!r}. "
                "Convert to .nbt first, then save replacements."
            )
        updated[next_key] = index
        if replacement is not None:
            changed += 1

    if changed:
        root["Palette"] = updated
    return changed


def update_palette_list(palette: list, replacements: dict[str, Compound]) -> int:
    changed = 0
    for index, entry in enumerate(palette):
        if not isinstance(entry, Compound):
            continue
        label = format_block_state(entry)
        replacement = replacements.get(label)
        if replacement is None:
            continue
        palette[index] = clone_state(replacement)
        changed += 1
    return changed


def parse_block_state(text: str) -> Compound:
    if "[" not in text:
        return Compound({"Name": String(text)})

    name, raw_properties = text.split("[", 1)
    properties = Compound()
    for part in raw_properties.rstrip("]").split(","):
        if not part or "=" not in part:
            continue
        key, value = part.split("=", 1)
        properties[key] = String(value)

    state = Compound({"Name": String(name)})
    if properties:
        state["Properties"] = properties
    return state


def clone_state(state: Compound) -> Compound:
    copied = Compound({"Name": String(str(state["Name"]))})
    properties = state.get("Properties")
    if isinstance(properties, Compound) and properties:
        copied["Properties"] = Compound({str(key): String(str(value)) for key, value in properties.items()})
    return copied


def format_block_state(state: Compound) -> str:
    name = str(state.get("Name", "unknown:block"))
    properties = state.get("Properties")
    if not isinstance(properties, Compound) or not properties:
        return name
    return f"{name}[{','.join(f'{key}={value}' for key, value in properties.items())}]"


if __name__ == "__main__":
    raise SystemExit(main())
