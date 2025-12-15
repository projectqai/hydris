# Architecture

This document describes the architecture of Project Hydra, an open-source tactical coordination platform for real-time sensor fusion and situational awareness.

## Overview

Hydra is a multi-platform application consisting of:

- **Go backend** - Event-sourced state machine with gRPC/Connect RPC APIs
- **Expo/React Native frontend** - Cross-platform UI (web, Android, desktop)
- **Single-binary deployment** - Frontend embedded in the Go binary

```
┌─────────────────────────────────────────────────────────────────┐
│                         Hydra Binary                            │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────────────┐  │
│  │    Engine    │  │   gRPC/HTTP  │  │   Embedded Web UI     │  │
│  │  WorldServer │◄─┤   Server     │◄─┤   (React/Expo)        │  │
│  │  EventBus    │  │   :50051     │  │                       │  │
│  │  Store       │  └──────────────┘  └───────────────────────┘  │
│  └──────────────┘                                               │
└─────────────────────────────────────────────────────────────────┘
         ▲                    ▲
         │                    │
    ┌────┴────┐         ┌─────┴─────┐
    │ Sensors │         │  Clients  │
    │  Feeds  │         │ (Mobile)  │
    └─────────┘         └───────────┘
```

## Project Structure

```
hydra/
├── main.go              # Application entry point
├── engine/              # Core state machine
│   ├── engine.go        # Server setup and HTTP/gRPC handlers
│   ├── world.go         # WorldServer - central state manager
│   ├── bus.go           # Event bus (pub/sub)
│   ├── store.go         # Event sourcing store
│   ├── observers.go     # Streaming observer management
│   └── timeline.go      # Time-travel/replay functionality
├── cmd/                 # Cobra CLI root command
├── cli/                 # CLI client commands
├── goclient/            # Go client library with retry logic
├── android/             # Android library bindings (gomobile)
├── desktop/             # Desktop webview wrapper
├── view/                # Embedded web server + frontend submodule
│   └── frontend/        # Expo/React Native app (Git submodule)
├── builtin/             # CLI builtin command framework
├── logging/             # Structured logging (slog)
├── version/             # Version management
├── examples/            # Example implementations
└── docs/                # Generated API documentation
```

## Technology Stack

### Backend (Go)

| Component | Technology |
|-----------|------------|
| Language | Go 1.25 |
| CLI | Cobra |
| RPC | gRPC + Connect RPC |
| Serialization | Protocol Buffers |
| HTTP | HTTP/2 with h2c |
| Geospatial | github.com/paulmach/orb |
| Logging | slog + tint |
| Extensions | wasmtime-go (WASM) |

### Frontend (TypeScript)

| Component | Technology |
|-----------|------------|
| Framework | Expo 54 / React Native 0.81 |
| Runtime | Bun |
| State | Zustand |
| Styling | Tailwind CSS + NativeWind |
| RPC Client | @connectrpc/connect |
| Maps | Leaflet (web) |
| Symbols | milsymbol (MIL-STD-2525C) |

## Core Architecture

### Entity Component System (ECS)

Entities are the fundamental data unit, composed of optional components:

```protobuf
Entity {
  id: string              // Unique identifier
  label: string           // Human-readable name
  controller: string      // Controller reference
  lifetime: Lifetime      // From/until timestamps
  priority: Priority      // Priority level

  // Optional components
  geo: GeoSpatialComponent    // lat/lon/alt
  symbol: SymbolComponent     // MIL-STD-2525C code
  camera: CameraComponent     // Video feed URLs
  detection: Detection        // Detection metadata
  bearing: Bearing            // Azimuth/elevation
  track: Track                // Tracking data
  locator: Locator            // Location source
}
```

### Event-Driven State Machine

```
                    ┌─────────────┐
                    │   Store     │ ◄─── Event Sourcing
                    │  (history)  │      (all changes)
                    └──────┬──────┘
                           │
┌──────────┐        ┌──────▼──────┐        ┌──────────┐
│  Push()  │───────►│ WorldServer │───────►│ EventBus │
│  API     │        │   (head)    │        │ (fanout) │
└──────────┘        └──────┬──────┘        └────┬─────┘
                           │                    │
                    ┌──────▼──────┐        ┌────▼─────┐
                    │     GC      │        │ Observers│
                    │  (cleanup)  │        │ (streams)│
                    └─────────────┘        └──────────┘
```

**WorldServer** (`engine/world.go`)

- Maintains current world state (head)
- Thread-safe with RWMutex
- Garbage collects expired entities
- Supports timeline freezing

**EventBus** (`engine/bus.go`)

- Publish-subscribe for entity changes
- Fanout to observers with timeout protection
- Event types: update, expired, observer change

**Store** (`engine/store.go`)

- Event sourcing for historical data
- Maintains timeline bounds
- Supports temporal queries

### API Layer

**Protocol:** Connect RPC over HTTP/2 (port 50051)

```protobuf
service WorldService {
  rpc ListEntities() returns (ListEntitiesResponse);
  rpc GetEntity(GetEntityRequest) returns (Entity);
  rpc WatchEntities(WatchEntitiesRequest) returns (stream EntityChangeEvent);
  rpc Push(PushRequest) returns (PushResponse);
  rpc Observe(stream ObserveRequest) returns (stream Geometry);
}

service TimelineService {
  rpc GetTimeline() returns (TimelineResponse);
  rpc MoveTimeline(MoveTimelineRequest) returns (TimelineResponse);
}
```

## Frontend Architecture

### Workspace Packages

The frontend is organized as a Bun monorepo with Turbo:

```
view/frontend/
├── apps/
│   └── hydra/              # Main Expo application
└── packages/
    ├── @hydra/core         # Business logic & API client
    ├── @hydra/map-engine   # Map abstraction layer
    ├── @hydra/hydra-engine # Native module (Android AAR)
    ├── @hydra/ui           # Shared UI components
    ├── @hydra/eslint-config
    └── @hydra/typescript-config
```

### State Management

```typescript
// Zustand (lib) store for entities
const useEntityStore = create<EntityStore>((set) => ({
  entities: new Map<string, Entity>(),
  updateEntity: (entity) => set((state) => {
    state.entities.set(entity.id, entity);
    return { entities: new Map(state.entities) };
  }),
}));

// Real-time streaming hook
function useEntityStream() {
  // WatchEntities stream with auto-reconnect
  // Updates Zustand (lib) store on each event
}
```

## Deployment Models

### 1. Single Binary (Default)

```bash
./hydra          # Backend + embedded UI on :50051
./hydra --view   # Also opens browser
```

### 2. Docker Container

```bash
docker run -p 50051:50051 ghcr.io/projectqai/hydra:latest
```

### 3. Android Application

- Native AAR via gomobile
- Foreground service for background operation
- Embedded or remote backend modes

### 4. Desktop Application

- Go webview wrapper
- Standalone window with embedded engine

## Data Flow

### Entity Push Flow

```
Sensor/Client
     │
     ▼
Push() API ──► Store.Push() ──► head[id] = entity
                    │                  │
                    │                  ▼
                    │           bus.publish()
                    │                  │
                    ▼                  ▼
             Event persisted    WatchEntities streams
```

### Client Connection Flow

```
Frontend Boot
     │
     ▼
Determine API URL ──► Create Connect client
     │
     ▼
WatchEntities() stream
     │
     ▼
┌────┴────────────────────┐
│ On EntityChangeEvent:   │
│  - Update Zustand store │
│  - Re-render UI         │
│                         │
│ On disconnect:          │
│  - Exponential backoff  │
│  - Auto-reconnect       │
└─────────────────────────┘
```

## Build System

### Makefile Targets

```makefile
make aio       # Full build (gen + frontend + binary)
make gen       # Generate protobuf code
make frontend  # Build Expo web export
make android   # Build Android AAR
make clean     # Clean artifacts
```

### CI/CD Pipeline

1. Generate protobuf code
2. Build frontend (Bun + Expo)
3. Cross-compile Go binaries (5 platforms)
4. Build Docker image (multi-arch)
5. Create GitHub Release (on tags)

## Extension Points

### WASM Extensions

```go
// Build with ext tag for WASM support
// go build -tags ext
```

### Protocol Buffers

External proto definitions in `github.com/projectqai/proto` allow independent protocol evolution.

### Custom CLI Commands

Add commands via the `builtin/` framework.

## Configuration

| Variable | Description | Default |
|----------|-------------|---------|
| `EXPO_PUBLIC_HYDRA_API_URL` | Backend URL (frontend) | `http://localhost:50051` |
| Port | Server listen port | `50051` |

## Key Design Decisions

1. **Single Binary** - Frontend embedded via `embed.FS` for zero-dependency deployment
2. **Event Sourcing** - All changes stored for time-travel and replay
3. **Component-Based Entities** - Flexible ECS pattern for diverse entity types
4. **Connect RPC** - Better web compatibility than pure gRPC
5. **Automatic Reconnection** - Resilient streaming with exponential backoff
6. **Cross-Platform UI** - Single codebase for web, Android, iOS, desktop
