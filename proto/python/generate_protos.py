#!/usr/bin/env python3
"""
Script to generate Python protobuf and gRPC bindings.
Run this from the repository root directory.

Usage:
    python3 scripts/generate_protos.py

Requirements:
    pip install grpcio-tools
"""

import logging
import os
import sys
import glob
from pathlib import Path
from grpc_tools import protoc

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


def fix_grpc_imports(output_dir: Path):
    """
    Fix imports in generated *_grpc.py files to use relative imports.

    The grpc_tools.protoc compiler generates absolute imports like:
        import timeline_pb2 as timeline__pb2

    But we need relative imports for proper package structure:
        from . import timeline_pb2 as timeline__pb2
    """
    import re

    grpc_files = list(output_dir.glob("*_pb2*.py"))

    if not grpc_files:
        return

    logger.info("Fixing imports in generated files...")

    for grpc_file in grpc_files:
        content = grpc_file.read_text()

        # Pattern to match: import {name}_pb2 as {name}__pb2
        # Replace with: from . import {name}_pb2 as {name}__pb2
        pattern = r'^import (\w+_pb2) as (\w+__pb2)$'
        replacement = r'from . import \1 as \2'

        fixed_content = re.sub(pattern, replacement, content, flags=re.MULTILINE)

        if fixed_content != content:
            grpc_file.write_text(fixed_content)
            logger.info(f"  ✓ Fixed imports in {grpc_file.name}")


def generate_protos(repo_root: Path):
    """Generate Python bindings from .proto files."""

    proto_dir = repo_root
    output_dir = repo_root / "python" / "platform_proto"

    logger.info("=" * 50)
    logger.info("Generating Python protobuf bindings")
    logger.info("=" * 50)
    logger.info(f"Proto directory: {proto_dir}")
    logger.info(f"Output directory: {output_dir}")

    # Create output directory if it doesn't exist
    output_dir.mkdir(parents=True, exist_ok=True)

    # Find all .proto files
    proto_files = list(proto_dir.glob("*.proto"))

    if not proto_files:
        logger.error("No .proto files found in the repository root")
        return False

    # Get grpc_tools proto include directory for well-known types
    import grpc_tools
    grpc_tools_path = Path(grpc_tools.__file__).parent / '_proto'

    # Generate Python code for each .proto file
    for proto_file in proto_files:
        logger.info(f"Generating Python bindings for {proto_file.name}...")

        # Run protoc with both the project proto dir and grpc_tools proto dir
        result = protoc.main([
            'grpc_tools.protoc',
            f'-I{proto_dir}',
            f'-I{grpc_tools_path}',
            f'--python_out={output_dir}',
            f'--grpc_python_out={output_dir}',
            f'--pyi_out={output_dir}',
            str(proto_file),
        ])

        if result != 0:
            logger.error(f"Failed to generate bindings for {proto_file.name}")
            return False

    # Fix imports in generated gRPC files
    fix_grpc_imports(output_dir)

    logger.info(f"✓ Python bindings generated successfully in {output_dir}")
    logger.info("Generated files:")
    for py_file in sorted(output_dir.glob("*.py")):
        logger.info(f"  - {py_file.name}")

    return True


def main():
    """Main entry point."""
    # Get repository root (parent of python directory)
    script_dir = Path(__file__).parent
    repo_root = script_dir.parent

    # Generate protobuf bindings
    success = generate_protos(repo_root)
    sys.exit(0 if success else 1)


if __name__ == "__main__":
    main()
