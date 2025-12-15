# Android Build Guide

This document explains how the Android build works and how to build Hydra for Android devices.

## Overview

Hydra runs natively on Android by compiling the Go backend into an Android Archive (AAR) using [gomobile](https://pkg.go.dev/golang.org/x/mobile/cmd/gomobile). This AAR is then integrated into the Expo/React Native frontend as a native module that runs as an Android Foreground Service.

```
┌─────────────────────────────────────────────────────────────────┐
│                        Android App                              │
├─────────────────────────────────────────────────────────────────┤
│  Expo/React Native UI                                           │
│  └── @hydra/hydra-engine (Expo Module)                          │
│      └── HydraEngineService (Foreground Service)                │
│          └── hydra.aar (Go backend compiled via gomobile)       │
│              └── StartEngine() / StopEngine()                   │
└─────────────────────────────────────────────────────────────────┘
```

## Architecture

### Components

1. **`android/lib.go`** - Go library exposing functions for Android
2. **`hydra.aar`** - Compiled Android Archive from Go code
3. **`@hydra/hydra-engine`** - Expo native module (Kotlin)
4. **`HydraEngineService`** - Android Foreground Service
5. **`HydraEngineModule`** - Expo module definition

### Data Flow

```
React Native App
      │
      ▼
HydraEngine.startEngineService()  (TypeScript)
      │
      ▼
HydraEngineModule.kt              (Kotlin - Expo Module)
      │
      ▼
HydraEngineService.kt             (Android Foreground Service)
      │
      ▼
Hydra.startEngine()               (Go via gomobile)
      │
      ▼
HTTP Server on :50051              (gRPC + Web UI)
```

## Prerequisites

- **Go 1.25+** - https://go.dev/dl/
- **Android SDK** - https://developer.android.com/studio
- **Android NDK** - Install via Android Studio SDK Manager
- **gomobile** - `go install golang.org/x/mobile/cmd/gomobile@latest`
- **Bun** - https://bun.sh

### Environment Setup

```bash
# Set ANDROID_HOME (adjust path as needed)
export ANDROID_HOME=$HOME/Library/Android/sdk  # macOS
export ANDROID_HOME=$HOME/Android/Sdk          # Linux

# Add to PATH
export PATH=$PATH:$ANDROID_HOME/platform-tools

# Initialize gomobile (required once)
gomobile init
```

## Building

### Quick Build

```bash
make android
```

This runs:

1. `gomobile bind` - Compiles Go to AAR
2. `gradlew assembleRelease` - Builds the Android APK

### Step-by-Step Build

#### 1. Build the AAR

```bash
cd android
gomobile bind -target=android -androidapi 24 -o hydra.aar
```

Options:

- `-target=android` - Build for Android
- `-androidapi 24` - Minimum API level (Android 7.0)
- `-o hydra.aar` - Output file

#### 2. Copy AAR to Expo Module

```bash
cp android/hydra.aar view/frontend/packages/hydra-engine/android/libs/
```

#### 3. Build the Frontend

```bash
cd view/frontend
bun install
bun android
```

Or build a release APK:

```bash
cd view/frontend/android
./gradlew assembleRelease
```

#### 4. Install on Device

```bash
adb install -r view/frontend/android/app/build/outputs/apk/release/app-release.apk
```

## Go Library API

The `android/lib.go` file exposes these functions to Android:

```go
// Port is the configurable port for the engine server
var Port int = 50051

// SetPort sets the port for the engine server
// Must be called before StartEngine()
// Returns error message if engine is already running
func SetPort(p int) string

// GetPort returns the currently configured port
func GetPort() int

// StartEngine starts the Hydra server
// Returns: "Engine started on :50051" or error message
func StartEngine() string

// StopEngine stops the Hydra server gracefully
// Returns: "Engine stopped" or error message
func StopEngine() string

// IsEngineRunning checks if the engine is currently running
func IsEngineRunning() bool

// GetEngineStatus returns the current engine status
// Returns: "running on :50051" or "stopped"
func GetEngineStatus() string
```

### Configuring the Port

To use a different port, call `SetPort()` before `StartEngine()`:

```go
hydra.SetPort(3000)
hydra.StartEngine()
```

**Note:** gomobile exports Go `int` as Java/Kotlin `long`.

## Expo Module

### TypeScript API

```typescript
import * as HydraEngine from "@hydra/hydra-engine";

// Start the engine as a foreground service
await HydraEngine.startEngineService();

// Stop the engine
await HydraEngine.stopEngine();
```

### Platform Support

The module only works on Android. On other platforms, it returns `"unsupported"`:

```typescript
const result = await HydraEngine.startEngineService();
// Android: "started"
// iOS/Web: "unsupported"
```

## Android Foreground Service

The engine runs as an Android Foreground Service to:

- Keep the server running when the app is in the background
- Prevent the system from killing the process
- Show a persistent notification to the user

### Service Configuration

**AndroidManifest.xml:**
```xml
<uses-permission android:name="android.permission.FOREGROUND_SERVICE" />
<uses-permission android:name="android.permission.FOREGROUND_SERVICE_CONNECTED_DEVICE" />
<uses-permission android:name="android.permission.POST_NOTIFICATIONS" />

<service
    android:name=".HydraEngineService"
    android:foregroundServiceType="connectedDevice"
    android:stopWithTask="false"
    android:exported="false" />
```

### Service Behavior

- **START_STICKY** - Service restarts if killed by the system
- **stopWithTask="false"** - Service continues when app is swiped away
- **connectedDevice** - Service type for network-connected devices

## Connecting to the Server

Once the engine is running, connect to it at:

```
http://localhost:50051
```

### From Another Device

To connect from your development machine to the device:

```bash
# Forward device port to local machine
adb reverse tcp:50051 tcp:50051
```

Then access `http://localhost:50051` on your machine.

### Pushing Test Data

```bash
# Forward local port to device (for pushing data TO device)
adb forward tcp:50051 tcp:50051

# Push entities
bun examples/cuas/push-entities.ts --port 50051
```

## Troubleshooting

### gomobile not found

```bash
go install golang.org/x/mobile/cmd/gomobile@latest
gomobile init
```

### NDK not found

Install NDK via Android Studio:
1. Open SDK Manager
2. SDK Tools tab
3. Check "NDK (Side by side)"
4. Apply

Or set manually:
```bash
export ANDROID_NDK_HOME=$ANDROID_HOME/ndk/<version>
```

### AAR not found during build

Ensure the AAR is copied to the correct location:
```bash
ls view/frontend/packages/hydra-engine/android/libs/hydra.aar
```

### Service not starting

Check logcat for errors:

```bash
adb logcat -s HydraEngineService
```

### Port already in use

The engine checks if it's already running:

```kotlin
if (Hydra.isEngineRunning()) {
    // Already running
}
```

## File Structure

```
android/
├── lib.go          # Go functions exposed to Android
├── go.mod          # Go module (separate from main module)
└── go.sum

view/frontend/packages/hydra-engine/
├── src/
│   └── index.ts                    # TypeScript API
├── android/
│   ├── build.gradle                # Gradle build config
│   ├── libs/
│   │   └── hydra.aar              # Compiled Go library (generated)
│   └── src/main/
│       ├── AndroidManifest.xml     # Permissions & service declaration
│       └── java/expo/modules/hydraengine/
│           ├── HydraEngineModule.kt    # Expo module definition
│           └── HydraEngineService.kt   # Foreground service
├── expo-module.config.json         # Expo module config
└── README.md
```

## Development Workflow

### Making Changes to Go Code

1. Edit `android/lib.go` or engine code
2. Rebuild AAR: `cd android && gomobile bind -target=android -androidapi 24 -o hydra.aar`
3. Copy to module: `cp hydra.aar ../view/frontend/packages/hydra-engine/android/libs/`
4. Rebuild app: `cd view/frontend && bun android`

### Making Changes to Kotlin Code

1. Edit files in `view/frontend/packages/hydra-engine/android/`
2. Rebuild: `cd view/frontend && bun android`

Changes to Kotlin code don't require rebuilding the AAR.

## Production Considerations

- **Signing:** Configure release signing in `android/app/build.gradle`
- **ProGuard:** The AAR may need ProGuard rules to prevent stripping
- **Permissions:** Request `POST_NOTIFICATIONS` permission at runtime (Android 13+)
- **Battery:** Consider battery optimization exemptions for critical deployments
