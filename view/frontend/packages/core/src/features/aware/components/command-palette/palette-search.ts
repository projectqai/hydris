import type { Category } from "@hydris/ui/command-palette/palette-reducer";
import uFuzzy from "@leeoniya/ufuzzy";
import type { Entity } from "@projectqai/proto/world";

import { getEntityName } from "../../../../lib/api/use-track-utils";
import type { CategoryGroup, DeviceNode } from "../configuration-modal/use-config-tree";
import type { Command } from "./command-registry";
import { classifyEntity } from "./palette-helpers";

const uf = new uFuzzy({ intraMode: 1 });

export type SearchResult<T> = {
  item: T;
  ranges: number[];
};

export type SearchOutput<T> = {
  results: SearchResult<T>[];
  total: number;
};

function search<T>(haystack: string[], items: T[], query: string, max: number): SearchOutput<T> {
  const idxs = uf.filter(haystack, query);
  if (!idxs || idxs.length === 0) return { results: [], total: 0 };

  const info = uf.info(idxs, haystack, query);
  const order = uf.sort(info, haystack, query);

  const results: SearchResult<T>[] = [];
  const limit = Math.min(order.length, max);
  for (let i = 0; i < limit; i++) {
    const infoIdx = order[i]!;
    const itemIdx = info.idx[infoIdx]!;
    const ranges = info.ranges[infoIdx] ?? [];
    results.push({ item: items[itemIdx]!, ranges });
  }
  return { results, total: order.length };
}

export function searchEntities(
  entities: Map<string, Entity>,
  query: string,
  category: Category | null,
  max = 50,
): SearchOutput<Entity> {
  const q = query.trim();

  const filtered: Entity[] = [];
  for (const entity of entities.values()) {
    const cat = classifyEntity(entity);
    if (!cat) continue;
    if (category && cat !== category) continue;
    filtered.push(entity);
  }

  if (!q)
    return {
      results: filtered.slice(0, max).map((item) => ({ item, ranges: [] })),
      total: filtered.length,
    };

  const haystack = filtered.map((e) => `${getEntityName(e)} ${e.id} ${e.controller?.id ?? ""}`);

  return search(haystack, filtered, q, max);
}

export function searchCommands(
  commands: Command[],
  query: string,
  max = 10,
): SearchOutput<Command> {
  const q = query.trim();
  if (!q) return { results: [], total: 0 };

  const haystack = commands.map((c) => c.label);
  return search(haystack, commands, q, max);
}

export type ConfigTreeMatch = {
  entityId: string;
  label: string;
  icon: DeviceNode["icon"];
  configState: DeviceNode["configState"];
  isConfigurable: boolean;
  breadcrumb: string[];
};

export type ConfigTreeResult = {
  matches: ConfigTreeMatch[];
  matchedKeys: Set<string>;
  expandKeys: Set<string>;
};

type FlatNode = {
  entityId: string;
  label: string;
  icon: DeviceNode["icon"];
  configState: DeviceNode["configState"];
  isConfigurable: boolean;
  breadcrumb: string[];
  ancestorKeys: string[];
  haystack: string;
};

function flattenTree(tree: CategoryGroup[]): FlatNode[] {
  const nodes: FlatNode[] = [];

  const walk = (devices: DeviceNode[], breadcrumb: string[], ancestorKeys: string[]) => {
    for (const node of devices) {
      const crumb = [...breadcrumb, node.label];
      const ancestors = [...ancestorKeys, node.entityId];
      nodes.push({
        entityId: node.entityId,
        label: node.label,
        icon: node.icon,
        configState: node.configState,
        isConfigurable: node.isConfigurable,
        breadcrumb: crumb,
        ancestorKeys: ancestors.slice(0, -1),
        haystack: `${node.label} ${node.entityId}`,
      });
      if (node.children.length > 0) {
        walk(node.children, crumb, ancestors);
      }
    }
  };

  for (const category of tree) {
    const categoryKey = `category:${category.category}`;
    walk(category.roots, [category.category], [categoryKey]);
  }

  return nodes;
}

const EMPTY_TREE_RESULT: ConfigTreeResult = {
  matches: [],
  matchedKeys: new Set(),
  expandKeys: new Set(),
};

export function filterConfigTree(tree: CategoryGroup[], query: string, max = 50): ConfigTreeResult {
  const q = query.trim();
  if (!q) return EMPTY_TREE_RESULT;

  const flat = flattenTree(tree);
  if (flat.length === 0) return EMPTY_TREE_RESULT;

  const haystack = flat.map((n) => n.haystack);
  const idxs = uf.filter(haystack, q);
  if (!idxs || idxs.length === 0) return EMPTY_TREE_RESULT;

  const info = uf.info(idxs, haystack, q);
  const order = uf.sort(info, haystack, q);

  const matches: ConfigTreeMatch[] = [];
  const matchedKeys = new Set<string>();
  const expandKeys = new Set<string>();
  const limit = Math.min(order.length, max);

  for (let i = 0; i < limit; i++) {
    const infoIdx = order[i]!;
    const itemIdx = info.idx[infoIdx]!;
    const node = flat[itemIdx]!;

    matches.push({
      entityId: node.entityId,
      label: node.label,
      icon: node.icon,
      configState: node.configState,
      isConfigurable: node.isConfigurable,
      breadcrumb: node.breadcrumb,
    });

    matchedKeys.add(node.entityId);
    for (const key of node.ancestorKeys) {
      expandKeys.add(key);
    }
  }

  return { matches, matchedKeys, expandKeys };
}

export type ConfigurableHit = {
  entityId: string;
  entityName: string;
  label: string;
};

export function searchConfigurables(
  entities: Map<string, Entity>,
  query: string,
  max = 20,
): SearchOutput<ConfigurableHit> {
  const q = query.trim();
  if (!q) return { results: [], total: 0 };

  const items: ConfigurableHit[] = [];
  for (const entity of entities.values()) {
    if (!entity.configurable?.schema) continue;
    items.push({
      entityId: entity.id,
      entityName: getEntityName(entity),
      label: entity.configurable.label ?? getEntityName(entity),
    });
  }

  const haystack = items.map((c) => `${c.label} ${c.entityId} ${c.entityName}`);
  return search(haystack, items, q, max);
}
