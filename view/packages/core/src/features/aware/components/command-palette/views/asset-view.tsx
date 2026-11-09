"use no memo";

import { Badge, type BadgeVariant } from "@hydris/ui/badge";
import type { PaletteAction } from "@hydris/ui/command-palette/palette-reducer";
import { ControlButton } from "@hydris/ui/controls";
import { Empty, EmptyTitle } from "@hydris/ui/empty-state";
import { FieldDescription } from "@hydris/ui/field";
import { useThemeColors } from "@hydris/ui/lib/theme";
import { ScrollShadow } from "@hydris/ui/scroll-shadow";
import type { Entity } from "@projectqai/proto/world";
import { LocateFixed, MapPin, Settings2 } from "lucide-react-native";
import { type Dispatch, useMemo } from "react";
import { ScrollView, Text, View } from "react-native";

import { useRunTaskable } from "../../../../../lib/api/use-run-task";
import { getEntityName } from "../../../../../lib/api/use-track-utils";
import {
  isCommissionPositionTaskable,
  useEntityTaskables,
} from "../../../hooks/use-entity-taskables";
import { usePlacement } from "../../../placement-context";
import { useEntityStore } from "../../../store/entity-store";
import {
  type AssetReadiness,
  deriveAssetReadiness,
  gateValue,
  type ReadinessGate,
  type ReadinessGateKey,
} from "../../../utils/asset-readiness";
import { formatRelativeTime, getSharedTimestamp } from "../../../utils/format-metrics";
import { READINESS_VISUAL } from "../../../utils/readiness-display";
import { isTaskRunning } from "../../../utils/task-state";
import { EntityHeader } from "../../entity-header";

const GATE_LABEL: Record<ReadinessGateKey, string> = {
  position: "Position",
  device: "Device",
  link: "Link",
};

function readinessVariant(readiness: AssetReadiness): BadgeVariant {
  if (readiness.ready) return "success";

  if (readiness.failed) return "danger";

  return "pending";
}

function ChecklistRow({ entity, gate }: { entity: Entity; gate: ReadinessGate }) {
  const t = useThemeColors();
  const { icon: Icon, colorKey } = READINESS_VISUAL[gate.status];
  const color = t[colorKey];

  return (
    <View className="flex-row items-center gap-3 px-5 py-2">
      <Icon aria-hidden size={16} strokeWidth={2} color={color} />
      <Text className="text-foreground/80 flex-1 font-sans text-sm">{GATE_LABEL[gate.key]}</Text>
      <Text className="font-sans-medium shrink-0 text-sm" style={{ color }} numberOfLines={1}>
        {gateValue(entity, gate)}
      </Text>
    </View>
  );
}

function AssetDetail({ entity, dispatch }: { entity: Entity; dispatch: Dispatch<PaletteAction> }) {
  const placement = usePlacement();
  const readiness = deriveAssetReadiness(entity);
  const placed = readiness.gates.find((g) => g.key === "position")?.status === "met";
  const canConfig = !!(entity.configurable || entity.device);
  const taskables = useEntityTaskables(entity.id);
  const autoPosition = useMemo(() => taskables.find(isCommissionPositionTaskable), [taskables]);

  const { run: runTaskable, isPending: isPositioning } = useRunTaskable({
    successToast: "Positioned",
  });

  const positioning = isPositioning || isTaskRunning(autoPosition);

  const headVariant = readinessVariant(readiness);

  const sharedTs = getSharedTimestamp(entity.metric?.metrics ?? []);
  const metricsTimestamp = sharedTs ? formatRelativeTime(sharedTs) : undefined;

  return (
    <ScrollShadow size="sm" className="flex-1">
      <ScrollView className="flex-1" showsVerticalScrollIndicator={false}>
        <EntityHeader
          entity={entity}
          title={getEntityName(entity)}
          timestamp={metricsTimestamp}
          className="px-5 py-4"
        >
          <Badge variant={headVariant} size="sm">
            {readiness.ready ? "Ready" : "Not ready"}
          </Badge>
        </EntityHeader>
        <View className="bg-surface-overlay/6 mx-5 h-px" />

        <View className="py-1">
          {readiness.gates.map((gate) => (
            <ChecklistRow key={gate.key} entity={entity} gate={gate} />
          ))}
        </View>

        {(!placed || canConfig) && (
          <View className="gap-2 px-5 pt-3">
            {!placed && autoPosition && (
              <ControlButton
                icon={LocateFixed}
                label={
                  positioning ? "Positioning…" : autoPosition.taskable?.label || "Auto position"
                }
                onPress={() => runTaskable(autoPosition.id)}
                disabled={positioning || autoPosition.taskable?.disabled !== undefined}
                loading={positioning}
                fullWidth
              />
            )}
            {!placed && autoPosition?.taskable?.disabled && (
              <FieldDescription>{autoPosition.taskable.disabled}</FieldDescription>
            )}
            {!placed && (
              <ControlButton
                icon={MapPin}
                label="Place on map"
                onPress={() => placement.enterPlacement(entity)}
                fullWidth
              />
            )}
            {canConfig && (
              <ControlButton
                icon={Settings2}
                label="Open Configuration"
                onPress={() =>
                  dispatch({ type: "push", mode: { kind: "config", entityId: entity.id } })
                }
                fullWidth
              />
            )}
          </View>
        )}
      </ScrollView>
    </ScrollShadow>
  );
}

export function AssetView({
  entityId,
  dispatch,
}: {
  entityId: string;
  dispatch: Dispatch<PaletteAction>;
}) {
  const entity = useEntityStore((s) => s.entities.get(entityId));

  if (!entity) {
    return (
      <Empty>
        <EmptyTitle>Asset no longer exists</EmptyTitle>
      </Empty>
    );
  }

  return <AssetDetail entity={entity} dispatch={dispatch} />;
}
