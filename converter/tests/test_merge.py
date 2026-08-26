from litematic_converter.merge import merge_regions

from conftest import region, state


def block_positions(structure):
    return sorted(tuple(int(v) for v in block["pos"]) for block in structure["blocks"])


def test_positive_region_size_exports_expected_size_and_positions():
    reg = region(
        "A",
        origin=(10, 64, 10),
        size=(2, 1, 1),
        palette=[state("minecraft:stone")],
        indices=[0, 0],
    )

    structure = merge_regions([reg], data_version=3700)

    assert [int(v) for v in structure["size"]] == [2, 1, 1]
    assert block_positions(structure) == [(0, 0, 0), (1, 0, 0)]


def test_negative_region_size_flips_into_normalized_local_coordinates():
    reg = region(
        "Neg",
        origin=(10, 64, 10),
        size=(-2, 1, 1),
        palette=[state("minecraft:stone")],
        indices=[0, 0],
    )

    structure = merge_regions([reg], data_version=3700)

    assert [int(v) for v in structure["size"]] == [2, 1, 1]
    assert block_positions(structure) == [(0, 0, 0), (1, 0, 0)]


def test_multiple_region_merge_offsets_into_one_bounding_box():
    left = region("Left", origin=(0, 0, 0), size=(1, 1, 1), palette=[state("minecraft:stone")], indices=[0])
    right = region("Right", origin=(3, 0, 0), size=(1, 1, 1), palette=[state("minecraft:dirt")], indices=[0])

    structure = merge_regions([left, right], data_version=3700)

    assert [int(v) for v in structure["size"]] == [4, 1, 1]
    assert block_positions(structure) == [(0, 0, 0), (3, 0, 0)]
    assert [entry["Name"] for entry in structure["palette"]] == ["minecraft:stone", "minecraft:dirt"]


def test_air_blocks_are_omitted_from_structure_block_list():
    reg = region(
        "Sparse",
        origin=(0, 0, 0),
        size=(2, 2, 1),
        palette=[state("minecraft:air"), state("minecraft:stone")],
        indices=[0, 1, 0, 0],
    )

    structure = merge_regions([reg], data_version=3700)

    assert [int(v) for v in structure["size"]] == [2, 2, 1]
    assert block_positions(structure) == [(1, 0, 0)]
    assert [entry["Name"] for entry in structure["palette"]] == ["minecraft:stone"]
