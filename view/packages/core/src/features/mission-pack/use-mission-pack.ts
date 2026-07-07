import type { LayoutNode } from "@hydris/ui/layout/types";
import { useCallback, useMemo } from "react";
import { Platform } from "react-native";

import { baseUrl, worldClient } from "../../lib/api/world-client";
import { downloadFromEndpoint } from "../../lib/download";
import { toast } from "../../lib/sonner";
import type { PickedFile } from "../../lib/use-file-picker";
import { layoutApplyMissionKitRef, layoutSnapshotRef } from "../aware/hooks/layout-snapshot";
import { PRESETS } from "../aware/layouts";
import { useMissionKitStore } from "../aware/store/mission-kit-store";
import { useMissionHealthStore } from "./mission-health-store";
import { startUploadArtifact } from "./upload-artifact";

export type MissionExportOptions = {
  includeMissionKit: boolean;
  withArtifacts: boolean;
  withPolicy: boolean;
};

export async function captureCurrentLayout(): Promise<void> {
  const snap = layoutSnapshotRef.current;
  const store = useMissionKitStore.getState();
  if (!store.nodeId) {
    await store.fetch();
  }

  const updates: Record<string, { name: string; tree: LayoutNode }> = {};
  for (const [presetId, tree] of Object.entries(snap.customTrees)) {
    const preset = PRESETS.find((p) => p.id === presetId);
    if (!preset) continue;
    updates[presetId] = { name: preset.name, tree };
  }
  if (Object.keys(updates).length === 0) return;
  await useMissionKitStore.getState().saveMany(updates);
}

function pickedFileName(picked: PickedFile): string {
  return picked.kind === "web" ? picked.file.name : picked.name;
}

export function useMissionPack() {
  const importPack = useCallback(async (picked: PickedFile) => {
    const name = pickedFileName(picked).toLowerCase();
    if (!name.endsWith(".zip")) {
      toast.error("Not a mission pack (.zip expected)");
      return;
    }

    const artifactId = `mission.import.${Date.now()}`;
    const controller = new AbortController();
    const upload = startUploadArtifact(picked, {
      id: artifactId,
      contentType: "application/zip",
      signal: controller.signal,
    });

    const toastId = toast.loading("Uploading…", {
      action: {
        label: "Cancel",
        onClick: () => {
          controller.abort();
          upload.cancel();
        },
      },
    });

    try {
      await upload.promise;

      toast.loading("Loading mission…", { id: toastId, action: undefined });
      const result = await worldClient.loadMission({ artifactId });
      if (result.error) {
        toast.error(`Load failed: ${result.error}`, { id: toastId });
        return;
      }
      await useMissionHealthStore.getState().fetch();
      await useMissionKitStore.getState().fetch();
      layoutApplyMissionKitRef.current?.();
      toast.success("Mission loaded", { id: toastId });
    } catch (err) {
      console.error("[mission-pack] import failed", err);
      if (controller.signal.aborted) {
        toast.error("Cancelled", { id: toastId });
      } else {
        toast.error(err instanceof Error ? err.message : "Import failed", { id: toastId });
      }
    }
  }, []);

  const exportPack = useCallback(async (opts: MissionExportOptions): Promise<boolean> => {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    try {
      if (opts.includeMissionKit) {
        await captureCurrentLayout();
      }
      await downloadFromEndpoint({
        url: `${baseUrl}/mission/export`,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          include_mission_kit: opts.includeMissionKit,
          with_artifacts: opts.withArtifacts,
          with_policy: opts.withPolicy,
        }),
        fallbackFilename: `hydris-mission-${stamp}.zip`,
        parentFolder: "Hydris-Missions",
        mimeType: "application/zip",
      });
      if (Platform.OS !== "web") {
        toast.info("Saved to Downloads/Hydris-Missions");
      }
      return true;
    } catch (err) {
      console.error("[mission-pack] export failed", err);
      toast.error(err instanceof Error ? err.message : "Export failed");
      return false;
    }
  }, []);

  return useMemo(() => ({ importPack, exportPack }), [importPack, exportPack]);
}
