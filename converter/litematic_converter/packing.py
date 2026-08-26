from __future__ import annotations

from collections.abc import Sequence

from .errors import MalformedLitematicError


def bits_per_entry(palette_size: int) -> int:
    """Return the number of bits Litematica uses for a palette index."""
    if palette_size < 1:
        raise MalformedLitematicError("BlockStatePalette must contain at least one entry")
    return max(1, (palette_size - 1).bit_length())


def _unsigned_long(value: int) -> int:
    return int(value) & ((1 << 64) - 1)


def decode_packed_block_states(
    longs: Sequence[int], palette_size: int, block_count: int
) -> list[int]:
    """Decode a Litematica packed long array into palette indices.

    Values are stored as a continuous little-endian bit stream, with entry zero
    starting at the least significant bits of the first long. Entries may cross
    64-bit long boundaries.
    """
    if block_count < 0:
        raise MalformedLitematicError("Block count cannot be negative")
    if block_count == 0:
        return []

    bits = bits_per_entry(palette_size)
    mask = (1 << bits) - 1
    required_bits = block_count * bits
    required_longs = (required_bits + 63) // 64
    if len(longs) < required_longs:
        raise MalformedLitematicError(
            f"BlockStates is too short: need {required_longs} longs for "
            f"{block_count} blocks, got {len(longs)}"
        )

    decoded: list[int] = []
    for index in range(block_count):
        bit_index = index * bits
        long_index = bit_index // 64
        bit_offset = bit_index % 64

        value = _unsigned_long(longs[long_index]) >> bit_offset
        available = 64 - bit_offset
        if available < bits:
            value |= _unsigned_long(longs[long_index + 1]) << available

        palette_index = value & mask
        if palette_index >= palette_size:
            raise MalformedLitematicError(
                f"BlockStates entry {index} references palette index "
                f"{palette_index}, but palette size is {palette_size}"
            )
        decoded.append(palette_index)

    return decoded


def encode_packed_block_states(indices: Sequence[int], palette_size: int) -> list[int]:
    """Encode palette indices for tests and fixtures."""
    bits = bits_per_entry(palette_size)
    total_bits = len(indices) * bits
    longs = [0] * ((total_bits + 63) // 64)
    mask64 = (1 << 64) - 1

    for index, palette_index in enumerate(indices):
        if palette_index < 0 or palette_index >= palette_size:
            raise ValueError("palette index out of range")
        bit_index = index * bits
        long_index = bit_index // 64
        bit_offset = bit_index % 64
        longs[long_index] |= int(palette_index) << bit_offset
        if bit_offset + bits > 64:
            longs[long_index + 1] |= int(palette_index) >> (64 - bit_offset)

    return [value if value < (1 << 63) else value - (1 << 64) for value in (v & mask64 for v in longs)]
