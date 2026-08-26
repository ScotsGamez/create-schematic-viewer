from nbtlib import Compound, Int

from litematic_converter.litematic import parse_litematic_root
from litematic_converter.vanilla_nbt import clone_state, state_key

from conftest import litematic_region_compound, state


def test_palette_conversion_preserves_name_and_properties():
    original = state("minecraft:oak_stairs", facing="north", half="top", shape="straight")
    converted = clone_state(original)

    assert converted["Name"] == "minecraft:oak_stairs"
    assert converted["Properties"]["facing"] == "north"
    assert converted["Properties"]["half"] == "top"
    assert state_key(converted) == state_key(original)


def test_parse_litematic_root_extracts_data_version_and_region_palette():
    root = Compound(
        {
            "MinecraftDataVersion": Int(3700),
            "Metadata": Compound({}),
            "Regions": Compound(
                {
                    "Main": litematic_region_compound(
                        origin=(1, 2, 3),
                        size=(1, 1, 1),
                        palette=[state("minecraft:stone")],
                        indices=[0],
                    )
                }
            ),
        }
    )

    parsed = parse_litematic_root(root)

    assert parsed.data_version == 3700
    assert parsed.regions[0].name == "Main"
    assert parsed.regions[0].palette[0]["Name"] == "minecraft:stone"
