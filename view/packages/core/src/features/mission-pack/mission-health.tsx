"use no memo";

import { timestampFromMs } from "@bufbuild/protobuf/wkt";
import {
  Accordion,
  AccordionContent,
  AccordionCount,
  AccordionIndicator,
  AccordionItem,
  AccordionTitle,
  AccordionTrigger,
} from "@hydris/ui/accordion";
import { ControlButton } from "@hydris/ui/controls";
import { Empty, EmptyDescription, EmptyMedia, EmptyTitle } from "@hydris/ui/empty-state";
import type { StateSeverity } from "@hydris/ui/lib/severity";
import { SEVERITY_TEXT } from "@hydris/ui/lib/severity";
import type { Entity } from "@projectqai/proto/world";
import { ListTree } from "lucide-react-native";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { Text, View } from "react-native";
import { useShallow } from "zustand/react/shallow";

import type { Timestamp } from "../../lib/api/use-track-utils";
import { formatTime } from "../../lib/api/use-track-utils";
import { worldClient } from "../../lib/api/world-client";
import { ErrorNotice } from "../aware/components/error-notice";
import { useEntityStore } from "../aware/store/entity-store";
import { useVersion } from "../aware/store/version-store";
import { MissionHeaderStatus } from "../mission/components/mission-header-status";
import { isRaised } from "../mission/provider-state";
import { useGroupsState, useSourcesState } from "../mission/use-mission-state";
import { selectDeviceGroups, useReportedSourceKinds } from "../mission/use-sources";
import type { SourcesSection } from "./mission-health-compute";
import {
  computeStatic,
  getDoneAction,
  getSourceRow,
  getSourcesSections,
} from "./mission-health-compute";
import { useMissionHealthStore } from "./mission-health-store";

type LiveEntities = { count: number; fetchedAt: Timestamp } | { error: string };

function HealthSection({
  label,
  count,
  tone,
  description,
  defaultExpanded = false,
  children,
}: {
  label: string;
  count: number;
  tone: StateSeverity;
  description?: string;
  defaultExpanded?: boolean;
  children?: ReactNode;
}) {
  return (
    <Accordion type="multiple" defaultValue={defaultExpanded ? [label] : []}>
      <AccordionItem value={label}>
        <AccordionTrigger>
          <AccordionIndicator />
          <AccordionTitle className={SEVERITY_TEXT[tone]}>{label}</AccordionTitle>
          <AccordionCount>{count}</AccordionCount>
        </AccordionTrigger>
        <AccordionContent>
          {description ? (
            <Text className="text-muted-foreground text-11 font-mono leading-relaxed">
              {description}
            </Text>
          ) : null}
          {children ? <View className="mt-1">{children}</View> : null}
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  );
}

function IdItem({ id }: { id: string }) {
  return (
    <Text className="text-muted-foreground font-mono text-xs" numberOfLines={1}>
      {id}
    </Text>
  );
}

// fetches on mount, so only mount it when the section is expanded.
// list is live world state; the header count is the pack count, so they differ.
function EntityList({ onResult }: { onResult: (result: LiveEntities | null) => void }) {
  const [ids, setIds] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;

    onResult(null);
    worldClient
      .listEntities({})
      .then((res) => {
        if (cancelled) return;
        setIds(res.entities.map((e) => e.id).sort());
        onResult({ count: res.entities.length, fetchedAt: timestampFromMs(Date.now()) });
      })
      .catch((err) => {
        if (cancelled) return;

        const message = err instanceof Error ? err.message : "Failed to load entities";

        setError(message);
        onResult({ error: message });
      });
    return () => {
      cancelled = true;
    };
  }, [onResult]);

  if (error) return <ErrorNotice>{error}</ErrorNotice>;

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

function EntitiesSection({ count }: { count: number }) {
  const [live, setLive] = useState<LiveEntities | null>(null);

  const liveCount =
    live && "count" in live ? `${live.count} in world at ${formatTime(live.fetchedAt)}. ` : "";

  return (
    <HealthSection
      label="Entities loaded"
      count={count}
      tone={live && "error" in live ? "alert" : "success"}
      description={`${liveCount}All entities in the world, including engine services and the node itself.`}
    >
      <EntityList onResult={setLive} />
    </HealthSection>
  );
}

function SourceRow({ entity }: { entity: Entity }) {
  const row = useEntityStore(
    useShallow((s) => getSourceRow(entity, selectDeviceGroups(s), s.entities, s.isConnected)),
  );

  const { name, error } = row;

  return (
    <View className="py-0.5">
      <View className="flex-row items-center justify-between gap-2">
        <Text className="text-muted-foreground min-w-0 shrink font-mono text-xs">{name}</Text>
        <MissionHeaderStatus state={row} />
      </View>
      {error && <ErrorNotice className="my-1">{error}</ErrorNotice>}
    </View>
  );
}

function SourcesSectionRows({ section }: { section: SourcesSection }) {
  const state = useGroupsState(section.getState);

  const entities = useEntityStore(
    useShallow((s) => section.getEntities(selectDeviceGroups(s), s.entities, s.isConnected)),
  );

  if (!state) return null;

  return (
    <HealthSection
      label={section.title}
      count={entities.length}
      tone={state.variant === "default" ? "neutral" : state.variant}
      defaultExpanded={isRaised(state.variant)}
    >
      {entities.map((entity) => (
        <SourceRow key={entity.id} entity={entity} />
      ))}
    </HealthSection>
  );
}

export function MissionDoneFooter({ onDone }: { onDone: () => void }) {
  const hasMission = useMissionHealthStore((s) => s.mission != null);
  const sources = useSourcesState();

  if (!hasMission) return null;

  const { label, variant } = getDoneAction(sources);

  return (
    <View className="border-foreground/8 border-t px-4 py-3">
      <ControlButton
        onPress={onDone}
        label={label}
        variant={variant}
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
  const sourceKinds = useReportedSourceKinds();

  useEffect(() => {
    fetchHealth();
  }, [fetchHealth]);

  if (!mission) {
    return (
      <Empty>
        <EmptyMedia icon={ListTree} />
        <EmptyTitle>No mission loaded</EmptyTitle>
        <EmptyDescription>Import a mission pack to see status here.</EmptyDescription>
      </Empty>
    );
  }

  const health = computeStatic(mission, currentVersion);

  return (
    <View className="gap-2 p-2">
      <EntitiesSection count={health.entityCount} />

      {health.layoutNames.length > 0 ? (
        <HealthSection
          label="Layouts loaded"
          count={health.layoutNames.length}
          tone="success"
          description=""
        >
          {health.layoutNames.map((name) => (
            <IdItem key={name} id={name} />
          ))}
        </HealthSection>
      ) : null}

      {health.artifacts.count > 0 ? (
        <HealthSection
          label="Artifacts bundled"
          count={health.artifacts.count}
          tone="success"
          description={`${health.artifacts.size} total.`}
        />
      ) : null}

      {getSourcesSections(sourceKinds).map((section) => (
        <SourcesSectionRows key={section.title} section={section} />
      ))}

      {health.version.status !== "ok" ? (
        <HealthSection
          label="Version mismatch"
          count={1}
          tone="pending"
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
