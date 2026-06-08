import { ConfirmDialog } from "@hydris/ui/dialogs/confirm-dialog";
import type { Entity } from "@projectqai/proto/world";
import { type ReactNode, useState } from "react";

import { useEntityMutation } from "../../../lib/api/use-entity-mutation";
import { getEntityName } from "../../../lib/api/use-track-utils";
import { toast } from "../../../lib/sonner";

export function useEntityDelete(): {
  readonly request: (entity: Entity) => void;
  readonly dialog: ReactNode;
} {
  const [pending, setPending] = useState<Entity | null>(null);
  const { deleteDevice } = useEntityMutation();

  const request = (entity: Entity) => setPending(entity);
  const cancel = () => setPending(null);
  const confirm = async () => {
    if (!pending) return;
    const name = getEntityName(pending);
    try {
      await deleteDevice(pending.id);
      toast.success(`Deleted ${name}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete device");
    }
    setPending(null);
  };

  const dialog = pending ? (
    <ConfirmDialog
      visible
      title="Delete device"
      message={`Remove "${getEntityName(pending)}"? This cannot be undone.`}
      confirmLabel="Delete"
      destructive
      onCancel={cancel}
      onConfirm={confirm}
    />
  ) : null;

  return { request, dialog };
}
