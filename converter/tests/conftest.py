from __future__ import annotations

from nbtlib import Compound, Int, List, LongArray, String

from litematic_converter.litematic import LitematicRegion, Vec3
from litematic_converter.packing import encode_packed_block_states


def state(name: str, **properties: str) -> Compound:
    tag = Compound({"Name": String(name)})
    if properties:
        tag["Properties"] = Compound({key: String(value) for key, value in properties.items()})
    return tag


def block_entity(x: int, y: int, z: int, entity_id: str = "minecraft:chest") -> Compound:
    return Compound(
        {
            "id": String(entity_id),
            "x": Int(x),
            "y": Int(y),
            "z": Int(z),
        }
    )


def region(
    name: str,
    origin: tuple[int, int, int],
    size: tuple[int, int, int],
    palette,
    indices,
    block_entities=None,
) -> LitematicRegion:
    return LitematicRegion(
        name=name,
        origin=Vec3(*origin),
        size=Vec3(*size),
        palette=list(palette),
        block_state_indices=list(indices),
        block_entities=list(block_entities or []),
    )


def litematic_region_compound(
    origin: tuple[int, int, int],
    size: tuple[int, int, int],
    palette,
    indices,
) -> Compound:
    return Compound(
        {
            "Position": Compound({"x": Int(origin[0]), "y": Int(origin[1]), "z": Int(origin[2])}),
            "Size": Compound({"x": Int(size[0]), "y": Int(size[1]), "z": Int(size[2])}),
            "BlockStatePalette": List[Compound](list(palette)),
            "BlockStates": LongArray(encode_packed_block_states(indices, len(palette))),
        }
    )
