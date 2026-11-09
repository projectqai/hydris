"use no memo";

import type { JsonObject } from "@bufbuild/protobuf";
import { ControlButton } from "@hydris/ui/controls";
import { useThemeColors } from "@hydris/ui/lib/theme";
import { formatMinutesSeconds } from "@hydris/ui/lib/utils";
import { RadioGroup, RadioGroupItem } from "@hydris/ui/radio-group";
import { ScrollShadow } from "@hydris/ui/scroll-shadow";
import { SegmentedControl } from "@hydris/ui/segmented-control";
import type { DeviceClassOption, Entity } from "@projectqai/proto/world";
import { MapPin, Plus, Server, Timer, Trash2, X } from "lucide-react-native";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { ScrollView, Text, View } from "react-native";

import { useEntityMutation } from "../../../../lib/api/use-entity-mutation";
import {
  getConfigurableLabel,
  getDeviceName,
  getEntityName,
  isRepositionable,
} from "../../../../lib/api/use-track-utils";
import { toast } from "../../../../lib/sonner";
import { useNowUntil } from "../../../../lib/use-now-until";
import { useOwnState } from "../../../mission/use-mission-state";
import { useConfigHandshake } from "../../hooks/use-config-handshake";
import { useEntityDelete } from "../../hooks/use-entity-delete";
import { useOwnTaskables } from "../../hooks/use-entity-taskables";
import { usePlacement } from "../../placement-context";
import { useEntityStore } from "../../store/entity-store";
import { formatRelativeTime, getSharedTimestamp } from "../../utils/format-metrics";
import { ActionsSection } from "../entity-details/actions-section";
import { EntityHeader } from "../entity-header";
import { ErrorNotice } from "../error-notice";
import { hasSchemaFields, SchemaForm } from "../schema-form";
import { WaitingForApply } from "../waiting-for-apply";
import type { DataTab } from "./data-tabs";
import { DataTabContent, getDataTabs } from "./data-tabs";
import type { ConfigSelection } from "./use-config-tree";

export const NO_SCHEMA = "No schema available for this configuration";

export function FormScroll({
  contentContainerClassName,
  children,
}: {
  contentContainerClassName?: string;
  children: ReactNode;
}) {
  return (
    <ScrollShadow size="sm" className="flex-1">
      <ScrollView
        className="flex-1"
        contentContainerClassName={contentContainerClassName}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {children}
      </ScrollView>
    </ScrollShadow>
  );
}

function useCooldownRemaining(until: number | undefined): string | null {
  const now = useNowUntil(until);
  const remaining = until ? Math.max(0, Math.ceil((until - now) / 1000)) : 0;

  if (!until || remaining <= 0) return null;

  return formatMinutesSeconds(remaining);
}

export function ConfigurableSection({ entity }: { entity: Entity }) {
  const taskables = useOwnTaskables(entity.id);

  return (
    <>
      <ActionsSection entityId={entity.id} taskables={taskables} className="px-4 pt-2" />
      <ConfigurableForm entity={entity} />
    </>
  );
}

function ConfigurableForm({ entity }: { entity: Entity }) {
  const { pushDeviceConfig, removeDeviceConfig, isPending } = useEntityMutation();
  const liveEntity = useEntityStore((s) => s.entities.get(entity.id));
  const configurable = liveEntity?.configurable;
  const handshake = useConfigHandshake(configurable);
  const cooldownUntil =
    typeof configurable?.value?.cooldownUntil === "number"
      ? configurable.value.cooldownUntil
      : undefined;
  const cooldownLabel = useCooldownRemaining(cooldownUntil);

  if (!configurable?.schema || !hasSchemaFields(configurable.schema)) {
    return (
      <View className="items-center justify-center gap-2 px-4 py-6">
        <Text className="text-muted-foreground font-sans text-sm">{NO_SCHEMA}</Text>
      </View>
    );
  }

  const configValue = liveEntity?.config?.value ?? configurable.value;
  const awaitingHandshake = handshake.awaiting;
  const isCooldownActive = configurable.value?.cooldown === true;
  const isOrphaned = !liveEntity?.device;

  const handleSubmit = async (value: JsonObject) => {
    if (!liveEntity || isOrphaned) return false;

    return handshake.push(() => pushDeviceConfig(liveEntity, value));
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
      <SchemaForm
        schema={configurable.schema}
        value={configValue}
        onSubmit={handleSubmit}
        onRemove={handleRemove}
        isPending={isPending || awaitingHandshake}
        isConfigured={!!liveEntity?.config}
        disabled={isOrphaned}
        extraActions={
          isCooldownActive ? (
            <ControlButton
              onPress={() => handleSubmit({ ...((configValue ?? {}) as object), cooldown: false })}
              icon={Timer}
              label={cooldownLabel ? `Abort cooldown (${cooldownLabel})` : "Abort cooldown"}
              hoverVariant="destructive"
              disabled={isPending || awaitingHandshake || isOrphaned}
              loading={isPending || awaitingHandshake}
              size="lg"
              fullWidth
              labelClassName="font-mono text-xs font-semibold uppercase"
              className="mt-3"
              accessibilityLabel="Abort cooldown"
            />
          ) : undefined
        }
        submitStatus={
          <WaitingForApply
            overdue={handshake.overdue}
            configurable={configurable}
            className="mt-3 justify-center"
          />
        }
      />
    </View>
  );
}

function ConfigEntityHeader({
  entity,
  classLabel,
  isAddMode,
  onAddPress,
  onDeletePress,
  onPositionPress,
  metricsTimestamp,
}: {
  entity: Entity;
  classLabel?: string;
  isAddMode?: boolean;
  onAddPress?: () => void;
  onDeletePress?: () => void;
  onPositionPress?: () => void;
  metricsTimestamp?: string;
}) {
  const name = classLabel ? getDeviceName(entity) : getEntityName(entity);
  const subtitle = classLabel && classLabel !== name ? classLabel : entity.id;
  const AddIcon = isAddMode ? X : Plus;
  const own = useOwnState(entity);

  return (
    <>
      <EntityHeader
        entity={entity}
        title={name}
        subtitle={subtitle}
        timestamp={metricsTimestamp}
        className="px-5 py-4"
      >
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
      </EntityHeader>

      {own.error && <ErrorNotice className="mx-5 mb-2">{`${own.label}: ${own.error}`}</ErrorNotice>}
    </>
  );
}

export function AddDeviceView({
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
      toast.success(`Created ${opt.label || opt.class}`);
      onCreated(newId);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create device");
    }
  };

  const selectedOpt = options.find((o) => o.class === selected) ?? options[0]!;
  const selectedLabel = selectedOpt.label || selectedOpt.class;

  return (
    <View className="gap-3 px-4 py-4">
      <Text className="text-muted-foreground font-sans text-sm">Add device to {parentName}</Text>

      {options.length > 1 ? (
        <RadioGroup value={selected} onValueChange={setSelected} accessibilityLabel="Device class">
          {options.map((o) => (
            <RadioGroupItem key={o.class} value={o.class}>
              {o.label || o.class}
            </RadioGroupItem>
          ))}
        </RadioGroup>
      ) : (
        <Text className="font-sans-medium text-foreground text-sm">{selectedLabel}</Text>
      )}

      {selectedOpt.description ? (
        <Text className="text-muted-foreground font-sans text-xs">{selectedOpt.description}</Text>
      ) : null}

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
  onCreated,
  defaultAddMode = false,
}: {
  selection: ConfigSelection;
  onCreated?: (entityId: string) => void;
  defaultAddMode?: boolean;
}) {
  const t = useThemeColors();
  const entityId = selection?.entityId ?? null;
  const entity = useEntityStore((s) => (entityId ? s.entities.get(entityId) : undefined));
  const { enterPlacement, canPlace } = usePlacement();
  const [isAddMode, setIsAddMode] = useState(defaultAddMode);
  const [panelTab, setPanelTab] = useState<"config" | DataTab>("config");
  const { request: requestDelete, dialog: deleteDialog } = useEntityDelete();

  // exit add mode when selection changes
  const prevEntityId = useRef(entityId);
  useEffect(() => {
    if (entityId !== prevEntityId.current) {
      setIsAddMode(false);
      prevEntityId.current = entityId;
    }
  }, [entityId]);

  const isChildDevice = !!entity?.device?.parent;
  const handleDeletePress =
    isChildDevice && entity ? () => requestDelete(entity, "Delete device") : undefined;

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
  const cfgLabel = getConfigurableLabel(entity);
  const hasSchema =
    entity.configurable?.schema && Object.keys(entity.configurable.schema).length > 0;
  const metrics = entity.metric?.metrics ?? [];
  const sharedTs = getSharedTimestamp(metrics);
  const metricsTimestamp = sharedTs ? formatRelativeTime(sharedTs) : undefined;

  const handleAddPress = () => setIsAddMode((v) => !v);

  const handleCreated = (newId: string) => {
    setIsAddMode(false);
    onCreated?.(newId);
  };

  const showAddMode = isAddMode && deviceClasses.length > 0;

  const tabs = [
    ...(hasSchema ? [{ id: "config" as const, label: "Config" }] : []),
    ...getDataTabs(entity),
  ];

  const activeTab = tabs.some((t) => t.id === panelTab) ? panelTab : (tabs[0]?.id ?? "config");

  const renderTabContent = () =>
    activeTab === "config" ? (
      <ConfigurableSection key={entity.id} entity={entity} />
    ) : (
      <DataTabContent tab={activeTab} entity={entity} sharedTimestamp={sharedTs} />
    );

  const header = (
    <View key="header">
      <ConfigEntityHeader
        entity={entity}
        classLabel={hasSchema ? cfgLabel : undefined}
        isAddMode={isAddMode}
        onAddPress={deviceClasses.length > 0 ? handleAddPress : undefined}
        onDeletePress={handleDeletePress}
        onPositionPress={
          isRepositionable(entity) && canPlace ? () => enterPlacement(entity) : undefined
        }
        metricsTimestamp={metricsTimestamp}
      />
      <View className="bg-surface-overlay/6 h-px" />
    </View>
  );

  let scrollChildren: ReactNode[];

  if (showAddMode) {
    scrollChildren = [
      header,
      <AddDeviceView
        key="body"
        parentName={entityName}
        parentId={entity.id}
        options={deviceClasses}
        onCreated={handleCreated}
      />,
    ];
  } else if (tabs.length === 0) {
    scrollChildren = [
      header,
      <View key="body" className="items-center justify-center gap-2 px-4 py-8">
        <Text className="text-muted-foreground font-sans text-sm">
          Select a configurable from the sidebar
        </Text>
      </View>,
    ];
  } else if (tabs.length === 1) {
    scrollChildren = [header, <View key="body">{renderTabContent()}</View>];
  } else {
    scrollChildren = [
      header,
      <SegmentedControl key="tabs" tabs={tabs} activeTab={activeTab} onTabChange={setPanelTab} />,
      <View key="body">{renderTabContent()}</View>,
    ];
  }

  return (
    <View className="flex-1">
      <FormScroll>{scrollChildren}</FormScroll>
      {deleteDialog}
    </View>
  );
}
