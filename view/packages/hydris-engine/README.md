# @hydris/engine

Expo module wrapping Hydris Go backend AAR as Android ForegroundService.

## Setup

Requires `hydris.aar` and jar files in `android/libs/`. From the repo root:

```bash
make android
```

This builds the Go libraries and copies them into `android/libs/`.

## API

```typescript
import * as HydrisEngine from "@hydris/engine";

await HydrisEngine.startEngineService(); // starts foreground service
await HydrisEngine.stopEngine();
```

## Android Only

Returns `"unsupported"` on non-Android platforms.
