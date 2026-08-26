from litematic_converter.packing import decode_packed_block_states, encode_packed_block_states


def test_decode_packed_block_states_round_trips_across_long_boundary():
    indices = [i % 9 for i in range(80)]
    packed = encode_packed_block_states(indices, palette_size=9)

    assert decode_packed_block_states(packed, palette_size=9, block_count=len(indices)) == indices


def test_decode_single_entry_palette_uses_one_bit():
    packed = encode_packed_block_states([0, 0, 0, 0], palette_size=1)

    assert decode_packed_block_states(packed, palette_size=1, block_count=4) == [0, 0, 0, 0]
