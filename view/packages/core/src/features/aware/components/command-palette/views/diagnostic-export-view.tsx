"use no memo";

import { ControlButton, ControlInput } from "@hydris/ui/controls";
import { useCallback, useState } from "react";
import { Platform, ScrollView, Text, View } from "react-native";

import { baseUrl } from "../../../../../lib/api/world-client";
import { downloadFromEndpoint } from "../../../../../lib/download";
import { toast } from "../../../../../lib/sonner";

function FieldRow({ label, description }: { label: string; description?: string }) {
  return (
    <View className="gap-0.5 py-2">
      <Text className="text-foreground font-sans-medium text-sm">{label}</Text>
      {description && (
        <Text className="text-muted-foreground font-mono text-xs">{description}</Text>
      )}
    </View>
  );
}

export function DiagnosticExportView({ onClose }: { onClose: () => void }) {
  const [note, setNote] = useState("");
  const [exporting, setExporting] = useState(false);

  const handleExport = useCallback(async () => {
    setExporting(true);
    try {
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      await downloadFromEndpoint({
        url: `${baseUrl}/diagnostic/export`,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_note: note || undefined }),
        fallbackFilename: `hydris-diagnostic-${stamp}.zip`,
        parentFolder: "Hydris-Diagnostics",
        mimeType: "application/zip",
      });
      toast.info(
        Platform.OS === "web" ? "Sent to downloads" : "Saved to Downloads/Hydris-Diagnostics",
      );
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Export failed");
    } finally {
      setExporting(false);
    }
  }, [note, onClose]);

  return (
    <ScrollView className="flex-1" contentContainerClassName="px-4 py-2">
      <Text className="text-muted-foreground py-3 font-mono text-xs">
        This will download a diagnostic bundle containing the following data from this node.
      </Text>
      <View>
        <FieldRow label="World state" description="All entities in the current world" />
        <View className="bg-surface-overlay/6 h-px" />
        <FieldRow label="Engine logs" description="Recent log output from this session" />
        <View className="bg-surface-overlay/6 h-px" />
        <FieldRow label="System info" description="Hostname, OS, version, uptime" />
      </View>

      <View className="mt-5 gap-1.5">
        <View className="gap-0.5">
          <Text className="text-foreground font-sans-medium text-sm">Description</Text>
          <Text className="text-muted-foreground font-mono text-xs">What happened? (optional)</Text>
        </View>
        <ControlInput
          value={note}
          onChangeText={setNote}
          placeholder="e.g. map tiles not loading after restart"
          multiline
          textAlignVertical="top"
          className="min-h-20 p-3 text-xs"
        />
      </View>

      <ControlButton
        onPress={handleExport}
        label={exporting ? "Exporting…" : "Export diagnostic"}
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
