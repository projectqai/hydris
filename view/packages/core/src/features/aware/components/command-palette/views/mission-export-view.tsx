"use no memo";

import { ControlButton, ToggleSwitch } from "@hydris/ui/controls";
import { Field, FieldContent, FieldDescription, FieldLabel, FieldTitle } from "@hydris/ui/field";
import { ScrollShadow } from "@hydris/ui/scroll-shadow";
import { Tag } from "@hydris/ui/tag";
import { useCallback, useState } from "react";
import { ScrollView, Text, View } from "react-native";

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
    <FieldLabel className="py-3">
      <Field orientation="horizontal">
        <FieldContent>
          <FieldTitle>{label}</FieldTitle>
          <FieldDescription>{description}</FieldDescription>
        </FieldContent>
        <ToggleSwitch value={value} onValueChange={onValueChange} accessibilityLabel={label} />
      </Field>
    </FieldLabel>
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
    <ScrollShadow size="sm" className="flex-1">
      <ScrollView className="flex-1" contentContainerClassName="px-4 py-2">
        <Text className="text-muted-foreground py-3 font-mono text-xs">
          Builds a mission pack (.zip) from this node's current world. Entities are always included.
          Choose what else goes in.
        </Text>

        <View>
          <Field orientation="horizontal" className="py-3">
            <FieldContent>
              <FieldTitle>World entities</FieldTitle>
              <FieldDescription>
                Devices, shapes, missions, and the rest of the world
              </FieldDescription>
            </FieldContent>
            <Tag>Always</Tag>
          </Field>

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
    </ScrollShadow>
  );
}
