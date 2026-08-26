from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import nbtlib
from nbtlib import Compound

from .errors import MalformedLitematicError
from .packing import decode_packed_block_states


AIR = "minecraft:air"


@dataclass(frozen=True)
class Vec3:
    x: int
    y: int
    z: int

    def as_list(self) -> list[int]:
        return [self.x, self.y, self.z]


@dataclass
class LitematicRegion:
    name: str
    origin: Vec3
    size: Vec3
    palette: list[Compound]
    block_state_indices: list[int]
    block_entities: list[Compound] = field(default_factory=list)
    entities: list[Compound] = field(default_factory=list)

    @property
    def abs_size(self) -> Vec3:
        return Vec3(abs(self.size.x), abs(self.size.y), abs(self.size.z))

    @property
    def volume(self) -> int:
        s = self.abs_size
        return s.x * s.y * s.z

    @property
    def min_corner(self) -> Vec3:
        return Vec3(
            self.origin.x if self.size.x >= 0 else self.origin.x + self.size.x + 1,
            self.origin.y if self.size.y >= 0 else self.origin.y + self.size.y + 1,
            self.origin.z if self.size.z >= 0 else self.origin.z + self.size.z + 1,
        )

    @property
    def max_corner(self) -> Vec3:
        mn = self.min_corner
        s = self.abs_size
        return Vec3(mn.x + s.x - 1, mn.y + s.y - 1, mn.z + s.z - 1)

    def index_to_region_coords(self, index: int) -> Vec3:
        s = self.abs_size
        if s.x == 0 or s.y == 0 or s.z == 0:
            raise MalformedLitematicError(f"Region {self.name!r} has a zero-sized axis")
        x = index % s.x
        z = (index // s.x) % s.z
        y = index // (s.x * s.z)
        return Vec3(x, y, z)

    def region_to_world(self, local: Vec3) -> Vec3:
        return Vec3(
            self.origin.x + local.x if self.size.x >= 0 else self.origin.x - local.x,
            self.origin.y + local.y if self.size.y >= 0 else self.origin.y - local.y,
            self.origin.z + local.z if self.size.z >= 0 else self.origin.z - local.z,
        )


@dataclass
class LitematicFile:
    data_version: int
    metadata: Compound
    regions: list[LitematicRegion]


def load_litematic(path: str | Path) -> LitematicFile:
    try:
        nbt_file = nbtlib.load(Path(path), gzipped=True)
    except Exception as exc:  # nbtlib raises several low-level parse errors.
        raise MalformedLitematicError(f"Could not read gzipped NBT file {path}: {exc}") from exc
    root = nbt_file.root if hasattr(nbt_file, "root") else nbt_file
    if not isinstance(root, Compound):
        raise MalformedLitematicError("Litematic root tag must be a compound")
    return parse_litematic_root(root)


def parse_litematic_root(root: Compound) -> LitematicFile:
    regions_tag = _require_compound(root, "Regions", "root")
    if not regions_tag:
        raise MalformedLitematicError("Litematic contains no regions")

    metadata = _optional_compound(root, "Metadata")
    data_version = int(root.get("MinecraftDataVersion", root.get("DataVersion", 0)))

    regions = [
        _parse_region(str(region_name), region_tag)
        for region_name, region_tag in regions_tag.items()
    ]
    return LitematicFile(data_version=data_version, metadata=metadata, regions=regions)


def _parse_region(name: str, tag: Any) -> LitematicRegion:
    if not isinstance(tag, Compound):
        raise MalformedLitematicError(f"Region {name!r} must be a compound")

    origin = _read_vec3(tag, "Position", f"region {name!r}", default=Vec3(0, 0, 0))
    size = _read_vec3(tag, "Size", f"region {name!r}")
    abs_size = Vec3(abs(size.x), abs(size.y), abs(size.z))
    volume = abs_size.x * abs_size.y * abs_size.z
    if volume <= 0:
        raise MalformedLitematicError(f"Region {name!r} has invalid zero volume size {size.as_list()}")

    palette_tag = tag.get("BlockStatePalette")
    if not isinstance(palette_tag, list) or not palette_tag:
        raise MalformedLitematicError(f"Region {name!r} is missing BlockStatePalette")
    palette = [_normalize_palette_entry(entry, name, index) for index, entry in enumerate(palette_tag)]

    block_states = tag.get("BlockStates")
    if block_states is None:
        raise MalformedLitematicError(f"Region {name!r} is missing BlockStates")
    indices = decode_packed_block_states([int(v) for v in block_states], len(palette), volume)

    return LitematicRegion(
        name=name,
        origin=origin,
        size=size,
        palette=palette,
        block_state_indices=indices,
        block_entities=_read_compound_list(tag, ("TileEntities", "BlockEntities")),
        entities=_read_compound_list(tag, ("Entities",)),
    )


def _normalize_palette_entry(entry: Any, region_name: str, index: int) -> Compound:
    if not isinstance(entry, Compound):
        raise MalformedLitematicError(
            f"Palette entry {index} in region {region_name!r} must be a compound"
        )
    if "Name" not in entry:
        raise MalformedLitematicError(
            f"Palette entry {index} in region {region_name!r} is missing Name"
        )
    result = Compound({"Name": entry["Name"]})
    if "Properties" in entry:
        if not isinstance(entry["Properties"], Compound):
            raise MalformedLitematicError(
                f"Palette entry {index} in region {region_name!r} has non-compound Properties"
            )
        result["Properties"] = entry["Properties"]
    return result


def _require_compound(parent: Compound, key: str, context: str) -> Compound:
    value = parent.get(key)
    if not isinstance(value, Compound):
        raise MalformedLitematicError(f"{context} is missing compound tag {key!r}")
    return value


def _optional_compound(parent: Compound, key: str) -> Compound:
    value = parent.get(key)
    return value if isinstance(value, Compound) else Compound()


def _read_vec3(parent: Compound, key: str, context: str, default: Vec3 | None = None) -> Vec3:
    value = parent.get(key)
    if value is None and default is not None:
        return default
    if not isinstance(value, Compound):
        raise MalformedLitematicError(f"{context} is missing vector compound {key!r}")
    try:
        return Vec3(int(value["x"]), int(value["y"]), int(value["z"]))
    except KeyError as exc:
        raise MalformedLitematicError(f"{context} vector {key!r} must contain x, y, and z") from exc


def _read_compound_list(parent: Compound, keys: tuple[str, ...]) -> list[Compound]:
    for key in keys:
        value = parent.get(key)
        if value is None:
            continue
        if not isinstance(value, list):
            raise MalformedLitematicError(f"{key} must be a list of compounds")
        return [item for item in value if isinstance(item, Compound)]
    return []
