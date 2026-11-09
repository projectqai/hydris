import { getDeviceName } from "../../../lib/api/use-track-utils";
import { getEntityIcon, UNKNOWN_ICON } from "../../aware/utils/entity-helpers";
import type { ServiceRow, TileState } from "../provider-state";
import { getServiceLabel } from "../sources";
import { useServiceState } from "../use-mission-state";
import { MissionTile } from "./mission-tile";
import { MissionTileRow } from "./mission-tile-row";
import { MissionTileStatus } from "./mission-tile-status";

const MAX_ROWS = 3;

function DeviceRow({ label, state }: { label: string; state: TileState }) {
  return (
    <MissionTileRow label={label}>
      <MissionTileStatus variant={state.variant} state={state} />
    </MissionTileRow>
  );
}

function DeviceRows({ rows }: { rows: ServiceRow[] }) {
  const hidden = rows.slice(MAX_ROWS);

  return (
    <>
      {rows.slice(0, MAX_ROWS).map(({ device, state }) => (
        <DeviceRow key={device.id} label={getDeviceName(device)} state={state} />
      ))}
      {hidden[0] && <DeviceRow label={`+${hidden.length} more`} state={hidden[0].state} />}
    </>
  );
}

export function ServiceTile({
  serviceId,
  onPress,
  highlighted,
}: {
  serviceId: string;
  onPress: () => void;
  highlighted: boolean;
}) {
  const { service, rows, state } = useServiceState(serviceId);
  const label = getServiceLabel({ serviceId, service });

  return (
    <MissionTile
      title={label}
      icon={service ? getEntityIcon(service) : UNKNOWN_ICON}
      label={label}
      state={state}
      onPress={onPress}
      highlighted={highlighted}
    >
      {rows.length > 0 ? <DeviceRows rows={rows} /> : undefined}
    </MissionTile>
  );
}
