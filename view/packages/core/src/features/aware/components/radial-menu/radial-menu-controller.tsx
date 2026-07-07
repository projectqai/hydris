"use no memo";

import { create } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import { generateSymbol } from "@hydris/map-engine/utils/symbol-atlas";
import { RadialMenu } from "@hydris/ui/radial-menu";
import { PlanarPointSchema } from "@projectqai/proto/geometry";
import {
  TaskExecutionTargetEntitySchema,
  TaskExecutionTargetSchema,
} from "@projectqai/proto/tasking";
import { useCallback, useContext, useEffect, useMemo } from "react";
import { Platform } from "react-native";

import { useRunTask } from "../../../../lib/api/use-run-task";
import { getEntityName } from "../../../../lib/api/use-track-utils";
import { toast } from "../../../../lib/sonner";
import { useEntityDelete } from "../../hooks/use-entity-delete";
import { useEntityTaskables, usePositionTaskables } from "../../hooks/use-entity-taskables";
import { PaletteContext } from "../../palette-context";
import { usePlacement } from "../../placement-context";
import { useEntityStore } from "../../store/entity-store";
import { mapEngineActions } from "../../store/map-engine-store";
import { useRadialMenuStore } from "../../store/radial-menu-store";
import { useSelectionStore } from "../../store/selection-store";
import { resolvePositionItems, resolveRadialItems } from "./resolve-items";

export function RadialMenuController() {
  const open = useRadialMenuStore((s) => s.open);
  const close = useRadialMenuStore((s) => s.close);
  const entities = useEntityStore((s) => s.entities);
  const entityTaskables = useEntityTaskables(open?.entityId);
  const positionTaskables = usePositionTaskables();
  const palette = useContext(PaletteContext);
  const placement = usePlacement();
  const { runTask } = useRunTask();
  const { request: requestDelete, dialog: deleteDialog } = useEntityDelete();

  const entity = open?.entityId ? (entities.get(open.entityId) ?? null) : null;

  useEffect(() => {
    if (!open || Platform.OS !== "web") return;
    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (e.deltaY < 0) mapEngineActions.zoomIn();
      else mapEngineActions.zoomOut();
    };
    window.addEventListener("wheel", handleWheel, { passive: false });
    return () => window.removeEventListener("wheel", handleWheel);
  }, [open]);

  // Suppress native menu and dismiss radial.
  useEffect(() => {
    if (!open || Platform.OS !== "web") return;
    const handleContext = (e: MouseEvent) => {
      e.preventDefault();
      close();
    };
    window.addEventListener("contextmenu", handleContext);
    return () => window.removeEventListener("contextmenu", handleContext);
  }, [open, close]);

  const handleSelect = useCallback(
    async (id: string) => {
      if (id.startsWith("task:")) {
        const taskId = id.slice("task:".length);
        const target = entity
          ? create(TaskExecutionTargetSchema, {
              kind: {
                case: "entity",
                value: create(TaskExecutionTargetEntitySchema, {
                  entity: [entity.id],
                }),
              },
            })
          : open
            ? create(TaskExecutionTargetSchema, {
                kind: {
                  case: "position",
                  value: create(PlanarPointSchema, {
                    latitude: open.lat,
                    longitude: open.lng,
                  }),
                },
              })
            : undefined;
        try {
          await runTask(taskId, target);
        } catch (err) {
          if (err instanceof ConnectError && err.code === Code.AlreadyExists) {
            toast.warning("Task already running");
            return;
          }
          toast.error(err instanceof Error ? err.message : "Task failed");
        }
        return;
      }
      if (!entity) return;
      if (id === "built-in:follow") useSelectionStore.getState().toggleFollow();
      if (id === "built-in:configure") palette.open({ kind: "config", entityId: entity.id });
      if (id === "built-in:reposition") placement.enterPlacement(entity, { recenter: true });
      if (id === "built-in:delete") requestDelete(entity);
    },
    [entity, open, runTask, palette, placement, requestDelete],
  );

  const items = useMemo(
    () =>
      entity
        ? resolveRadialItems(entity, entityTaskables, placement.canPlace)
        : resolvePositionItems(positionTaskables),
    [entity, entityTaskables, positionTaskables, placement.canPlace],
  );
  const sidc = entity?.symbol?.milStd2525C;
  const title = entity ? getEntityName(entity) : "Map position";

  return (
    <>
      {open && items.length > 0 && (
        <RadialMenu
          position={{ x: open.x, y: open.y }}
          items={items}
          title={title}
          titleIconUri={sidc ? generateSymbol(sidc) : undefined}
          onSelect={handleSelect}
          onClose={close}
        />
      )}
      {deleteDialog}
    </>
  );
}
