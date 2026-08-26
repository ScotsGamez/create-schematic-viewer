from __future__ import annotations

import argparse
import logging
from pathlib import Path

from . import __version__
from .errors import ConverterError
from .litematic import load_litematic
from .merge import merge_litematic, structure_for_region
from .sponge_schem import load_sponge_schematic
from .split import split_structure, split_structure_by_size, write_structures
from .vanilla_nbt import count_non_air, write_structure


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="litematic_to_nbt.py",
        description="Convert Minecraft Litematica .litematic or Sponge .schem files to vanilla structure .nbt files.",
    )
    parser.add_argument("input", help="Input gzipped NBT .litematic or .schem file")
    parser.add_argument("output", nargs="?", help="Output .nbt file or output directory")
    parser.add_argument("--format", choices=["nbt"], default="nbt", help="Output format")
    parser.add_argument("--region", help="Export only the named region")
    parser.add_argument("--list-regions", action="store_true", help="List regions and exit")
    parser.add_argument("--dry-run", action="store_true", help="Print summary without writing output")
    parser.add_argument("--split-max-blocks", type=int, default=0, help="Split output into named parts when a structure has more than this many non-air blocks")
    parser.add_argument("--split-max-kb", type=int, default=0, help="Split output into layer parts when a gzipped structure part exceeds this many KB")
    parser.add_argument("--verbose", action="store_true", help="Enable verbose logging")
    parser.add_argument("--version", action="version", version=f"%(prog)s {__version__}")
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)

    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.WARNING,
        format="%(levelname)s: %(message)s",
    )

    try:
        litematic = _load_input(args.input)
        selected = _select_regions(litematic.regions, args.region)
        _print_summary(litematic.data_version, selected)

        if args.list_regions or args.dry_run:
            return 0
        if not args.output:
            parser.error("output is required unless --list-regions is used")

        output = Path(args.output)
        if _treat_as_directory(output, len(selected)):
            output.mkdir(parents=True, exist_ok=True)
            for region in selected:
                structure = structure_for_region(region, litematic.data_version)
                structures = _split_structure_for_args(structure, args)
                if len(structures) == 1:
                    write_structure(output / f"{_safe_filename(region.name)}.nbt", structure)
                else:
                    part_zip = output / f"{_safe_filename(region.name)}_parts.zip"
                    write_structures(part_zip, structures, _safe_filename(region.name))
                    print(f"Split {region.name!r} into {len(structures)} part file(s): {part_zip}")
            print(f"Wrote {len(selected)} region file(s) to {output}")
        else:
            structure = merge_litematic(litematic, args.region)
            structures = _split_structure_for_args(structure, args)
            if len(structures) == 1:
                write_structure(output, structure)
                print(f"Wrote vanilla structure NBT: {output}")
            else:
                if output.suffix.lower() != ".zip":
                    output = output.with_suffix(".zip")
                write_structures(output, structures, _safe_filename(Path(args.input).stem))
                print(f"Split output into {len(structures)} part file(s): {output}")
        return 0
    except ConverterError as exc:
        parser.exit(2, f"error: {exc}\n")


def _select_regions(regions, region_name: str | None):
    if region_name is None:
        return regions
    selected = [region for region in regions if region.name == region_name]
    if not selected:
        from .errors import MalformedLitematicError

        raise MalformedLitematicError(f"No region named {region_name!r}")
    return selected


def _load_input(path: str):
    suffix = Path(path).suffix.lower()
    if suffix == ".schem":
        return load_sponge_schematic(path)
    return load_litematic(path)


def _split_structure_for_args(structure, args):
    if args.split_max_kb > 0:
        return split_structure_by_size(structure, args.split_max_kb)
    return split_structure(structure, args.split_max_blocks)


def _print_summary(data_version: int, regions) -> None:
    print(f"DataVersion: {data_version}")
    print(f"Regions: {len(regions)}")
    for region in regions:
        print(
            f"- {region.name}: origin={region.origin.as_list()} size={region.size.as_list()} "
            f"normalized_size={region.abs_size.as_list()} blocks={region.volume} "
            f"non_air={count_non_air(region)} palette={len(region.palette)} "
            f"block_entities={len(region.block_entities)} entities={len(region.entities)}"
        )


def _treat_as_directory(output: Path, region_count: int) -> bool:
    if output.exists() and output.is_dir():
        return True
    if str(output).endswith(("/", "\\")):
        return True
    return output.suffix == "" and region_count > 1


def _safe_filename(name: str) -> str:
    safe = "".join(ch if ch.isalnum() or ch in "._-" else "_" for ch in name.strip())
    return safe or "region"
