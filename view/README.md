# Hydris View

Expo/React Native monorepo for web and Android.

## Prerequisites

- [Go](https://go.dev)
- [Bun](https://bun.sh)
- [Android SDK](https://developer.android.com/studio) + NDK 26.1 (for Android)

## Setup

From the repo root:

```bash
make setup
```

## Web

No Android SDK needed.

```bash
bun dev:web              # dev server
bun build:web            # production build
bun build:web:staging    # staging build
bun serve                # serve production build
```

## Android

The first Android build requires `make android` from the repo root — this compiles the Go native libraries and produces a release APK:

```bash
# from repo root
make android
```

APK output: `view/apps/foss/android/app/build/outputs/apk/release/app-release.apk`

After the initial build, frontend-only changes can be iterated with:

```bash
bun dev:android          # debug build + Metro dev server
```

### Remote vs Native Backend

The APK always includes the native engine, but it only starts if no remote backend URL is configured (`EXPO_PUBLIC_HYDRIS_API_URL`).

**Remote backend** — engine runs on your dev machine:

```bash
adb reverse tcp:50051 tcp:50051
```

Set `EXPO_PUBLIC_HYDRIS_API_URL=http://localhost:50051` in `.env.development`. The native engine stays idle.

**Native backend** — engine runs on device via AAR:

Leave `EXPO_PUBLIC_HYDRIS_API_URL` unset. To push test data from your machine to the device:

```bash
adb forward tcp:50051 tcp:50051
```

| Command       | Direction     | Use case                       |
| ------------- | ------------- | ------------------------------ |
| `adb reverse` | device → host | Remote backend on your machine |
| `adb forward` | host → device | Native backend on device       |

> If `adb reverse` fails with "Address already in use", the native backend may be running. Force stop the app first:
>
> ```bash
> adb shell am force-stop com.q.hydris
> # or
> adb reboot && adb wait-for-device && adb reverse tcp:50051 tcp:50051
> ```

## Code Quality

```bash
bun lint               # eslint check
bun lint:fix           # eslint fix
bun format             # prettier format
bun type-check         # typescript check
bun test               # run tests
```

## Structure

```
view/
├── apps/
│   └── foss/                  # app
│       └── app/               # routes
├── packages/
│   ├── core/                  # shared features (aware, sensors, api, stores)
│   ├── hydris-engine/         # native module wrapping hydris.aar
│   ├── map-engine/            # map abstraction (deck.gl + maplibre)
│   ├── ui/                    # shared ui components
│   ├── eslint-config/
│   └── typescript-config/
```

## Environment Variables

```bash
cp apps/foss/env-example apps/foss/.env.development
```

| Variable                     | Description     | Default                  |
| ---------------------------- | --------------- | ------------------------ |
| `EXPO_PUBLIC_HYDRIS_API_URL` | Backend API URL | `window.location.origin` |

## Cluster Worker Bundle

`packages/map-engine/src/layers/cluster-worker-code.ts` is auto-generated — do not edit manually.

Rebuild after changing `cluster-logic.ts` or `cluster-worker.ts`:

```bash
bun run --cwd packages/map-engine bundle:worker
```

## Troubleshooting

Clear Expo cache if you hit stale state:

```bash
bun dev --clear
```

## Protocol Buffers

Proto types are provided by [`@projectqai/proto`](https://www.npmjs.com/package/@projectqai/proto).
