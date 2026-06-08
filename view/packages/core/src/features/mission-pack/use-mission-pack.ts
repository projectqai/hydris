import { create as createProto } from "@bufbuild/protobuf";
import type { LayoutNode } from "@hydris/ui/layout/types";
import { ArtifactComponentSchema, EntitySchema } from "@projectqai/proto/world";
import { useCallback, useMemo } from "react";
import { Platform } from "react-native";
import ReactNativeBlobUtil from "react-native-blob-util";

import { baseUrl, worldClient } from "../../lib/api/world-client";
import { downloadFromEndpoint } from "../../lib/download";
import { toast } from "../../lib/sonner";
import type { PickedFile } from "../../lib/use-file-picker";
import { layoutApplyMissionKitRef, layoutSnapshotRef } from "../aware/hooks/layout-snapshot";
import { PRESETS } from "../aware/layouts";
import { useMissionKitStore } from "../aware/store/mission-kit-store";
import { useMissionHealthStore } from "./mission-health-store";

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
    const url = `${baseUrl}/artifacts/${encodeURIComponent(artifactId)}`;
    const controller = new AbortController();
    let nativeTask: { cancel: () => void } | null = null;

    const toastId = toast.loading("Uploading…", {
      action: {
        label: "Cancel",
        onClick: () => {
          controller.abort();
          nativeTask?.cancel();
        },
      },
    });

    try {
      await worldClient.push({
        changes: [
          createProto(EntitySchema, {
            id: artifactId,
            artifact: createProto(ArtifactComponentSchema, {
              id: artifactId,
              contentType: "application/zip",
            }),
          }),
        ],
      });

      if (picked.kind === "web") {
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/zip" },
          body: picked.file,
          signal: controller.signal,
        });
        if (!res.ok) throw new Error((await res.text()).trim() || `HTTP ${res.status}`);
      } else {
        const task = ReactNativeBlobUtil.fetch(
          "POST",
          url,
          { "Content-Type": "application/zip" },
          ReactNativeBlobUtil.wrap(picked.uri),
        );
        nativeTask = task;
        const res = await task;
        const status = res.respInfo.status;
        if (status < 200 || status >= 300) {
          throw new Error((await res.text()).trim() || `HTTP ${status}`);
        }
      }

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

  const exportPack = useCallback(async () => {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    try {
      await captureCurrentLayout();
      await downloadFromEndpoint({
        url: `${baseUrl}/mission/export`,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ include_mission_kit: true }),
        fallbackFilename: `hydris-mission-${stamp}.zip`,
        parentFolder: "Hydris-Missions",
        mimeType: "application/zip",
      });
      if (Platform.OS !== "web") {
        toast.info("Saved to Downloads/Hydris-Missions");
      }
    } catch (err) {
      console.error("[mission-pack] export failed", err);
      toast.error(err instanceof Error ? err.message : "Export failed");
    }
  }, []);

  return useMemo(() => ({ importPack, exportPack }), [importPack, exportPack]);
}
