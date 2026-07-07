"use no memo";

import { ControlButton, ToggleSwitch } from "@hydris/ui/controls";
import { Tag } from "@hydris/ui/tag";
import { useCallback, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";

import { useMissionPack } from "../../../../mission-pack/use-mission-pack";

function ToggleRow({
  label,
  description,
  value,
  onValueChange,
}: {
  label: string;
  description: string;
  value: boolean;
  onValueChange: (value: boolean) => void;
}) {
  return (
    <View className="flex-row items-center gap-3 py-3">
      <Pressable className="flex-1 gap-0.5" onPress={() => onValueChange(!value)}>
        <Text className="text-foreground font-sans-medium text-sm">{label}</Text>
        <Text className="text-muted-foreground font-mono text-xs">{description}</Text>
      </Pressable>
      <ToggleSwitch value={value} onValueChange={onValueChange} accessibilityLabel={label} />
    </View>
  );
}

export function MissionExportView({ onClose }: { onClose: () => void }) {
  const { exportPack } = useMissionPack();
  const [includeMissionKit, setIncludeMissionKit] = useState(true);
  const [withArtifacts, setWithArtifacts] = useState(true);
  const [withPolicy, setWithPolicy] = useState(true);
  const [exporting, setExporting] = useState(false);

  const handleExport = useCallback(async () => {
    setExporting(true);
    try {
      if (await exportPack({ includeMissionKit, withArtifacts, withPolicy })) {
        onClose();
      }
    } finally {
      setExporting(false);
    }
  }, [exportPack, includeMissionKit, withArtifacts, withPolicy, onClose]);

  return (
    <ScrollView className="flex-1" contentContainerClassName="px-4 py-2">
      <Text className="text-muted-foreground py-3 font-mono text-xs">
        Builds a mission pack (.zip) from this node's current world. Entities are always included.
        Choose what else goes in.
      </Text>

      <View>
        <View className="flex-row items-center gap-3 py-3">
          <View className="flex-1 gap-0.5">
            <Text className="text-foreground font-sans-medium text-sm">World entities</Text>
            <Text className="text-muted-foreground font-mono text-xs">
              Devices, shapes, missions, and the rest of the world
            </Text>
          </View>
          <Tag>Always</Tag>
        </View>

        <View className="bg-surface-overlay/6 h-px" />
        <ToggleRow
          label="Layouts"
          description="Your saved dashboard layouts"
          value={includeMissionKit}
          onValueChange={setIncludeMissionKit}
        />

        <View className="bg-surface-overlay/6 h-px" />
        <ToggleRow
          label="Media & files"
          description="Camera snapshots and other attached files"
          value={withArtifacts}
          onValueChange={setWithArtifacts}
        />

        <View className="bg-surface-overlay/6 h-px" />
        <ToggleRow
          label="Access policy"
          description="Rules for who can connect and make changes"
          value={withPolicy}
          onValueChange={setWithPolicy}
        />
      </View>

      <ControlButton
        onPress={handleExport}
        label={exporting ? "Exporting…" : "Export mission pack"}
        variant={!exporting ? "success" : "default"}
        disabled={exporting}
        loading={exporting}
        size="lg"
        fullWidth
        labelClassName="font-mono text-xs font-semibold uppercase"
        className="mt-3"
      />
    </ScrollView>
  );
}
