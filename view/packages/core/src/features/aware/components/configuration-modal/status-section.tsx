"use no memo";

import { useThemeColors } from "@hydris/ui/lib/theme";
import { cn } from "@hydris/ui/lib/utils";
import type { Entity } from "@projectqai/proto/world";
import { Activity, Battery, Cpu, Wifi } from "lucide-react-native";
import type { ComponentType } from "react";
import { Fragment } from "react";
import { Text, View } from "react-native";

import { formatTime } from "../../../../lib/api/use-track-utils";
import { formatDeviceState, formatDuration, formatLinkStatus } from "../../utils/format-entity";

type StatusReading = {
  key: string;
  label: string;
  value: string;
  className?: string;
  mono?: boolean;
};

type StatusGroupKey = "device" | "power" | "link";

type StatusGroup = { key: StatusGroupKey; rows: StatusReading[] };

export const DEVICE_STATE_KEY = "state";

const GROUPS: Record<
  StatusGroupKey,
  { icon: ComponentType<{ size: number; color: string; strokeWidth?: number }>; label: string }
> = {
  device: { icon: Cpu, label: "Device" },
  power: { icon: Battery, label: "Power" },
  link: { icon: Wifi, label: "Data Link" },
};

function readDevice(
  device: NonNullable<Entity["device"]>,
  mission: Entity["mission"],
): StatusReading[] {
  const { label, className } = formatDeviceState(device.state);

  const rows: StatusReading[] = [
    { key: DEVICE_STATE_KEY, label: "State", value: label, className },
  ];

  if (mission?.destination) {
    rows.push({ key: "destination", label: "Destination", value: mission.destination });
  }

  if (device.uniqueHardwareId) {
    rows.push({
      key: "hardware-id",
      label: "Hardware ID",
      value: device.uniqueHardwareId,
      mono: true,
    });
  }

  return rows;
}

function readPower(power: NonNullable<Entity["power"]>): StatusReading[] {
  const { batteryChargeRemaining, voltage, remainingSeconds } = power;
  const rows: StatusReading[] = [];

  if (batteryChargeRemaining !== undefined) {
    const value = `${Math.round(batteryChargeRemaining * 100)}%`;

    rows.push({ key: "battery", label: "Battery", value, mono: true });
  }

  if (voltage !== undefined) {
    rows.push({ key: "voltage", label: "Voltage", value: `${voltage.toFixed(1)} V`, mono: true });
  }

  if (remainingSeconds !== undefined) {
    const value = formatDuration(remainingSeconds);

    rows.push({ key: "remaining", label: "Remaining", value, mono: true });
  }

  return rows;
}

function readLink(link: NonNullable<Entity["link"]>): StatusReading[] {
  const { label, className } = formatLinkStatus(link.status);
  const rows: StatusReading[] = [{ key: "link", label: "Status", value: label, className }];

  if (link.lastSeen) {
    rows.push({
      key: "last-seen",
      label: "Last seen",
      value: formatTime(link.lastSeen),
      mono: true,
    });
  }

  if (link.lastLatencyMs !== undefined) {
    rows.push({ key: "latency", label: "Latency", value: `${link.lastLatencyMs} ms`, mono: true });
  }

  if (link.linkQualityPercent !== undefined) {
    const value = `${link.linkQualityPercent}%`;

    rows.push({ key: "quality", label: "Quality", value, mono: true });
  }

  if (link.rssiDbm !== undefined) {
    rows.push({ key: "rssi", label: "RSSI", value: `${link.rssiDbm} dBm`, mono: true });
  }

  if (link.snrDb !== undefined) {
    rows.push({ key: "snr", label: "SNR", value: `${link.snrDb} dB`, mono: true });
  }

  return rows;
}

export function readStatus({ device, mission, power, link }: Entity): StatusGroup[] {
  const groups: StatusGroup[] = [];

  if (device) groups.push({ key: "device", rows: readDevice(device, mission) });

  if (power) groups.push({ key: "power", rows: readPower(power) });

  if (link) groups.push({ key: "link", rows: readLink(link) });

  return groups;
}

function StatusRow({ label, value, className, mono }: Omit<StatusReading, "key">) {
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
          className,
        )}
      >
        {value}
      </Text>
    </View>
  );
}

function SectionHeader({ group, first }: { group: StatusGroupKey; first: boolean }) {
  const t = useThemeColors();
  const { icon: Icon, label } = GROUPS[group];

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

export function StatusSection({ entity }: { entity: Entity }) {
  const t = useThemeColors();
  const groups = readStatus(entity);

  if (groups.length === 0) {
    return (
      <View className="items-center justify-center gap-2 px-4 py-8">
        <Activity size={24} strokeWidth={1.5} color={t.iconMuted} />
        <Text className="text-muted-foreground font-sans text-sm">No status available</Text>
      </View>
    );
  }

  return (
    <View className="py-2">
      {groups.map(({ key, rows }, index) => (
        <Fragment key={key}>
          <SectionHeader group={key} first={index === 0} />
          {rows.map(({ key: rowKey, ...row }) => (
            <StatusRow key={rowKey} {...row} />
          ))}
        </Fragment>
      ))}
    </View>
  );
}
