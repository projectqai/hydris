"use no memo";

import type { Entity } from "@projectqai/proto/world";
import { useMemo } from "react";

import { getEntityName } from "../../../../lib/api/use-track-utils";
import { useEntityStore } from "../../store/entity-store";
import { type ConfigStateLabel, getConfigState, getEntityIcon } from "../../utils/entity-helpers";

export type DeviceNode = {
  entityId: string;
  label: string;
  entity: Entity;
  icon: ReturnType<typeof getEntityIcon>;
  children: DeviceNode[];
  isConfigurable: boolean;
  configState: ConfigStateLabel | null;
  canAddChildren: boolean;
};

export type CategoryGroup = {
  category: string;
  roots: DeviceNode[];
};

export type ConfigSelection = { type: "device"; entityId: string } | null;

const ORPHANED_CATEGORY = "Orphaned Configs";

function buildDeviceNode(entity: Entity, orphaned = false): DeviceNode {
  return {
    entityId: entity.id,
    label: entity.configurable?.label ?? getEntityName(entity),
    entity,
    icon: getEntityIcon(entity),
    children: [],
    isConfigurable:
      !!entity.configurable?.schema && Object.keys(entity.configurable.schema).length > 0,
    configState: orphaned ? null : getConfigState(entity),
    canAddChildren: orphaned
      ? false
      : (entity.configurable?.supportedDeviceClasses.length ?? 0) > 0,
  };
}

function sortNodes(nodes: DeviceNode[]) {
  nodes.sort((a, b) => a.label.localeCompare(b.label) || a.entityId.localeCompare(b.entityId));
  for (const n of nodes) sortNodes(n.children);
}

function buildTree(entities: Map<string, Entity>): CategoryGroup[] {
  const nodeMap = new Map<string, DeviceNode>();
  const entityMap = new Map<string, Entity>();
  const orphanedNodes: DeviceNode[] = [];

  for (const entity of entities.values()) {
    if (entity.device) {
      nodeMap.set(entity.id, buildDeviceNode(entity));
      entityMap.set(entity.id, entity);
    } else if (entity.configurable && entity.config) {
      orphanedNodes.push(buildDeviceNode(entity, true));
    }
  }

  const roots: DeviceNode[] = [];

  for (const [id, entity] of entityMap) {
    const node = nodeMap.get(id)!;
    const parentId = entity.device!.parent;
    if (parentId && nodeMap.has(parentId)) {
      nodeMap.get(parentId)!.children.push(node);
    } else {
      roots.push(node);
    }
  }

  sortNodes(roots);
  sortNodes(orphanedNodes);

  const byCategory = new Map<string, DeviceNode[]>();
  for (const root of roots) {
    const category = entityMap.get(root.entityId)!.device!.category ?? "Other";
    const arr = byCategory.get(category);
    if (arr) arr.push(root);
    else byCategory.set(category, [root]);
  }

  const categories: CategoryGroup[] = [];
  for (const [category, categoryRoots] of byCategory) {
    categories.push({ category, roots: categoryRoots });
  }
  categories.sort((a, b) => {
    if (a.category === "Other") return 1;
    if (b.category === "Other") return -1;
    return a.category.localeCompare(b.category);
  });

  if (orphanedNodes.length > 0) {
    categories.push({ category: ORPHANED_CATEGORY, roots: orphanedNodes });
  }

  return categories;
}

export function useConfigTree(): CategoryGroup[] {
  const entities = useEntityStore((s) => s.entities);
  const changeVersion = useEntityStore((s) => s.lastChange.version);
  return useMemo(() => buildTree(entities), [entities, changeVersion]);
}
