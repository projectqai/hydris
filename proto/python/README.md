# Platform Proto - Python Bindings

Python protobuf and gRPC bindings for the Hydra platform, including the `HydraClient` for interacting with the Hydra WorldService.

## Packages

This repository provides two Python packages:

- **`platform_proto`**: Auto-generated protobuf/gRPC bindings from `.proto` files
- **`hydra_client`**: Python client library for Hydra WorldService

## Requirements

- Python >= 3.8
- [Poetry](https://python-poetry.org/) for dependency management

## Quick Start

### First Time Setup

1. Install dependencies:
   ```bash
   cd python
   make setup
   ```

2. Generate protobuf bindings:
   ```bash
   make generate
   ```

### Regenerating Bindings

Whenever the `.proto` files change, regenerate the bindings:

```bash
cd python
make generate
```

## Available Commands

Run `make help` to see all available commands:

```bash
make setup       - Install dependencies with Poetry
make generate    - Generate Python protobuf bindings
make clean       - Remove generated files and build artifacts
make clean-all   - Remove everything including Poetry venv
make build       - Build the Python package
make install     - Install package in development mode
make test        - Run tests (if available)
```

## Why Poetry?

The Makefile uses Poetry to ensure consistent versions of `grpcio-tools` across different machines. This prevents issues where different versions of the protobuf compiler might generate incompatible code.

Poetry creates an isolated virtual environment with pinned dependencies specified in `pyproject.toml` and `poetry.lock`.

## Using in Your Project

### With Poetry

Add to your `pyproject.toml`:

```toml
[tool.poetry.dependencies]
platform-proto = { path = "../PUBLIC-platform-proto/python", develop = true }
```

This gives you access to both packages:
- `from platform_proto import world_pb2, world_pb2_grpc`
- `from hydra_client import HydraClient`

### With pip

```bash
pip install -e /path/to/PUBLIC-platform-proto/python
```

## HydraClient Usage

```python
from hydra_client import HydraClient
from platform_proto import world_pb2

# Connect to Hydra server
client = HydraClient("localhost:50051")

# Push an entity
entity = world_pb2.Entity(
    id="my-entity",
    # ... configure entity
)
success = client.push_entity(entity)

# List entities
entities = client.list_entities()

# Watch for entity changes (streaming)
for event in client.watch_entities():
    print(f"Entity {event.entity.id} changed")

# Close connection
client.close()
```

See `hydra_client/client.py` for full API documentation.

## Development

### Cleaning Up

Remove generated files:
```bash
make clean
```

Remove everything including Poetry virtual environment:
```bash
make clean-all
```

### Building Distribution Package

```bash
make build
```

This creates a distributable package in `dist/`.

## Structure

```
python/
├── platform_proto/          # Auto-generated protobuf bindings
│   ├── __init__.py
│   ├── world_pb2.py
│   ├── world_pb2_grpc.py
│   └── ...
├── hydra_client/            # Hand-written client library
│   ├── __init__.py
│   └── client.py
├── generate_protos.py       # Script to generate bindings
├── pyproject.toml           # Poetry configuration
├── poetry.lock              # Locked dependencies
└── Makefile                 # Build commands
```
