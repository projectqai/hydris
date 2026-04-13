import { EmptyState } from "@hydris/ui/empty-state";
import { useThemeColors } from "@hydris/ui/lib/theme";
import type { Entity } from "@projectqai/proto/world";
import { DeviceState, LinkStatus } from "@projectqai/proto/world";
import {
  Battery,
  Camera,
  CircleDot,
  Compass,
  Cpu,
  Gauge,
  ListTodo,
  MapPin,
  Radar,
  Scan,
  Target,
  Wifi,
} from "lucide-react-native";
import type { ComponentType } from "react";
import { ScrollView, Text, View } from "react-native";

type ComponentsTabProps = {
  entity: Entity;
};

type ComponentDef = {
  icon: ComponentType<{ size: number; color: string; strokeWidth?: number }>;
  label: string;
  description: string;
};

function ComponentItem({ icon: Icon, label, description }: ComponentDef) {
  const t = useThemeColors();
  return (
    <View className="flex-row items-center gap-2 py-1.5">
      <View className="w-5 items-center">
        <Icon size={15} color={t.iconSubtle} strokeWidth={2} />
      </View>
      <View className="flex-1">
        <Text className="font-sans-medium text-foreground/80 text-xs">{label}</Text>
        <Text className="text-foreground/75 text-11">{description}</Text>
      </View>
    </View>
  );
}

function getActiveComponents(entity: Entity): ComponentDef[] {
  const components: ComponentDef[] = [];

  if (entity.track) {
    components.push({ icon: CircleDot, label: "Track", description: "Tracked object" });
  }
  if (entity.geo) {
    components.push({ icon: MapPin, label: "GeoSpatial", description: "Position data" });
  }
  if (entity.kinematics) {
    components.push({ icon: Gauge, label: "Kinematics", description: "Velocity & acceleration" });
  }
  if (entity.bearing) {
    components.push({ icon: Compass, label: "Bearing", description: "Azimuth & elevation" });
  }
  if (entity.camera) {
    const count = entity.camera.streams?.length ?? 0;
    components.push({ icon: Camera, label: "Camera", description: `${count} feed(s)` });
  }
  if (entity.detection) {
    components.push({ icon: Target, label: "Detection", description: "Sensor detection" });
  }
  if (entity.link) {
    const statusLabel =
      entity.link.status === LinkStatus.LinkStatusConnected
        ? "Connected"
        : entity.link.status === LinkStatus.LinkStatusDegraded
          ? "Degraded"
          : entity.link.status === LinkStatus.LinkStatusLost
            ? "Lost"
            : "Unknown";
    components.push({ icon: Wifi, label: "Link", description: `Data link (${statusLabel})` });
  }
  if (entity.power) {
    const pct =
      entity.power.batteryChargeRemaining != null
        ? `${Math.round(entity.power.batteryChargeRemaining * 100)}%`
        : "—";
    components.push({ icon: Battery, label: "Power", description: `Battery ${pct}` });
  }
  if (entity.device) {
    const stateLabel =
      entity.device.state === DeviceState.DeviceStateActive
        ? "Active"
        : entity.device.state === DeviceState.DeviceStateFailed
          ? "Failed"
          : "Pending";
    components.push({ icon: Cpu, label: "Device", description: `Device (${stateLabel})` });
  }
  if (entity.geo?.covariance) {
    components.push({ icon: Radar, label: "Position Covariance", description: "Covariance data" });
  }
  if (entity.locator) {
    components.push({ icon: Scan, label: "Locator", description: "Location reference" });
  }
  if (entity.taskable) {
    components.push({ icon: ListTodo, label: "Taskable", description: "Can execute tasks" });
  }

  return components;
}

export function ComponentsTab({ entity }: ComponentsTabProps) {
  const components = getActiveComponents(entity);

  if (components.length === 0) {
    return <EmptyState title="No components" />;
  }

  return (
    <ScrollView className="flex-1">
      <View className="px-3 pt-3 pb-2">
        <Text className="text-foreground/75 text-11 mb-1 font-mono tracking-widest uppercase">
          Active Components ({components.length})
        </Text>
        {components.map((comp) => (
          <ComponentItem key={comp.label} {...comp} />
        ))}
      </View>
    </ScrollView>
  );
}
