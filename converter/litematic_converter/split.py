from __future__ import annotations

import copy
import gzip
from io import BytesIO
from pathlib import Path
from zipfile import ZIP_STORED, ZipFile

from nbtlib import Compound, File, Int, List, String

from .litematic import Vec3
from .vanilla_nbt import block_pos_list, clone_state, make_structure, state_key


def split_structure(structure: Compound, max_blocks: int) -> list[Compound]:
    blocks = list(structure.get("blocks", []))
    if max_blocks <= 0 or len(blocks) <= max_blocks:
        return [structure]

    palette = list(structure.get("palette", []))
    entities = list(structure.get("entities", []))
    data_version = int(structure.get("DataVersion", 0))
    original_size = Vec3(*(int(value) for value in structure["size"]))
    chunks = _split_blocks(blocks, max_blocks)
    return [
        _structure_from_blocks(chunk, palette, entities, data_version, original_size)
        for chunk in chunks
    ]


def split_structure_by_size(structure: Compound, max_kb: int) -> list[Compound]:
    blocks = list(structure.get("blocks", []))
    max_bytes = max_kb * 1024
    if max_bytes <= 0 or len(_gzip_structure(structure)) <= max_bytes:
        return [structure]

    palette = list(structure.get("palette", []))
    entities = list(structure.get("entities", []))
    data_version = int(structure.get("DataVersion", 0))
    original_size = Vec3(*(int(value) for value in structure["size"]))
    chunks = _split_y_layers_by_size(blocks, palette, entities, data_version, original_size, max_bytes)
    return [
        _structure_from_blocks(chunk, palette, entities, data_version, original_size)
        for chunk in chunks
    ]


def write_structures(path: str | Path, structures: list[Compound], base_name: str) -> None:
    output = Path(path)
    if len(structures) == 1 and output.suffix.lower() != ".zip":
        File(structures[0]).save(output, gzipped=True)
        return

    with ZipFile(output, "w", compression=ZIP_STORED) as zip_file:
        total = len(structures)
        for index, structure in enumerate(structures, start=1):
            part_name = f"{base_name}_part_{index:02d}_of_{total:02d}.nbt"
            marked_structure = _with_alignment_pillar(structure)
            part_bytes = _gzip_structure(marked_structure)
            zip_file.writestr(part_name, part_bytes)
            print(f"- {part_name}: {len(part_bytes) // 1024} KB")


def _split_blocks(blocks: list[Compound], max_blocks: int) -> list[list[Compound]]:
    if len(blocks) <= max_blocks:
        return [blocks]

    return _split_y_layers(blocks, max_blocks)


def _split_y_layers(blocks: list[Compound], max_blocks: int) -> list[list[Compound]]:
    layers: dict[int, list[Compound]] = {}
    for block in blocks:
        layers.setdefault(_block_pos(block)[1], []).append(block)

    chunks: list[list[Compound]] = []
    current: list[Compound] = []
    current_count = 0

    for y in sorted(layers):
        layer = layers[y]
        if current and current_count + len(layer) > max_blocks:
            chunks.append(current)
            current = []
            current_count = 0
        current.extend(layer)
        current_count += len(layer)

    if current:
        chunks.append(current)
    return chunks


def _split_y_layers_by_size(
    blocks: list[Compound],
    palette: list[Compound],
    entities: list[Compound],
    data_version: int,
    original_size: Vec3,
    max_bytes: int,
) -> list[list[Compound]]:
    layers: dict[int, list[Compound]] = {}
    for block in blocks:
        layers.setdefault(_block_pos(block)[1], []).append(block)

    layer_infos = []
    for y in sorted(layers):
        layer = layers[y]
        layer_structure = _structure_from_blocks(layer, palette, entities, data_version, original_size)
        layer_infos.append((y, layer, len(_gzip_structure(layer_structure))))

    chunks: list[list[Compound]] = []
    current: list[Compound] = []
    current_size = 0

    for _y, layer, layer_size in layer_infos:
        if current and current_size + layer_size > max_bytes:
            chunks.append(current)
            current = list(layer)
            current_size = layer_size
        else:
            current.extend(layer)
            current_size += layer_size

    if current:
        chunks.append(current)
    return chunks


def _structure_from_blocks(
    blocks: list[Compound],
    source_palette: list[Compound],
    source_entities: list[Compound],
    data_version: int,
    original_size: Vec3,
) -> Compound:
    min_y, max_y = _y_bounds(blocks)
    min_corner = Vec3(0, min_y, 0)
    max_corner = Vec3(original_size.x - 1, max_y, original_size.z - 1)
    size = Vec3(
        original_size.x,
        max_corner.y - min_corner.y + 1,
        original_size.z,
    )
    palette: list[Compound] = []
    palette_lookup: dict[tuple[str, tuple[tuple[str, str], ...]], int] = {}
    remapped_blocks: list[Compound] = []

    for block in blocks:
        source_state = source_palette[int(block["state"])]
        key = state_key(source_state)
        if key not in palette_lookup:
            palette_lookup[key] = len(palette)
            palette.append(clone_state(source_state))

        local = _local_pos(_block_pos_vec(block), min_corner)
        remapped = Compound(
            {
                "state": Int(palette_lookup[key]),
                "pos": block_pos_list(local),
            }
        )
        if "nbt" in block:
            remapped["nbt"] = _rewrite_embedded_nbt(block["nbt"], local)
        remapped_blocks.append(remapped)

    entities = [
        _rewrite_entity(entity, min_corner)
        for entity in source_entities
        if _entity_in_bounds(entity, min_corner, max_corner)
    ]

    return make_structure(size=size, palette=palette, blocks=remapped_blocks, entities=entities, data_version=data_version)


def _y_bounds(blocks: list[Compound]) -> tuple[int, int]:
    ys = [_block_pos(block)[1] for block in blocks]
    return min(ys), max(ys)


def _block_pos(block: Compound) -> tuple[int, int, int]:
    pos = block["pos"]
    return int(pos[0]), int(pos[1]), int(pos[2])


def _block_pos_vec(block: Compound) -> Vec3:
    x, y, z = _block_pos(block)
    return Vec3(x, y, z)


def _local_pos(pos: Vec3, min_corner: Vec3) -> Vec3:
    return Vec3(pos.x - min_corner.x, pos.y - min_corner.y, pos.z - min_corner.z)


def _rewrite_embedded_nbt(nbt: Compound, local: Vec3) -> Compound:
    rewritten = copy.deepcopy(nbt)
    if all(axis in rewritten for axis in ("x", "y", "z")):
        rewritten["x"] = Int(local.x)
        rewritten["y"] = Int(local.y)
        rewritten["z"] = Int(local.z)
    if "Pos" in rewritten:
        rewritten["Pos"] = block_pos_list(local)
    return rewritten


def _entity_in_bounds(entity: Compound, min_corner: Vec3, max_corner: Vec3) -> bool:
    block_pos = entity.get("blockPos")
    if not isinstance(block_pos, list) or len(block_pos) < 3:
        return False
    x, y, z = int(block_pos[0]), int(block_pos[1]), int(block_pos[2])
    return min_corner.x <= x <= max_corner.x and min_corner.y <= y <= max_corner.y and min_corner.z <= z <= max_corner.z


def _rewrite_entity(entity: Compound, min_corner: Vec3) -> Compound:
    rewritten = copy.deepcopy(entity)
    if "blockPos" in rewritten:
        pos = rewritten["blockPos"]
        local = Vec3(int(pos[0]) - min_corner.x, int(pos[1]) - min_corner.y, int(pos[2]) - min_corner.z)
        rewritten["blockPos"] = block_pos_list(local)
    if "pos" in rewritten and isinstance(rewritten["pos"], list) and len(rewritten["pos"]) >= 3:
        rewritten["pos"] = List[type(rewritten["pos"][0])]([
            type(rewritten["pos"][0])(float(rewritten["pos"][0]) - min_corner.x),
            type(rewritten["pos"][1])(float(rewritten["pos"][1]) - min_corner.y),
            type(rewritten["pos"][2])(float(rewritten["pos"][2]) - min_corner.z),
        ])
    return rewritten


def _gzip_structure(structure: Compound) -> bytes:
    raw = BytesIO()
    File(structure).write(raw)
    return gzip.compress(raw.getvalue(), compresslevel=9, mtime=0)


def _with_alignment_pillar(structure: Compound) -> Compound:
    marked = copy.deepcopy(structure)
    size = marked.get("size")
    if not isinstance(size, list) or len(size) < 3:
        return marked

    height = int(size[1])
    if height <= 0:
        return marked

    size[0] = type(size[0])(int(size[0]) + 1)
    size[2] = type(size[2])(int(size[2]) + 1)
    for block in marked["blocks"]:
        x, y, z = _block_pos(block)
        shifted = Vec3(x + 1, y, z + 1)
        block["pos"] = block_pos_list(shifted)
        if "nbt" in block:
            block["nbt"] = _rewrite_embedded_nbt(block["nbt"], shifted)

    for entity in marked.get("entities", []):
        _shift_entity_xz(entity, 1, 1)

    palette = marked["palette"]
    dirt_index = _palette_index_for_dirt(palette)
    for y in range(height):
        marked["blocks"].append(Compound({"state": Int(dirt_index), "pos": block_pos_list(Vec3(0, y, 0))}))
    return marked


def _shift_entity_xz(entity: Compound, x_offset: int, z_offset: int) -> None:
    if "blockPos" in entity:
        pos = entity["blockPos"]
        entity["blockPos"] = block_pos_list(Vec3(int(pos[0]) + x_offset, int(pos[1]), int(pos[2]) + z_offset))
    if "pos" in entity and isinstance(entity["pos"], list) and len(entity["pos"]) >= 3:
        entity["pos"] = List[type(entity["pos"][0])]([
            type(entity["pos"][0])(float(entity["pos"][0]) + x_offset),
            type(entity["pos"][1])(float(entity["pos"][1])),
            type(entity["pos"][2])(float(entity["pos"][2]) + z_offset),
        ])


def _palette_index_for_dirt(palette: list[Compound]) -> int:
    for index, state in enumerate(palette):
        if str(state.get("Name", "")) == "minecraft:dirt":
            return index
    palette.append(Compound({"Name": String("minecraft:dirt")}))
    return len(palette) - 1
