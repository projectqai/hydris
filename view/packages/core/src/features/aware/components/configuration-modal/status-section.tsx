"use no memo";

import { useThemeColors } from "@hydris/ui/lib/theme";
import { cn } from "@hydris/ui/lib/utils";
import type { Entity } from "@projectqai/proto/world";
import { DeviceState } from "@projectqai/proto/world";
import { Activity, Battery, Cpu, Wifi } from "lucide-react-native";
import type { ComponentType } from "react";
import { Text, View } from "react-native";

import { formatDeviceState, formatDuration, formatLinkStatus } from "../../utils/format-entity";

function StatusRow({
  label,
  value,
  valueClassName,
  mono,
}: {
  label: string;
  value: string;
  valueClassName?: string;
  mono?: boolean;
}) {
  return (
    <View className="flex-row items-baseline justify-between px-5 py-2">
      <Text className="text-foreground/80 flex-1 font-sans text-sm" numberOfLines={1}>
        {label}
      </Text>
      <Text
        className={cn(
          "text-foreground shrink-0",
          mono ? "font-mono" : "font-sans-medium",
          "text-sm",
          valueClassName,
        )}
      >
        {value}
      </Text>
    </View>
  );
}

function SectionHeader({
  icon: Icon,
  label,
  first,
}: {
  icon: ComponentType<{ size: number; color: string; strokeWidth?: number }>;
  label: string;
  first?: boolean;
}) {
  const t = useThemeColors();
  return (
    <View
      className={cn(
        "flex-row items-center gap-1.5 px-5 pt-3 pb-1",
        !first && "border-foreground/10 border-t",
      )}
    >
      <Icon size={12} strokeWidth={2} color={t.iconSubtle} />
      <Text className="text-foreground/75 text-11 font-mono tracking-widest uppercase">
        {label}
      </Text>
    </View>
  );
}

function DeviceStatus({ entity, first }: { entity: Entity; first?: boolean }) {
  if (!entity.device) return null;
  const { label, className } = formatDeviceState(entity.device.state);
  const labelEntries = Object.entries(
    (entity.device as { labels?: Record<string, string> }).labels ?? {},
  );

  return (
    <>
      <SectionHeader icon={Cpu} label="Device" first={first} />
      <StatusRow label="State" value={label} valueClassName={className} />
      {entity.device.state === DeviceState.DeviceStateFailed && !!entity.device.error && (
        <StatusRow label="Error" value={entity.device.error} />
      )}
      {!!entity.device.uniqueHardwareId && (
        <StatusRow label="Hardware ID" value={entity.device.uniqueHardwareId} mono />
      )}
      {labelEntries.map(([key, val]) => (
        <StatusRow key={key} label={key} value={String(val)} />
      ))}
    </>
  );
}

function PowerStatus({ entity, first }: { entity: Entity; first?: boolean }) {
  if (!entity.power) return null;

  return (
    <>
      <SectionHeader icon={Battery} label="Power" first={first} />
      {entity.power.batteryChargeRemaining !== undefined && (
        <StatusRow
          label="Battery"
          value={`${Math.round(entity.power.batteryChargeRemaining * 100)}%`}
          mono
        />
      )}
      {entity.power.voltage !== undefined && (
        <StatusRow label="Voltage" value={`${entity.power.voltage.toFixed(1)} V`} mono />
      )}
      {entity.power.remainingSeconds !== undefined && (
        <StatusRow label="Remaining" value={formatDuration(entity.power.remainingSeconds)} mono />
      )}
    </>
  );
}

function DataLinkStatus({ entity, first }: { entity: Entity; first?: boolean }) {
  if (!entity.link) return null;
  const { label, className } = formatLinkStatus(entity.link.status);

  return (
    <>
      <SectionHeader icon={Wifi} label="Data Link" first={first} />
      <StatusRow label="Status" value={label} valueClassName={className} />
      {entity.link.rssiDbm !== undefined && (
        <StatusRow label="RSSI" value={`${entity.link.rssiDbm} dBm`} mono />
      )}
      {entity.link.snrDb !== undefined && (
        <StatusRow label="SNR" value={`${entity.link.snrDb} dB`} mono />
      )}
    </>
  );
}

export function StatusSection({ entity }: { entity: Entity }) {
  const t = useThemeColors();
  const hasAny = !!(entity.device || entity.power || entity.link);

  if (!hasAny) {
    return (
      <View className="items-center justify-center gap-2 px-4 py-8">
        <Activity size={24} strokeWidth={1.5} color={t.iconMuted} />
        <Text className="text-muted-foreground font-sans text-sm">No status available</Text>
      </View>
    );
  }

  const hasDevice = !!entity.device;
  const hasPower = !!entity.power;

  return (
    <View className="py-2">
      <DeviceStatus entity={entity} first />
      <PowerStatus entity={entity} first={!hasDevice} />
      <DataLinkStatus entity={entity} first={!hasDevice && !hasPower} />
    </View>
  );
}
