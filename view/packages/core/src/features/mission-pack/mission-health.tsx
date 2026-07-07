"use no memo";

import { CollapsibleSection } from "@hydris/ui/collapsible-section";
import { ControlButton } from "@hydris/ui/controls";
import { EmptyState } from "@hydris/ui/empty-state";
import { useThemeColors } from "@hydris/ui/lib/theme";
import { cn } from "@hydris/ui/lib/utils";
import { AlertTriangle, CheckCircle2, ListTree } from "lucide-react-native";
import { useEffect, useMemo, useState } from "react";
import { Text, View } from "react-native";

import { worldClient } from "../../lib/api/world-client";
import { useEntityStore } from "../aware/store/entity-store";
import { useVersion } from "../aware/store/version-store";
import type { RowStatus } from "./mission-health-compute";
import { computeControllers, computeStatic } from "./mission-health-compute";
import { useMissionHealthStore } from "./mission-health-store";

function statusColorClass(status: RowStatus): string {
  switch (status) {
    case "ok":
      return "text-success-foreground";
    case "warn":
      return "text-pending-foreground";
    case "fail":
      return "text-red-foreground";
  }
}

function IdItem({ id, error }: { id: string; error?: string }) {
  return (
    <View>
      <Text className="text-muted-foreground font-mono text-xs" numberOfLines={1}>
        {id}
      </Text>
      {error ? <Text className="text-red-foreground font-mono text-xs">{error}</Text> : null}
    </View>
  );
}

// fetches on mount, so only mount it when the section is expanded.
// list is live world state; the header count is the pack count, so they differ.
function EntityList() {
  const [ids, setIds] = useState<string[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    worldClient
      .listEntities({})
      .then((res) => {
        if (cancelled) return;
        setIds(res.entities.map((e) => e.id).sort());
      })
      .catch(() => {
        if (!cancelled) setIds([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (ids === null) {
    return <Text className="text-muted-foreground font-mono text-xs">Loading…</Text>;
  }
  const MAX = 200;
  const overflow = ids.length - MAX;
  return (
    <>
      {ids.slice(0, MAX).map((id) => (
        <IdItem key={id} id={id} />
      ))}
      {overflow > 0 ? (
        <Text className="text-muted-foreground mt-1 font-mono text-xs">… and {overflow} more</Text>
      ) : null}
    </>
  );
}

// Controllers are the only live part of the panel: their status comes from the
// entity stream, which flushes every 250ms. Reading it here keeps the churn
// contained to the header and controller rows, so the static rows (entity
// list, layouts, artifacts) don't re-render on every flush.
function useControllerHealth() {
  const entities = useEntityStore((s) => s.entities);
  const entityVersion = useEntityStore((s) => s.lastChange?.version ?? 0);
  return useMemo(() => {
    void entityVersion;
    return computeControllers(entities);
  }, [entities, entityVersion]);
}

function MissionStatusHeader() {
  const controllers = useControllerHealth();
  const t = useThemeColors();
  const hasFailures = controllers.failed.length > 0;
  const status: RowStatus = hasFailures ? "fail" : "ok";
  const iconColor = hasFailures ? t.redForeground : t.successForeground;
  return (
    <View className="flex-row items-center gap-2 px-4 py-2">
      {hasFailures ? (
        <AlertTriangle size={16} strokeWidth={2} color={iconColor} />
      ) : (
        <CheckCircle2 size={16} strokeWidth={2} color={iconColor} />
      )}
      <Text className={cn("font-sans-medium text-sm", statusColorClass(status))}>
        {hasFailures ? "Imported with issues" : "Mission ready"}
      </Text>
    </View>
  );
}

function ControllerSections() {
  const controllers = useControllerHealth();
  return (
    <>
      {controllers.expected > 0 && controllers.status === "ok" ? (
        <CollapsibleSection
          label="Controllers running"
          count={controllers.running}
          tone="ok"
          description=""
        >
          {controllers.runningIds.map((id) => (
            <IdItem key={id} id={id} />
          ))}
        </CollapsibleSection>
      ) : null}

      {controllers.expected > 0 && controllers.status === "warn" ? (
        <CollapsibleSection
          label="Controllers starting"
          count={controllers.pending.length}
          tone="warn"
          description="These controllers haven't reported Active yet. They may still be initializing."
        >
          {controllers.pending.map((id) => (
            <IdItem key={id} id={id} />
          ))}
        </CollapsibleSection>
      ) : null}

      {controllers.failed.length > 0 ? (
        <CollapsibleSection
          label="Controllers not running"
          count={controllers.failed.length}
          tone="fail"
          description="These controllers reported Failed or Conflict. They may need credentials or a version match."
        >
          {controllers.failed.map((p) => (
            <IdItem key={p.id} id={p.id} error={p.error} />
          ))}
        </CollapsibleSection>
      ) : null}
    </>
  );
}

export function MissionDoneFooter({ onDone }: { onDone: () => void }) {
  const hasMission = useMissionHealthStore((s) => s.mission != null);
  const controllers = useControllerHealth();
  if (!hasMission) return null;
  const hasFailures = controllers.failed.length > 0;
  return (
    <View className="border-foreground/8 border-t px-4 py-3">
      <ControlButton
        onPress={onDone}
        label={hasFailures ? "Proceed anyway" : "Done"}
        variant={hasFailures ? "default" : "success"}
        size="lg"
        fullWidth
        labelClassName="font-mono text-xs font-semibold uppercase"
      />
    </View>
  );
}

export function MissionHealth() {
  const mission = useMissionHealthStore((s) => s.mission);
  const fetchHealth = useMissionHealthStore((s) => s.fetch);
  const currentVersion = useVersion() ?? "";

  useEffect(() => {
    fetchHealth();
  }, [fetchHealth]);

  if (!mission) {
    return (
      <EmptyState
        icon={ListTree}
        title="No mission loaded"
        subtitle="Import a mission pack to see status here."
      />
    );
  }

  const health = computeStatic(mission, currentVersion);

  return (
    <View>
      <MissionStatusHeader />

      <CollapsibleSection
        label="Entities loaded"
        count={health.entityCount}
        tone="ok"
        description="All entities in the world, including engine services and the node itself."
      >
        <EntityList />
      </CollapsibleSection>

      {health.layoutNames.length > 0 ? (
        <CollapsibleSection
          label="Layouts loaded"
          count={health.layoutNames.length}
          tone="ok"
          description=""
        >
          {health.layoutNames.map((name) => (
            <IdItem key={name} id={name} />
          ))}
        </CollapsibleSection>
      ) : null}

      {health.artifacts.count > 0 ? (
        <CollapsibleSection
          label="Artifacts bundled"
          count={health.artifacts.count}
          tone="ok"
          description={`${health.artifacts.size} total.`}
        />
      ) : null}

      <ControllerSections />

      {health.version.status !== "ok" ? (
        <CollapsibleSection
          label="Version mismatch"
          count={1}
          tone={health.version.status}
          description={
            health.version.pack
              ? `Pack built with ${health.version.pack}, engine is ${health.version.engine || "unknown"}.`
              : "Pack did not record which version built it."
          }
        />
      ) : null}
    </View>
  );
}
