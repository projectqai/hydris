"use no memo";

import { Badge, type BadgeVariant } from "@hydris/ui/badge";
import { ListDetailShell } from "@hydris/ui/command-palette/list-detail-drawer";
import type { PaletteAction } from "@hydris/ui/command-palette/palette-reducer";
import { useKeyedListNav } from "@hydris/ui/command-palette/use-keyed-list-nav";
import { ControlButton } from "@hydris/ui/controls";
import { useKeyboardShortcut } from "@hydris/ui/keyboard";
import { useThemeColors } from "@hydris/ui/lib/theme";
import { cn } from "@hydris/ui/lib/utils";
import { type Entity, TaskExecutionState } from "@projectqai/proto/world";
import { ChevronRight, LocateFixed, MapPin, Radio, Settings2 } from "lucide-react-native";
import { type Dispatch, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";

import { useRunTaskable } from "../../../../../lib/api/use-run-task";
import { getEntityName } from "../../../../../lib/api/use-track-utils";
import { toast } from "../../../../../lib/sonner";
import { useAssets } from "../../../hooks/use-asset-readiness";
import {
  isCommissionPositionTaskable,
  useEntityTaskables,
} from "../../../hooks/use-entity-taskables";
import { usePlacement } from "../../../placement-context";
import {
  type AssetReadiness,
  deriveAssetReadiness,
  gateValue,
  type ReadinessGate,
  type ReadinessGateKey,
  worstBlocker,
} from "../../../utils/asset-readiness";
import { getEntityIcon } from "../../../utils/entity-helpers";
import { formatRelativeTime, getSharedTimestamp } from "../../../utils/format-metrics";
import { READINESS_VISUAL } from "../../../utils/readiness-display";
import { filterAssets } from "../palette-search";

type AssetEntry = { entity: Entity; readiness: AssetReadiness };

const GATE_LABEL: Record<ReadinessGateKey, string> = {
  position: "Position",
  device: "Device",
  link: "Link",
};

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

function AssetDetail({
  entity,
  readiness,
  dispatch,
  onPlace,
}: {
  entity: Entity;
  readiness: AssetReadiness;
  dispatch: Dispatch<PaletteAction>;
  onPlace: () => void;
}) {
  const placed = readiness.gates.find((g) => g.key === "position")?.status === "met";
  const canConfig = !!(entity.configurable || entity.device);
  const taskables = useEntityTaskables(entity.id);
  const autoPosition = useMemo(() => taskables.find(isCommissionPositionTaskable), [taskables]);
  const { run: runTaskable, isPending: isPositioning } = useRunTaskable();

  const execState = autoPosition?.taskExecution?.state;
  const execReason = autoPosition?.taskExecution?.reason;
  const positioning =
    isPositioning ||
    execState === TaskExecutionState.TaskExecutionStatePending ||
    execState === TaskExecutionState.TaskExecutionStateRunning;

  // toast once per terminal transition of the position task. success is also the
  // Ready flip, but failure has no other signal.
  const prevExecState = useRef(execState);
  useEffect(() => {
    if (prevExecState.current === execState) return;
    prevExecState.current = execState;
    if (execState === TaskExecutionState.TaskExecutionStateCompleted) {
      toast.success("Positioned");
    } else if (execState === TaskExecutionState.TaskExecutionStateFailed) {
      toast.error(execReason || "Positioning failed");
    }
  }, [execState, execReason]);

  const headVariant: BadgeVariant = readiness.ready
    ? "success"
    : readiness.failed
      ? "danger"
      : "pending";
  const t = useThemeColors();
  const Icon = getEntityIcon(entity);
  const sharedTs = getSharedTimestamp(entity.metric?.metrics ?? []);
  const metricsTimestamp = sharedTs ? formatRelativeTime(sharedTs) : undefined;

  return (
    <ScrollView className="flex-1" showsVerticalScrollIndicator={false}>
      <View className="flex-row items-center gap-3 px-5 py-4">
        <View className="bg-glass border-surface-overlay/4 size-11 items-center justify-center rounded-lg border">
          <Icon aria-hidden size={20} strokeWidth={2} color={t.iconDefault} />
        </View>
        <View className="min-w-0 flex-1 gap-0.5">
          <Text className="text-foreground font-sans-semibold text-base" numberOfLines={1}>
            {getEntityName(entity)}
          </Text>
          <View className="flex-row items-center gap-1.5">
            <Text className="text-muted-foreground shrink font-mono text-xs" numberOfLines={1}>
              {entity.id}
            </Text>
            {metricsTimestamp && (
              <>
                <Text className="text-muted-foreground shrink-0 font-mono text-xs">·</Text>
                <Text
                  className="text-muted-foreground shrink-0 font-mono text-xs"
                  numberOfLines={1}
                >
                  {metricsTimestamp}
                </Text>
              </>
            )}
          </View>
        </View>
        <Badge variant={headVariant} size="sm">
          {readiness.ready ? "Ready" : "Not ready"}
        </Badge>
      </View>
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
              label={positioning ? "Positioning…" : autoPosition.taskable?.label || "Auto position"}
              onPress={() => runTaskable(autoPosition.id)}
              disabled={positioning}
              loading={positioning}
              fullWidth
            />
          )}
          {!placed && (
            <ControlButton icon={MapPin} label="Place on map" onPress={onPlace} fullWidth />
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
  );
}

type Row =
  | {
      kind: "header";
      group: "notReady" | "ready";
      key: string;
      label: string;
      count: number;
      open: boolean;
    }
  | { kind: "asset"; key: string; entry: AssetEntry };

function HeaderRow({
  label,
  count,
  open,
  isHighlighted,
  onPress,
  rowRef,
}: {
  label: string;
  count: number;
  open: boolean;
  isHighlighted: boolean;
  onPress: () => void;
  rowRef?: React.Ref<View>;
}) {
  const t = useThemeColors();
  return (
    <Pressable
      ref={rowRef}
      onPress={onPress}
      tabIndex={-1}
      className={cn(
        "min-h-11 flex-row items-center gap-1.5 pr-4 pl-3 outline-none",
        isHighlighted ? "bg-glass-hover" : "hover:bg-glass active:bg-glass-hover",
      )}
    >
      <View className="w-10 items-center">
        <View style={{ transform: [{ rotate: open ? "90deg" : "0deg" }] }}>
          <ChevronRight size={10} strokeWidth={2} color={t.iconSubtle} />
        </View>
      </View>
      <Text className="text-muted-foreground font-sans-semibold flex-1 text-xs tracking-wider uppercase">
        {label}
      </Text>
      <Text className="text-muted-foreground font-mono text-xs">{count}</Text>
    </Pressable>
  );
}

function AssetRow({
  entry,
  isSelected,
  isHighlighted,
  onPress,
  rowRef,
}: {
  entry: AssetEntry;
  isSelected: boolean;
  isHighlighted: boolean;
  onPress: () => void;
  rowRef?: React.Ref<View>;
}) {
  const blocker = worstBlocker(entry.readiness);
  const variant: BadgeVariant = blocker ? READINESS_VISUAL[blocker.status].variant : "success";
  const label = blocker ? gateValue(entry.entity, blocker) : "Ready";
  return (
    <Pressable
      ref={rowRef}
      onPress={onPress}
      tabIndex={-1}
      className={cn(
        "min-h-11 flex-row items-center pl-3 outline-none",
        isHighlighted
          ? "bg-glass-hover"
          : isSelected
            ? "bg-glass"
            : "hover:bg-glass active:bg-glass-hover",
      )}
    >
      <View className="w-10" />
      <View className="flex-1 flex-row items-center gap-2 py-1.5 pr-3">
        <Text
          className={cn(
            "min-w-0 flex-1 font-sans text-sm",
            isSelected || isHighlighted ? "text-foreground" : "text-foreground/70",
          )}
          numberOfLines={1}
        >
          {getEntityName(entry.entity)}
        </Text>
        <Badge variant={variant} size="sm">
          {label}
        </Badge>
      </View>
    </Pressable>
  );
}

function AssetSidebar({
  notReady,
  ready,
  selectedId,
  onSelect,
}: {
  notReady: AssetEntry[];
  ready: AssetEntry[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  // also open Ready when the selection lives there, or it would be hidden in a
  // collapsed group.
  const [open, setOpen] = useState(() => ({
    notReady: true,
    ready: notReady.length === 0 || ready.some((e) => e.entity.id === selectedId),
  }));

  const rows = useMemo<Row[]>(() => {
    const out: Row[] = [];
    if (notReady.length > 0) {
      out.push({
        kind: "header",
        group: "notReady",
        key: "header:not-ready",
        label: "Not ready",
        count: notReady.length,
        open: open.notReady,
      });
      if (open.notReady)
        for (const entry of notReady) out.push({ kind: "asset", key: entry.entity.id, entry });
    }
    if (ready.length > 0) {
      out.push({
        kind: "header",
        group: "ready",
        key: "header:ready",
        label: "Ready",
        count: ready.length,
        open: open.ready,
      });
      if (open.ready)
        for (const entry of ready) out.push({ kind: "asset", key: entry.entity.id, entry });
    }
    return out;
  }, [notReady, ready, open]);

  const { setHighlightedKey, highlightedIndex, setHighlightedEl } = useKeyedListNav({
    rows,
    initialKey: selectedId,
  });

  const toggle = useCallback(
    (group: "notReady" | "ready") => setOpen((o) => ({ ...o, [group]: !o[group] })),
    [],
  );

  useKeyboardShortcut(
    "Enter",
    useCallback(() => {
      const row = rows[highlightedIndex];
      if (!row) return false;
      if (row.kind === "header") toggle(row.group);
      else onSelect(row.entry.entity.id);
      return true;
    }, [highlightedIndex, rows, onSelect, toggle]),
    { priority: 200 },
  );

  return (
    <ScrollView className="flex-1 select-none" showsVerticalScrollIndicator={false}>
      {rows.map((row, index) => {
        const ref = index === highlightedIndex ? setHighlightedEl : undefined;
        if (row.kind === "header") {
          return (
            <HeaderRow
              key={row.key}
              label={row.label}
              count={row.count}
              open={row.open}
              isHighlighted={index === highlightedIndex}
              onPress={() => {
                setHighlightedKey(row.key);
                toggle(row.group);
              }}
              rowRef={ref}
            />
          );
        }
        return (
          <AssetRow
            key={row.key}
            entry={row.entry}
            isSelected={selectedId === row.entry.entity.id}
            isHighlighted={index === highlightedIndex}
            onPress={() => {
              setHighlightedKey(row.key);
              onSelect(row.entry.entity.id);
            }}
            rowRef={ref}
          />
        );
      })}
    </ScrollView>
  );
}

function DetailPlaceholder() {
  const t = useThemeColors();
  return (
    <View className="flex-1 items-center justify-center gap-3 px-6">
      <Radio size={32} strokeWidth={1} color={t.iconMuted} />
      <Text className="text-muted-foreground text-center font-sans text-sm">
        Select an asset to see what it needs
      </Text>
    </View>
  );
}

export function AssetReadinessView({
  dispatch,
  query,
  isWide,
  treeOpen,
  onTreeOpenChange,
  selectedId,
  onSelect,
}: {
  dispatch: Dispatch<PaletteAction>;
  query: string;
  isWide: boolean;
  treeOpen: boolean;
  onTreeOpenChange: (open: boolean) => void;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const t = useThemeColors();
  const placement = usePlacement();
  const assets = useAssets();

  const { entries, notReady, ready, fallbackId } = useMemo(() => {
    const byName = (a: AssetEntry, b: AssetEntry) =>
      getEntityName(a.entity).localeCompare(getEntityName(b.entity));
    const entries: AssetEntry[] = filterAssets(assets, query).map((entity) => ({
      entity,
      readiness: deriveAssetReadiness(entity),
    }));
    const notReady = entries.filter((e) => !e.readiness.ready).sort(byName);
    const ready = entries.filter((e) => e.readiness.ready).sort(byName);
    return { entries, notReady, ready, fallbackId: (notReady[0] ?? entries[0])?.entity.id ?? null };
  }, [assets, query]);

  const detailId =
    selectedId && entries.some((e) => e.entity.id === selectedId)
      ? selectedId
      : isWide
        ? fallbackId
        : null;
  const detailEntry = detailId ? (entries.find((e) => e.entity.id === detailId) ?? null) : null;

  const closeTree = useCallback(() => onTreeOpenChange(false), [onTreeOpenChange]);

  const selectAsset = useCallback(
    (id: string) => {
      onSelect(id);
      if (!isWide) onTreeOpenChange(false);
    },
    [isWide, onSelect, onTreeOpenChange],
  );

  if (assets.length === 0) {
    return (
      <View className="flex-1 items-center justify-center gap-3 px-6">
        <Radio size={32} strokeWidth={1} color={t.iconMuted} />
        <Text className="text-muted-foreground text-center font-sans text-sm">No assets</Text>
      </View>
    );
  }

  const sidebar = (
    <AssetSidebar notReady={notReady} ready={ready} selectedId={detailId} onSelect={selectAsset} />
  );

  const detail = detailEntry ? (
    <AssetDetail
      entity={detailEntry.entity}
      readiness={detailEntry.readiness}
      dispatch={dispatch}
      onPlace={() => placement.enterPlacement(detailEntry.entity)}
    />
  ) : (
    <DetailPlaceholder />
  );

  return (
    <ListDetailShell
      isWide={isWide}
      treeOpen={treeOpen}
      onTreeClose={closeTree}
      closeLabel="Close asset list"
      sidebar={sidebar}
    >
      {detail}
    </ListDetailShell>
  );
}
