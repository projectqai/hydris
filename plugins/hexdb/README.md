# HexDB Plugin

Enriches ADS-B aircraft entities with images and administrative data from [hexdb.io](https://hexdb.io).

## Development

```bash
bun install
hydris plugin run index.ts --server http://localhost:50051
```

Use `--watch` to auto-reload on changes:

```bash
hydris plugin run index.ts --watch --server http://localhost:50051
```

## Build & Publish

Build the plugin into an OCI image:

```bash
hydris plugin build . -t ghcr.io/projectqai/hydra/builtin-hexdb:0.0.1  
```

to release, just push to an OCI repo:

```bash
docker push ghcr.io/projectqai/hydra/builtin-hexdb:0.0.1
```

## Run from OCI

```bash
hydris plugin run ghcr.io/projectqai/hydra/builtin-hexdb:0.0.1 --server http://localhost:50051
```

## package.json

| Field | Description |
|-------|-------------|
| `main` | TypeScript entry point |
| `hydris.compat` | Semver range for hydris version compatibility (e.g. `>=1.0.0 <2.0.0`) |
