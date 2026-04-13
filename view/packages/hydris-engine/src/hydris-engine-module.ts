import { NativeModule, requireNativeModule } from "expo-modules-core";

declare class HydrisEngineModule extends NativeModule<Record<string, never>> {
  requestRequiredPermissions(): Promise<boolean>;
  startEngineService(): Promise<string>;
  stopEngine(): Promise<string>;
  isRunning(): Promise<boolean>;
}

export default requireNativeModule<HydrisEngineModule>("HydrisEngine");
