# @projectqai/proto

TypeScript bindings for [projectqai/proto](https://github.com/projectqai/proto).

## Installation

```bash
bun add @projectqai/proto @bufbuild/protobuf
```

## Usage

```typescript
import { EntitySchema, WorldService } from "@projectqai/proto/world";
import { create } from "@bufbuild/protobuf";

// Create an entity
const entity = create(EntitySchema, {
  id: "entity-123",
  label: "My Entity",
});

// Use with ConnectRPC
import { createClient } from "@connectrpc/connect";
import { createConnectTransport } from "@connectrpc/connect-web";

const transport = createConnectTransport({ baseUrl: "http://localhost:50051" });
const client = createClient(WorldService, transport);

const response = await client.listEntities({});
```

## Exports

- `@projectqai/proto/world` - Entity types and WorldService
