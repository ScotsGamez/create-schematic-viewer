from litematic_converter.merge import merge_regions

from conftest import block_entity, region, state


def test_block_entity_position_rewritten_to_structure_local_coordinates():
    reg = region(
        "Chest",
        origin=(10, 64, 10),
        size=(1, 1, 1),
        palette=[state("minecraft:chest")],
        indices=[0],
        block_entities=[block_entity(10, 64, 10)],
    )

    structure = merge_regions([reg], data_version=3700)
    nbt = structure["blocks"][0]["nbt"]

    assert int(nbt["x"]) == 0
    assert int(nbt["y"]) == 0
    assert int(nbt["z"]) == 0
    assert nbt["id"] == "minecraft:chest"


def test_block_entity_local_position_handles_negative_region_size():
    reg = region(
        "NegativeChest",
        origin=(10, 64, 10),
        size=(-2, 1, 1),
        palette=[state("minecraft:chest")],
        indices=[0, 0],
        block_entities=[block_entity(0, 0, 0)],
    )

    structure = merge_regions([reg], data_version=3700)
    block_with_nbt = [block for block in structure["blocks"] if "nbt" in block][0]

    assert [int(v) for v in block_with_nbt["pos"]] == [1, 0, 0]
    assert int(block_with_nbt["nbt"]["x"]) == 1
