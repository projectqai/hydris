"use no memo";

import type { JsonObject } from "@bufbuild/protobuf";
import { ControlButton, ControlSelect } from "@hydris/ui/controls";
import { useThemeColors } from "@hydris/ui/lib/theme";
import { SegmentedControl } from "@hydris/ui/segmented-control";
import type { DeviceClassOption, Entity } from "@projectqai/proto/world";
import { ConfigurableState } from "@projectqai/proto/world";
import { AlertTriangle, MapPin, Plus, Server, Timer, Trash2, X } from "lucide-react-native";
import { useEffect, useRef, useState } from "react";
import { Alert, Platform, ScrollView, Text, View } from "react-native";

import { useEntityMutation } from "../../../../lib/api/use-entity-mutation";
import { getEntityName } from "../../../../lib/api/use-track-utils";
import { toast } from "../../../../lib/sonner";
import { usePlacement } from "../../placement-context";
import { useEntityStore } from "../../store/entity-store";
import { getEntityIcon } from "../../utils/entity-helpers";
import { formatRelativeTime, getSharedTimestamp } from "../../utils/format-metrics";
import { SchemaForm } from "../schema-form";
import { MetricsSection } from "./metrics-section";
import { StatusSection } from "./status-section";
import type { ConfigSelection } from "./use-config-tree";

const HANDSHAKE_TIMEOUT_MS = 30_000;

function useCooldownRemaining(until: number | undefined): string | null {
  const [remaining, setRemaining] = useState(() =>
    until ? Math.max(0, Math.ceil((until - Date.now()) / 1000)) : 0,
  );

  useEffect(() => {
    if (!until) return;
    const tick = () => setRemaining(Math.max(0, Math.ceil((until - Date.now()) / 1000)));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [until]);

  if (!until || remaining <= 0) return null;
  const m = Math.floor(remaining / 60);
  const s = remaining % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function ConfigurableSection({ entity }: { entity: Entity }) {
  const { pushDeviceConfig, removeDeviceConfig, isPending } = useEntityMutation();
  const liveEntity = useEntityStore((s) => s.entities.get(entity.id));
  const [sentVersion, setSentVersion] = useState<bigint | null>(null);
  const sentVersionRef = useRef<bigint | null>(null);

  const configurable = liveEntity?.configurable;
  const cooldownUntil =
    typeof configurable?.value?.cooldownUntil === "number"
      ? configurable.value.cooldownUntil
      : undefined;
  const cooldownLabel = useCooldownRemaining(cooldownUntil);

  // watch for handshake completion
  useEffect(() => {
    if (sentVersionRef.current == null || !configurable) return;
    if (configurable.appliedVersion < sentVersionRef.current) return;

    const { state } = configurable;
    if (
      state === ConfigurableState.ConfigurableStateActive ||
      state === ConfigurableState.ConfigurableStateScheduled
    ) {
      toast.success("Config applied");
    } else if (state === ConfigurableState.ConfigurableStateFailed) {
      toast.error(configurable.error ?? "Config failed");
    }

    sentVersionRef.current = null;
    setSentVersion(null);
  }, [configurable?.appliedVersion, configurable?.state, configurable]);

  // timeout — device never responded
  useEffect(() => {
    if (sentVersion == null) return;
    const t = setTimeout(() => {
      sentVersionRef.current = null;
      setSentVersion(null);
      toast.error("Device did not respond");
    }, HANDSHAKE_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, [sentVersion]);

  if (!configurable) return null;

  const configValue = liveEntity?.config?.value ?? configurable.value;
  const awaitingHandshake = sentVersion != null;
  const isCooldownActive = configurable.value?.cooldown === true;

  const handleSubmit = async (value: JsonObject) => {
    if (!liveEntity) return;
    try {
      const { version } = await pushDeviceConfig(liveEntity, value);
      sentVersionRef.current = version;
      setSentVersion(version);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Push failed");
    }
  };

  const handleRemove = async () => {
    if (!liveEntity) return;
    try {
      await removeDeviceConfig(liveEntity);
      toast.success("Configuration removed");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Remove failed");
    }
  };

  return (
    <View className="py-2">
      {configurable.error && (
        <View
          accessibilityRole="alert"
          className="mx-4 mb-2 flex-row items-start gap-2 rounded bg-red-500/10 px-3 py-2"
        >
          <AlertTriangle size={14} strokeWidth={2} color="rgb(248,113,113)" />
          <Text className="text-red-foreground font-mono text-xs">{configurable.error}</Text>
        </View>
      )}

      {configurable.schema && Object.keys(configurable.schema).length > 0 ? (
        <SchemaForm
          schema={configurable.schema}
          value={configValue}
          onSubmit={handleSubmit}
          onRemove={handleRemove}
          isPending={isPending || awaitingHandshake}
          isConfigured={!!liveEntity?.config}
          extraActions={
            isCooldownActive ? (
              <ControlButton
                onPress={() =>
                  handleSubmit({ ...((configValue ?? {}) as object), cooldown: false })
                }
                icon={Timer}
                label={cooldownLabel ? `Abort cooldown (${cooldownLabel})` : "Abort cooldown"}
                hoverVariant="destructive"
                disabled={isPending || awaitingHandshake}
                loading={isPending || awaitingHandshake}
                size="lg"
                fullWidth
                labelClassName="font-mono text-xs font-semibold uppercase"
                className="mt-3"
                accessibilityLabel="Abort cooldown"
              />
            ) : undefined
          }
        />
      ) : (
        <View className="items-center justify-center gap-2 px-4 py-6">
          <Text className="text-muted-foreground font-sans text-sm">
            No schema available for this configuration
          </Text>
        </View>
      )}
    </View>
  );
}

function confirmDelete(name: string): Promise<boolean> {
  if (Platform.OS === "web") {
    return Promise.resolve(window.confirm(`Remove "${name}"? This cannot be undone.`));
  }
  return new Promise((resolve) => {
    Alert.alert("Delete device", `Remove "${name}"? This cannot be undone.`, [
      { text: "Cancel", style: "cancel", onPress: () => resolve(false) },
      { text: "Delete", style: "destructive", onPress: () => resolve(true) },
    ]);
  });
}

function EntityHeader({
  entity,
  title,
  isAddMode,
  onAddPress,
  onDeletePress,
  onPositionPress,
  metricsTimestamp,
}: {
  entity: Entity;
  title?: string;
  isAddMode?: boolean;
  onAddPress?: () => void;
  onDeletePress?: () => void;
  onPositionPress?: () => void;
  metricsTimestamp?: string;
}) {
  const t = useThemeColors();
  const Icon = getEntityIcon(entity);
  const entityName = getEntityName(entity);
  const subtitle = title && title !== entityName ? entityName : entity.id;
  const AddIcon = isAddMode ? X : Plus;

  return (
    <>
      <View className="px-5 py-4">
        <View className="flex-row items-center gap-3">
          <View className="bg-glass border-surface-overlay/4 size-11 items-center justify-center rounded-lg border">
            <Icon size={20} strokeWidth={2} color={t.iconDefault} />
          </View>
          <View className="flex-1 gap-0.5">
            <Text className="font-sans-semibold text-foreground text-base" numberOfLines={1}>
              {title ?? entityName}
            </Text>
            <View className="flex-row items-center gap-1.5">
              <Text className="text-muted-foreground shrink font-mono text-xs" numberOfLines={1}>
                {subtitle}
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
          {onPositionPress && (
            <ControlButton
              onPress={onPositionPress}
              icon={MapPin}
              label="Position"
              size="sm"
              accessibilityLabel="Set position on map"
            />
          )}
          {onAddPress && (
            <ControlButton
              onPress={onAddPress}
              icon={AddIcon}
              label={isAddMode ? "Cancel" : "Add"}
              hoverVariant={isAddMode ? undefined : "success"}
              size="sm"
              accessibilityLabel={isAddMode ? "Cancel" : "Add"}
            />
          )}
          {onDeletePress && (
            <ControlButton
              onPress={onDeletePress}
              icon={Trash2}
              label="Delete"
              hoverVariant="destructive"
              size="sm"
              accessibilityLabel="Delete"
            />
          )}
        </View>
      </View>

      {entity.device?.error && (
        <View
          accessibilityRole="alert"
          className="mx-5 mb-2 flex-row items-start gap-2 rounded bg-red-500/10 px-3 py-2"
        >
          <AlertTriangle size={14} strokeWidth={2} color="rgb(248,113,113)" />
          <Text className="text-red-foreground font-mono text-xs">{entity.device.error}</Text>
        </View>
      )}
    </>
  );
}

function AddDeviceView({
  parentName,
  parentId,
  options,
  onCreated,
}: {
  parentName: string;
  parentId: string;
  options: DeviceClassOption[];
  onCreated: (entityId: string) => void;
}) {
  const { createDevice, isPending } = useEntityMutation();
  const [selected, setSelected] = useState(options[0]!.class);

  const handleCreate = async () => {
    const opt = options.find((o) => o.class === selected) ?? options[0]!;
    try {
      const newId = await createDevice(parentId, opt.class);
      toast(`Created ${opt.label || opt.class}`);
      onCreated(newId);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create device");
    }
  };

  const selectedOpt = options.find((o) => o.class === selected) ?? options[0]!;
  const selectedLabel = selectedOpt.label || selectedOpt.class;
  const selectOptions = options.map((o) => ({ value: o.class, label: o.label || o.class }));

  return (
    <View className="gap-3 px-4 py-4">
      <Text className="text-muted-foreground font-sans text-sm">Add device to {parentName}</Text>

      {options.length > 1 ? (
        <ControlSelect
          value={selected}
          options={selectOptions}
          onValueChange={setSelected}
          accessibilityLabel="Device class"
        />
      ) : (
        <Text className="font-sans-medium text-foreground text-sm">{selectedLabel}</Text>
      )}

      <ControlButton
        onPress={handleCreate}
        label={`Create ${selectedLabel}`}
        disabled={isPending}
        loading={isPending}
        variant="success"
        size="lg"
        fullWidth
        labelClassName="font-mono text-xs font-semibold uppercase"
        accessibilityLabel={`Create ${selectedLabel}`}
      />
    </View>
  );
}

export function ConfigPanel({
  selection,
  onSelect,
}: {
  selection: ConfigSelection;
  onSelect?: (sel: ConfigSelection) => void;
}) {
  const t = useThemeColors();
  const entityId = selection?.entityId ?? null;
  const entity = useEntityStore((s) => (entityId ? s.entities.get(entityId) : undefined));
  const { deleteDevice } = useEntityMutation();
  const { enterPlacement, canPlace } = usePlacement();
  const [isAddMode, setIsAddMode] = useState(false);
  const [panelTab, setPanelTab] = useState<"config" | "metrics" | "status">("config");

  // exit add mode when selection changes
  const prevEntityId = useRef(entityId);
  useEffect(() => {
    if (entityId !== prevEntityId.current) {
      setIsAddMode(false);
      prevEntityId.current = entityId;
    }
  }, [entityId]);

  const isChildDevice = !!entity?.device?.parent;

  const handleDeletePress = isChildDevice
    ? async () => {
        const name = getEntityName(entity);
        const confirmed = await confirmDelete(name);
        if (!confirmed) return;
        try {
          await deleteDevice(entity.id);
          toast(`Deleted ${name}`);
        } catch (err) {
          toast.error(err instanceof Error ? err.message : "Failed to delete device");
        }
      }
    : undefined;

  if (!selection) {
    return (
      <View className="flex-1 items-center justify-center gap-3 px-6">
        <Server size={32} strokeWidth={1} color={t.iconMuted} />
        <Text className="text-muted-foreground text-center font-sans text-sm">
          Select a source to view its configuration
        </Text>
      </View>
    );
  }

  if (!entity) {
    return (
      <View className="flex-1 items-center justify-center gap-3 px-6">
        <Text className="text-muted-foreground font-sans text-sm">Entity no longer available</Text>
      </View>
    );
  }

  const deviceClasses = entity.configurable?.supportedDeviceClasses ?? [];
  const entityName = getEntityName(entity);
  const cfgLabel = entity.configurable?.label ?? entityName;
  const hasSchema =
    entity.configurable?.schema && Object.keys(entity.configurable.schema).length > 0;
  const hasMetrics = (entity.metric?.metrics.length ?? 0) > 0;
  const hasStatus = !!(entity.device || entity.power || entity.link);
  const metrics = entity.metric?.metrics ?? [];
  const sharedTs = getSharedTimestamp(metrics);
  const metricsTimestamp = sharedTs ? formatRelativeTime(sharedTs) : undefined;

  const handleAddPress = () => setIsAddMode((v) => !v);

  const handleCreated = (newId: string) => {
    setIsAddMode(false);
    onSelect?.({ type: "device", entityId: newId });
  };

  const showAddMode = isAddMode && deviceClasses.length > 0;

  const tabs = [
    ...(hasSchema ? [{ id: "config" as const, label: "Config" }] : []),
    ...(hasMetrics ? [{ id: "metrics" as const, label: "Metrics" }] : []),
    ...(hasStatus ? [{ id: "status" as const, label: "Status" }] : []),
  ];

  const activeTab = tabs.some((t) => t.id === panelTab) ? panelTab : (tabs[0]?.id ?? "config");

  const renderTabContent = () => {
    switch (activeTab) {
      case "config":
        return <ConfigurableSection key={entity.id} entity={entity} />;
      case "metrics":
        return <MetricsSection entity={entity} sharedTimestamp={sharedTs} />;
      case "status":
        return <StatusSection entity={entity} />;
    }
  };

  const renderContent = () => {
    if (showAddMode) {
      return (
        <AddDeviceView
          parentName={entityName}
          parentId={entity.id}
          options={deviceClasses}
          onCreated={handleCreated}
        />
      );
    }

    if (tabs.length === 0) {
      return (
        <View className="items-center justify-center gap-2 px-4 py-8">
          <Text className="text-muted-foreground font-sans text-sm">
            Select a configurable from the sidebar
          </Text>
        </View>
      );
    }

    if (tabs.length === 1) {
      return (
        <ScrollView className="flex-1" showsVerticalScrollIndicator={false}>
          {renderTabContent()}
        </ScrollView>
      );
    }

    return (
      <View className="flex-1">
        <SegmentedControl tabs={tabs} activeTab={activeTab} onTabChange={setPanelTab} />
        <ScrollView className="flex-1" showsVerticalScrollIndicator={false}>
          {renderTabContent()}
        </ScrollView>
      </View>
    );
  };

  return (
    <View className="flex-1">
      <EntityHeader
        entity={entity}
        title={hasSchema ? cfgLabel : undefined}
        isAddMode={isAddMode}
        onAddPress={deviceClasses.length > 0 ? handleAddPress : undefined}
        onDeletePress={handleDeletePress}
        onPositionPress={entity.symbol && canPlace ? () => enterPlacement(entity) : undefined}
        metricsTimestamp={metricsTimestamp}
      />
      <View className="bg-surface-overlay/6 h-px" />
      {renderContent()}
    </View>
  );
}
