from litematic_converter.merge import merge_regions
from pathlib import Path
from zipfile import ZipFile

import nbtlib

from litematic_converter.split import split_structure, split_structure_by_size, write_structures

from conftest import region, state


def positions(structure):
    return sorted(tuple(int(value) for value in block["pos"]) for block in structure["blocks"])


def test_split_structure_uses_whole_y_layers_and_renormalizes_positions():
    reg = region(
        "Layers",
        origin=(0, 0, 0),
        size=(2, 3, 1),
        palette=[state("minecraft:stone")],
        indices=[0, 0, 0, 0, 0, 0],
    )
    structure = merge_regions([reg], data_version=3700)

    parts = split_structure(structure, max_blocks=3)

    assert len(parts) == 3
    assert [len(part["blocks"]) for part in parts] == [2, 2, 2]
    assert positions(parts[0]) == [(0, 0, 0), (1, 0, 0)]
    assert positions(parts[1]) == [(0, 0, 0), (1, 0, 0)]
    assert positions(parts[2]) == [(0, 0, 0), (1, 0, 0)]
    assert [[int(value) for value in part["size"]] for part in parts] == [[2, 1, 1], [2, 1, 1], [2, 1, 1]]


def test_split_structure_keeps_small_structure_as_single_part():
    reg = region(
        "Small",
        origin=(0, 0, 0),
        size=(2, 1, 1),
        palette=[state("minecraft:stone")],
        indices=[0, 0],
    )
    structure = merge_regions([reg], data_version=3700)

    assert split_structure(structure, max_blocks=3) == [structure]


def test_y_layer_split_preserves_original_xz_footprint_for_sparse_upper_layers():
    reg = region(
        "SparseTop",
        origin=(0, 0, 0),
        size=(5, 2, 5),
        palette=[state("minecraft:air"), state("minecraft:stone")],
        indices=[
            1, 0, 0, 0, 1,
            0, 0, 0, 0, 0,
            0, 0, 1, 0, 0,
            0, 0, 0, 0, 0,
            1, 0, 0, 0, 1,
            0, 0, 0, 0, 0,
            0, 0, 0, 0, 0,
            0, 0, 1, 0, 0,
            0, 0, 0, 0, 0,
            0, 0, 0, 0, 0,
        ],
    )
    structure = merge_regions([reg], data_version=3700)

    parts = split_structure(structure, max_blocks=5)

    assert [[int(value) for value in part["size"]] for part in parts] == [[5, 1, 5], [5, 1, 5]]
    assert positions(parts[1]) == [(2, 0, 2)]


def test_size_split_uses_y_layers_and_respects_small_limit_when_possible():
    reg = region(
        "Big",
        origin=(0, 0, 0),
        size=(20, 6, 20),
        palette=[state("minecraft:stone")],
        indices=[0] * 2400,
    )
    structure = merge_regions([reg], data_version=3700)

    parts = split_structure_by_size(structure, max_kb=1)

    assert len(parts) > 1
    assert sum(len(part["blocks"]) for part in parts) == 2400
    assert all([int(value) for value in part["size"]][0] == 20 for part in parts)
    assert all([int(value) for value in part["size"]][2] == 20 for part in parts)


def test_write_split_zip_adds_dirt_alignment_pillar(tmp_path: Path):
    reg = region(
        "Marker",
        origin=(0, 0, 0),
        size=(3, 4, 3),
        palette=[state("minecraft:stone")],
        indices=[0] * 36,
    )
    structure = merge_regions([reg], data_version=3700)
    parts = split_structure(structure, max_blocks=18)
    output = tmp_path / "marker_parts.zip"

    write_structures(output, parts, "marker")

    with ZipFile(output) as zip_file:
        for name in zip_file.namelist():
            data = zip_file.read(name)
            part_path = tmp_path / name
            part_path.write_bytes(data)
            root = nbtlib.load(part_path, gzipped=True)
            root = getattr(root, "root", root)
            dirt_index = next(index for index, entry in enumerate(root["palette"]) if str(entry["Name"]) == "minecraft:dirt")
            stone_index = next(index for index, entry in enumerate(root["palette"]) if str(entry["Name"]) == "minecraft:stone")
            pillar = [
                block for block in root["blocks"]
                if int(block["pos"][0]) == 0 and int(block["pos"][2]) == 0
            ]
            shifted_original = [
                block for block in root["blocks"]
                if int(block["state"]) == stone_index
            ]
            assert [int(value) for value in root["size"]] == [4, 2, 4]
            assert len(pillar) == int(root["size"][1])
            assert all(int(block["state"]) == dirt_index for block in pillar)
            assert len(shifted_original) == 18
            assert all(int(block["pos"][0]) >= 1 and int(block["pos"][2]) >= 1 for block in shifted_original)
