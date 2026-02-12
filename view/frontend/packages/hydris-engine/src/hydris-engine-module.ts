import { NativeModule, requireNativeModule } from "expo-modules-core";

declare class HydrisEngineModule extends NativeModule<Record<string, never>> {
  startEngineService(): Promise<string>;
  stopEngine(): Promise<string>;
}

export default requireNativeModule<HydrisEngineModule>("HydrisEngine");
