from nbtlib import ByteArray, Compound, Int, IntArray, List, String

from litematic_converter.sponge_schem import parse_sponge_root


def test_parse_sponge_schematic_root_decodes_palette_and_block_entities():
    root = Compound(
        {
            "Width": Int(2),
            "Height": Int(1),
            "Length": Int(1),
            "DataVersion": Int(4325),
            "Palette": Compound(
                {
                    "minecraft:air": Int(0),
                    "minecraft:oak_slab[type=top,waterlogged=false]": Int(1),
                }
            ),
            "BlockData": ByteArray([0, 1]),
            "BlockEntities": List[Compound](
                [
                    Compound(
                        {
                            "Id": String("minecraft:sign"),
                            "Pos": IntArray([1, 0, 0]),
                        }
                    )
                ]
            ),
            "Metadata": Compound({"Name": String("Example")}),
        }
    )

    schematic = parse_sponge_root(root)
    region = schematic.regions[0]

    assert schematic.data_version == 4325
    assert region.name == "Example"
    assert region.size.as_list() == [2, 1, 1]
    assert [str(state["Name"]) for state in region.palette] == [
        "minecraft:air",
        "minecraft:oak_slab",
    ]
    assert str(region.palette[1]["Properties"]["type"]) == "top"
    assert region.block_state_indices == [0, 1]
    assert len(region.block_entities) == 1
