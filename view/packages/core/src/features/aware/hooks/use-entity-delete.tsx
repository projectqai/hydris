import { ConfirmDialog } from "@hydris/ui/dialogs/confirm-dialog";
import type { Entity } from "@projectqai/proto/world";
import { type ReactNode, useState } from "react";

import { useEntityMutation } from "../../../lib/api/use-entity-mutation";
import { getDeviceName } from "../../../lib/api/use-track-utils";
import { toast } from "../../../lib/sonner";

type PendingDelete = { entity: Entity; title: string };

export function useEntityDelete(onDeleted?: () => void): {
  readonly request: (entity: Entity, title: string) => void;
  readonly dialog: ReactNode;
} {
  const [pending, setPending] = useState<PendingDelete | null>(null);
  const { deleteDevice } = useEntityMutation();

  const request = (entity: Entity, title: string) => setPending({ entity, title });
  const cancel = () => setPending(null);
  const confirm = async () => {
    if (!pending) return;
    const name = getDeviceName(pending.entity);

    try {
      await deleteDevice(pending.entity.id);
      toast.success(`Deleted ${name}`);
      onDeleted?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : `Failed to delete ${name}`);
    }
    setPending(null);
  };

  const dialog = pending ? (
    <ConfirmDialog
      visible
      title={pending.title}
      message={`Delete "${getDeviceName(pending.entity)}"? This cannot be undone.`}
      confirmLabel="Delete"
      destructive
      onCancel={cancel}
      onConfirm={confirm}
    />
  ) : null;

  return { request, dialog };
}
