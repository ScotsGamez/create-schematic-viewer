from __future__ import annotations

import copy
import logging
from pathlib import Path
from typing import Iterable

import nbtlib
from nbtlib import Byte, Compound, Double, File, Int, List, String

from .litematic import AIR, LitematicRegion, Vec3

LOGGER = logging.getLogger(__name__)


def state_key(state: Compound) -> tuple[str, tuple[tuple[str, str], ...]]:
    properties = state.get("Properties", Compound())
    props = tuple(sorted((str(k), str(v)) for k, v in properties.items()))
    return (str(state["Name"]), props)


def clone_state(state: Compound) -> Compound:
    copied = Compound({"Name": String(str(state["Name"]))})
    if "Properties" in state:
        copied["Properties"] = Compound(
            {str(key): String(str(value)) for key, value in state["Properties"].items()}
        )
    return copied


def make_structure(
    size: Vec3,
    palette: list[Compound],
    blocks: list[Compound],
    entities: list[Compound],
    data_version: int,
) -> Compound:
    return Compound(
        {
            "DataVersion": Int(data_version),
            "size": List[Int]([Int(size.x), Int(size.y), Int(size.z)]),
            "palette": List[Compound](palette),
            "blocks": List[Compound](blocks),
            "entities": List[Compound](entities),
        }
    )


def write_structure(path: str | Path, structure: Compound) -> None:
    File(structure).save(Path(path), gzipped=True)


def block_pos_list(pos: Vec3) -> List[Int]:
    return List[Int]([Int(pos.x), Int(pos.y), Int(pos.z)])


def find_block_entity_position(nbt: Compound) -> Vec3 | None:
    if all(axis in nbt for axis in ("x", "y", "z")):
        return Vec3(int(nbt["x"]), int(nbt["y"]), int(nbt["z"]))
    pos = nbt.get("Pos")
    if _has_three_coordinates(pos):
        return Vec3(int(pos[0]), int(pos[1]), int(pos[2]))
    return None


def rewrite_block_entity_position(nbt: Compound, local_pos: Vec3) -> Compound:
    rewritten = copy.deepcopy(nbt)
    if all(axis in rewritten for axis in ("x", "y", "z")):
        rewritten["x"] = Int(local_pos.x)
        rewritten["y"] = Int(local_pos.y)
        rewritten["z"] = Int(local_pos.z)
    if "Pos" in rewritten and _has_three_coordinates(rewritten["Pos"]):
        rewritten["Pos"] = block_pos_list(local_pos)
    return rewritten


def _has_three_coordinates(value) -> bool:
    if isinstance(value, (str, bytes)):
        return False
    try:
        return len(value) >= 3
    except TypeError:
        return False


def make_vanilla_entity(entity: Compound, world_min: Vec3) -> Compound | None:
    pos = entity.get("Pos")
    if not (isinstance(pos, list) and len(pos) >= 3):
        LOGGER.warning("Skipping entity without Pos list")
        return None
    if "id" not in entity:
        LOGGER.warning("Skipping entity without id")
        return None

    try:
        local_x = float(pos[0]) - world_min.x
        local_y = float(pos[1]) - world_min.y
        local_z = float(pos[2]) - world_min.z
    except (TypeError, ValueError):
        LOGGER.warning("Skipping entity with non-numeric Pos")
        return None

    local = Vec3(int(local_x), int(local_y), int(local_z))
    return Compound(
        {
            "pos": List[Double]([Double(local_x), Double(local_y), Double(local_z)]),
            "blockPos": block_pos_list(local),
            "nbt": copy.deepcopy(entity),
        }
    )


def count_non_air(region: LitematicRegion) -> int:
    total = 0
    for palette_index in region.block_state_indices:
        if str(region.palette[palette_index]["Name"]) != AIR:
            total += 1
    return total


def palette_from_states(states: Iterable[Compound]) -> list[Compound]:
    unique: dict[tuple[str, tuple[tuple[str, str], ...]], Compound] = {}
    for state in states:
        unique.setdefault(state_key(state), clone_state(state))
    return list(unique.values())
