import { Code, ConnectError } from "@connectrpc/connect";
import { useEffect, useEffectEvent } from "react";

import { useEntityMutation } from "../../../lib/api/use-entity-mutation";
import { toast } from "../../../lib/sonner";
import { useEntityStore } from "../store/entity-store";

export function useDiscardUnsavedDevice(entityId: string | undefined) {
  const { deleteDevice } = useEntityMutation();

  const discard = useEffectEvent(async (id: string) => {
    if (useEntityStore.getState().entities.get(id)?.config) return;

    try {
      await deleteDevice(id);
    } catch (err) {
      if (err instanceof ConnectError && err.code === Code.NotFound) return;

      toast.error(err instanceof Error ? err.message : "Failed to delete device");
    }
  });

  useEffect(() => {
    if (!entityId) return;

    return () => void discard(entityId);
  }, [entityId]);
}
