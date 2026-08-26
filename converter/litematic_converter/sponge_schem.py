from __future__ import annotations

from pathlib import Path
from typing import Any

import nbtlib
from nbtlib import Compound, String

from .errors import MalformedLitematicError
from .litematic import LitematicFile, LitematicRegion, Vec3


def load_sponge_schematic(path: str | Path) -> LitematicFile:
    try:
        nbt_file = nbtlib.load(Path(path), gzipped=True)
    except Exception as exc:
        raise MalformedLitematicError(f"Could not read gzipped NBT file {path}: {exc}") from exc

    root = nbt_file.root if hasattr(nbt_file, "root") else nbt_file
    if not isinstance(root, Compound):
        raise MalformedLitematicError("Sponge schematic root tag must be a compound")
    return parse_sponge_root(root)


def parse_sponge_root(root: Compound) -> LitematicFile:
    for key in ("Width", "Height", "Length", "Palette", "BlockData"):
        if key not in root:
            raise MalformedLitematicError(f"Sponge schematic is missing {key!r}")

    size = Vec3(int(root["Width"]), int(root["Height"]), int(root["Length"]))
    volume = size.x * size.y * size.z
    if volume <= 0:
        raise MalformedLitematicError(f"Sponge schematic has invalid size {size.as_list()}")

    palette = _parse_palette(root["Palette"])
    block_state_indices = _decode_varints([int(value) for value in root["BlockData"]], volume)

    if len(block_state_indices) < volume:
        raise MalformedLitematicError(
            f"Sponge BlockData ended early: decoded {len(block_state_indices)} states for volume {volume}"
        )

    metadata = root.get("Metadata")
    if not isinstance(metadata, Compound):
        metadata = Compound()
    region_name = str(metadata.get("Name", "schematic"))

    region = LitematicRegion(
        name=region_name,
        origin=_read_offset(root),
        size=size,
        palette=palette,
        block_state_indices=block_state_indices[:volume],
        block_entities=_read_compound_list(root, ("BlockEntities", "TileEntities")),
        entities=_read_compound_list(root, ("Entities",)),
    )
    return LitematicFile(
        data_version=int(root.get("DataVersion", 0)),
        metadata=metadata,
        regions=[region],
    )


def _parse_palette(raw_palette: Any) -> list[Compound]:
    if not isinstance(raw_palette, Compound):
        raise MalformedLitematicError("Sponge schematic Palette must be a compound")

    indexed: list[tuple[int, Compound]] = []
    for state_text, index in raw_palette.items():
        indexed.append((int(index), _parse_block_state(str(state_text))))

    if not indexed:
        raise MalformedLitematicError("Sponge schematic Palette is empty")

    indexed.sort(key=lambda item: item[0])
    expected = list(range(indexed[-1][0] + 1))
    actual = [index for index, _state in indexed]
    if actual != expected:
        raise MalformedLitematicError("Sponge schematic Palette indices must be contiguous from 0")
    return [state for _index, state in indexed]


def _parse_block_state(text: str) -> Compound:
    if "[" not in text:
        return Compound({"Name": String(text)})

    name, property_text = text.split("[", 1)
    properties = Compound()
    for part in property_text.rstrip("]").split(","):
        if not part:
            continue
        key, value = part.split("=", 1)
        properties[key] = String(value)

    return Compound({"Name": String(name), "Properties": properties})


def _decode_varints(bytes_: list[int], expected_length: int) -> list[int]:
    values: list[int] = []
    value = 0
    shift = 0

    for raw in bytes_:
        byte = raw & 0xFF
        value |= (byte & 0x7F) << shift
        if byte & 0x80:
            shift += 7
            if shift > 35:
                raise MalformedLitematicError("Sponge BlockData contains an oversized varint")
            continue

        values.append(value)
        if len(values) >= expected_length:
            break
        value = 0
        shift = 0

    return values


def _read_offset(root: Compound) -> Vec3:
    offset = root.get("Offset")
    if isinstance(offset, list) and len(offset) >= 3:
        return Vec3(int(offset[0]), int(offset[1]), int(offset[2]))
    return Vec3(0, 0, 0)


def _read_compound_list(parent: Compound, keys: tuple[str, ...]) -> list[Compound]:
    for key in keys:
        value = parent.get(key)
        if value is None:
            continue
        if not isinstance(value, list):
            raise MalformedLitematicError(f"{key} must be a list of compounds")
        return [item for item in value if isinstance(item, Compound)]
    return []
