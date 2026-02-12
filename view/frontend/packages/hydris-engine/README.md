# @hydris/engine

Expo module wrapping Hydris Go backend AAR as Android ForegroundService.

## Setup

Requires `hydris.aar` in `android/libs/`.

Build from [github.com/projectqai/hydris](https://github.com/projectqai/hydris):

```bash
cd android && gomobile bind -target=android -androidapi 24 -o hydris.aar
```

Then copy `hydris.aar` to this package's `android/libs/` directory.

## API

```typescript
import * as HydrisEngine from "@hydris/engine";

await HydrisEngine.startEngineService(); // starts foreground service
await HydrisEngine.stopEngine();
```

## Android Only

Returns `"unsupported"` on non-Android platforms.
