import type { ConfigurableComponent } from "@projectqai/proto/world";
import { useEffect, useState } from "react";

import { toast } from "../../../lib/sonner";
import { formatConfigurableState } from "../utils/format-entity";

export const HANDSHAKE_TIMEOUT_MS = 30_000;

type HandshakeOptions = { appliedMessage?: string; onApplied?: () => void };

type Wait = { version: bigint; overdue: boolean };

// writers other than the shared controller stamp applied_version with a non-final state
export function answersPush({ appliedVersion }: ConfigurableComponent, version: bigint) {
  return appliedVersion >= version;
}

export function useConfigHandshake(
  configurable: ConfigurableComponent | undefined,
  { appliedMessage = "Config applied", onApplied }: HandshakeOptions = {},
) {
  const [wait, setWait] = useState<Wait | null>(null);

  useEffect(() => {
    if (!wait || !configurable || !answersPush(configurable, wait.version)) return;

    setWait(null);

    const { label, severity } = formatConfigurableState(configurable.state);
    const options = { description: configurable.error };

    if (severity === "success") {
      toast.success(appliedMessage);
      onApplied?.();
    } else if (severity === "alert") {
      toast.error(label, options);
    } else {
      toast(label, options);
    }
  }, [wait, configurable, appliedMessage, onApplied]);

  useEffect(() => {
    if (!wait || wait.overdue) return;

    const t = setTimeout(() => setWait({ ...wait, overdue: true }), HANDSHAKE_TIMEOUT_MS);

    return () => clearTimeout(t);
  }, [wait]);

  const overdue = !!wait?.overdue && !!configurable && !answersPush(configurable, wait.version);

  const push = async (send: () => Promise<{ version: bigint }>) => {
    try {
      const { version } = await send();

      setWait({ version, overdue: false });

      return true;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Push failed");

      return false;
    }
  };

  return { awaiting: wait != null && !wait.overdue, overdue, push };
}
