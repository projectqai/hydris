import { CameraTile } from "../../../../mission/components/camera-tile";
import { DeviceTile } from "../../../../mission/components/device-tile";
import type { ServiceRow } from "../../../../mission/provider-state";

export function ChildTile({
  row: { device, state },
  onPress,
  highlighted,
}: {
  row: ServiceRow;
  onPress: () => void;
  highlighted: boolean;
}) {
  return device.camera ? (
    <CameraTile camera={device} onPress={onPress} highlighted={highlighted} />
  ) : (
    <DeviceTile device={device} state={state} onPress={onPress} highlighted={highlighted} />
  );
}
