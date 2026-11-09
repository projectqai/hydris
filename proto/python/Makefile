.PHONY: help check-poetry setup generate clean clean-all build install test

# Check if poetry is installed
POETRY := $(shell command -v poetry 2> /dev/null)

help:
	@echo "Platform Proto - Available commands:"
	@echo ""
	@echo "  make setup       - Install dependencies with Poetry"
	@echo "  make generate    - Generate Python protobuf bindings"
	@echo "  make clean       - Remove generated files and build artifacts"
	@echo "  make clean-all   - Remove everything including Poetry venv"
	@echo "  make build       - Build the Python package"
	@echo "  make install     - Install package in development mode"
	@echo "  make test        - Run tests (if available)"
	@echo ""
	@echo "Quick start:"
	@echo "  1. make setup      (first time only)"
	@echo "  2. make generate   (regenerate bindings)"
	@echo ""

check-poetry:
ifndef POETRY
	$(error Poetry is not installed. Install it from: https://python-poetry.org/docs/#installation)
endif

setup: check-poetry
	@echo "Installing dependencies with Poetry..."
	@poetry install
	@echo "✓ Dependencies installed"

generate: check-poetry
	@echo "Generating Python protobuf bindings..."
	@poetry install --quiet
	@poetry run python generate_protos.py

clean:
	@echo "Cleaning generated files and build artifacts..."
	@rm -rf platform_proto/*_pb2.py
	@rm -rf platform_proto/*_pb2_grpc.py
	@rm -rf platform_proto/*_pb2.pyi
	@rm -rf build/ dist/ *.egg-info
	@find . -type d -name __pycache__ -exec rm -rf {} + 2>/dev/null || true
	@find . -type f -name "*.pyc" -delete
	@echo "Clean complete!"

clean-all: clean check-poetry
	@echo "Removing Poetry virtual environment..."
	@poetry env remove --all 2>/dev/null || true
	@echo "✓ All clean (run 'make setup' to reinstall)"

build: generate
	@echo "Building Python package..."
	@poetry build

install: check-poetry
	@echo "Installing package in development mode..."
	@poetry install

test: check-poetry
	@echo "Running tests..."
	@PYTHONPATH="" poetry run pytest tests/ -v --junitxml=test-results.xml
