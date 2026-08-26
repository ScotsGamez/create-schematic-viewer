from __future__ import annotations

import copy
import logging

from nbtlib import Compound, Int, String

from .errors import MalformedLitematicError
from .litematic import AIR, LitematicFile, LitematicRegion, Vec3
from .vanilla_nbt import (
    block_pos_list,
    clone_state,
    find_block_entity_position,
    make_structure,
    make_vanilla_entity,
    rewrite_block_entity_position,
    state_key,
)

LOGGER = logging.getLogger(__name__)


def structure_for_region(region: LitematicRegion, data_version: int) -> Compound:
    return merge_regions([region], data_version)


def merge_litematic(litematic: LitematicFile, region_name: str | None = None) -> Compound:
    regions = litematic.regions
    if region_name is not None:
        regions = [region for region in regions if region.name == region_name]
        if not regions:
            raise MalformedLitematicError(f"No region named {region_name!r}")
    return merge_regions(regions, litematic.data_version)


def merge_regions(regions: list[LitematicRegion], data_version: int) -> Compound:
    if not regions:
        raise MalformedLitematicError("No regions selected for export")

    min_corner, max_corner = _bounding_box(regions)
    size = Vec3(
        max_corner.x - min_corner.x + 1,
        max_corner.y - min_corner.y + 1,
        max_corner.z - min_corner.z + 1,
    )

    palette: list[Compound] = []
    palette_lookup: dict[tuple[str, tuple[tuple[str, str], ...]], int] = {}
    blocks: list[Compound] = []
    entities: list[Compound] = []

    block_entity_lookup = _block_entity_lookup(regions)

    for region in regions:
        for index, palette_index in enumerate(region.block_state_indices):
            region_local = region.index_to_region_coords(index)
            world = region.region_to_world(region_local)
            local = Vec3(world.x - min_corner.x, world.y - min_corner.y, world.z - min_corner.z)
            state = region.palette[palette_index]
            if str(state["Name"]) == AIR:
                continue

            key = state_key(state)
            if key not in palette_lookup:
                palette_lookup[key] = len(palette)
                palette.append(clone_state(state))

            block = Compound(
                {
                    "state": Int(palette_lookup[key]),
                    "pos": block_pos_list(local),
                }
            )
            block_entity = block_entity_lookup.get((world.x, world.y, world.z))
            if block_entity is not None:
                block["nbt"] = rewrite_block_entity_position(block_entity, local)
            blocks.append(block)

        for entity in region.entities:
            vanilla_entity = make_vanilla_entity(entity, min_corner)
            if vanilla_entity is not None:
                entities.append(vanilla_entity)

    if not palette:
        palette.append(Compound({"Name": String(AIR)}))

    return make_structure(size=size, palette=palette, blocks=blocks, entities=entities, data_version=data_version)


def _bounding_box(regions: list[LitematicRegion]) -> tuple[Vec3, Vec3]:
    mins = [region.min_corner for region in regions]
    maxs = [region.max_corner for region in regions]
    return (
        Vec3(min(pos.x for pos in mins), min(pos.y for pos in mins), min(pos.z for pos in mins)),
        Vec3(max(pos.x for pos in maxs), max(pos.y for pos in maxs), max(pos.z for pos in maxs)),
    )


def _block_entity_lookup(regions: list[LitematicRegion]) -> dict[tuple[int, int, int], Compound]:
    lookup: dict[tuple[int, int, int], Compound] = {}
    for region in regions:
        for block_entity in region.block_entities:
            pos = find_block_entity_position(block_entity)
            if pos is None:
                LOGGER.warning("Skipping block entity in region %s without coordinates", region.name)
                continue
            world = _block_entity_world_pos(region, pos)
            lookup[(world.x, world.y, world.z)] = copy.deepcopy(block_entity)
    return lookup


def _block_entity_world_pos(region: LitematicRegion, pos: Vec3) -> Vec3:
    mn = region.min_corner
    mx = region.max_corner
    if mn.x <= pos.x <= mx.x and mn.y <= pos.y <= mx.y and mn.z <= pos.z <= mx.z:
        return pos

    abs_size = region.abs_size
    if 0 <= pos.x < abs_size.x and 0 <= pos.y < abs_size.y and 0 <= pos.z < abs_size.z:
        return region.region_to_world(pos)

    LOGGER.warning(
        "Block entity coordinates %s in region %s are outside the region; using them as world coordinates",
        pos.as_list(),
        region.name,
    )
    return pos
