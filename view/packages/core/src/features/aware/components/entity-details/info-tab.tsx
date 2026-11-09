import { Empty, EmptyTitle } from "@hydris/ui/empty-state";
import { InfoRow } from "@hydris/ui/info-row";
import { useThemeColors } from "@hydris/ui/lib/theme";
import { cn } from "@hydris/ui/lib/utils";
import type { Entity } from "@projectqai/proto/world";
import { DeviceState } from "@projectqai/proto/world";
import * as Clipboard from "expo-clipboard";
import {
  AlertTriangle,
  AudioWaveform,
  Battery,
  Calendar,
  CirclePower,
  Clock,
  Copy,
  Cpu,
  Fingerprint,
  type LucideIcon,
  Network,
  Plug,
  Settings2,
  Signal,
  Wifi,
} from "lucide-react-native";
import { Pressable, Text, View } from "react-native";

import { formatTime } from "../../../../lib/api/use-track-utils";
import { toast } from "../../../../lib/sonner";
import {
  formatConfigurableState,
  formatDeviceState,
  formatDuration,
  formatLinkStatus,
} from "../../utils/format-entity";
import { EntityLinkRow } from "./entity-link-row";

type InfoTabProps = {
  entity: Entity;
};

function StateRow({
  icon: Icon,
  label,
  state,
}: {
  icon: LucideIcon;
  label: string;
  state: { label: string; className: string };
}) {
  const t = useThemeColors();

  return (
    <View className="flex-row items-center gap-2 py-1.5">
      <View className="w-5 items-center">
        <Icon size={15} color={t.iconSubtle} strokeWidth={2} />
      </View>
      <View className="flex-1 flex-row items-center justify-between gap-2">
        <Text className="font-sans-medium text-foreground/75 text-xs">{label}</Text>
        <Text className={cn("font-sans-medium text-xs", state.className)}>{state.label}</Text>
      </View>
    </View>
  );
}

function LinkSection({ entity }: { entity: Entity }) {
  if (!entity.link) return null;

  return (
    <View className="border-foreground/10 border-t px-3 pt-3 pb-2">
      <Text className="text-foreground/75 text-11 mb-1 font-mono tracking-widest uppercase">
        Data Link
      </Text>
      <StateRow icon={Wifi} label="Status" state={formatLinkStatus(entity.link.status)} />
      {entity.link.rssiDbm !== undefined && (
        <InfoRow icon={Signal} label="RSSI" value={`${entity.link.rssiDbm} dBm`} mono />
      )}
      {entity.link.snrDb !== undefined && (
        <InfoRow icon={AudioWaveform} label="SNR" value={`${entity.link.snrDb} dB`} mono />
      )}
      {!!entity.link.via && <EntityLinkRow icon={Wifi} label="Via" entityId={entity.link.via} />}
    </View>
  );
}

function PowerSection({ entity }: { entity: Entity }) {
  if (!entity.power) return null;

  return (
    <View className="border-foreground/10 border-t px-3 pt-3 pb-2">
      <Text className="text-foreground/75 text-11 mb-1 font-mono tracking-widest uppercase">
        Power
      </Text>
      {entity.power.batteryChargeRemaining !== undefined && (
        <InfoRow
          icon={Battery}
          label="Battery"
          value={`${Math.round(entity.power.batteryChargeRemaining * 100)}%`}
          mono
        />
      )}
      {entity.power.voltage !== undefined && (
        <InfoRow icon={Plug} label="Voltage" value={`${entity.power.voltage.toFixed(1)} V`} mono />
      )}
      {entity.power.remainingSeconds !== undefined && (
        <InfoRow
          icon={Clock}
          label="Remaining"
          value={formatDuration(entity.power.remainingSeconds)}
          mono
        />
      )}
    </View>
  );
}

function DeviceSection({ entity }: { entity: Entity }) {
  if (!entity.device) return null;
  const { configurable } = entity;

  return (
    <View className="border-foreground/10 border-t px-3 pt-3 pb-2">
      <Text className="text-foreground/75 text-11 mb-1 font-mono tracking-widest uppercase">
        Device
      </Text>
      <StateRow icon={Cpu} label="State" state={formatDeviceState(entity.device.state)} />
      {configurable && (
        <StateRow
          icon={Settings2}
          label="Config"
          state={formatConfigurableState(configurable.state)}
        />
      )}
      {!!entity.mission?.destination && (
        <InfoRow icon={CirclePower} label="Destination" value={entity.mission.destination} />
      )}
      {(entity.device.state === DeviceState.DeviceStateFailed ||
        entity.device.state === DeviceState.DeviceStateDegraded) &&
        !!entity.device.error && (
          <InfoRow icon={AlertTriangle} label="Error" value={entity.device.error} />
        )}
      {!!entity.device.uniqueHardwareId && (
        <InfoRow
          icon={Fingerprint}
          label="Hardware ID"
          value={entity.device.uniqueHardwareId}
          onCopy
        />
      )}
      {!!entity.device.parent && (
        <EntityLinkRow icon={Network} label="Parent" entityId={entity.device.parent} />
      )}
    </View>
  );
}

export function InfoTab({ entity }: InfoTabProps) {
  const t = useThemeColors();
  const copyMilSymbol = async () => {
    if (entity.symbol?.milStd2525C) {
      await Clipboard.setStringAsync(entity.symbol.milStd2525C);
      toast.success("Copied to clipboard");
    }
  };

  const hasSymbol = !!entity.symbol?.milStd2525C;
  const hasLifetime = !!entity.lifetime;
  const hasLink = !!entity.link;
  const hasPower = !!entity.power;
  const hasDevice = !!entity.device;

  if (!hasSymbol && !hasLifetime && !hasLink && !hasPower && !hasDevice) {
    return (
      <Empty>
        <EmptyTitle>No data available</EmptyTitle>
      </Empty>
    );
  }

  return (
    <View>
      {entity.symbol && (
        <View className="px-3 pt-3 pb-2">
          <View className="mb-1 flex-row items-center justify-between">
            <Text className="text-foreground/75 text-11 font-mono tracking-widest uppercase">
              Military Symbol
            </Text>
            <Pressable
              onPress={copyMilSymbol}
              hitSlop={8}
              accessibilityLabel="Copy military symbol"
              accessibilityRole="button"
              className="hover:opacity-70 active:opacity-50"
            >
              <Copy size={12} color={t.iconMuted} strokeWidth={2} />
            </Pressable>
          </View>
          <InfoRow label="MIL-STD-2525C" value={entity.symbol.milStd2525C} />
        </View>
      )}

      {entity.lifetime && (
        <View className="border-foreground/10 border-t px-3 pt-3 pb-2">
          <Text className="text-foreground/75 text-11 mb-1 font-mono tracking-widest uppercase">
            Lifetime
          </Text>
          {entity.lifetime.from && (
            <InfoRow icon={Calendar} label="From" value={formatTime(entity.lifetime.from)} mono />
          )}
          {entity.lifetime.until && (
            <InfoRow icon={Calendar} label="Until" value={formatTime(entity.lifetime.until)} mono />
          )}
        </View>
      )}

      <LinkSection entity={entity} />
      <PowerSection entity={entity} />
      <DeviceSection entity={entity} />
    </View>
  );
}
