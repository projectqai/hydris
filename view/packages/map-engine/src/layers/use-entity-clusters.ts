import type { Layer, PickingInfo } from "@deck.gl/core";
import { IconLayer, ScatterplotLayer, TextLayer } from "@deck.gl/layers";
import { useMemo, useRef, useState } from "react";

import { ICON_SIZE } from "../constants";
import type { Affiliation, EntityData, EntityFilter } from "../types";
import { getSymbolAtlas, type OverflowEntry } from "../utils/symbol-atlas";
import { useClusterWorker } from "./use-cluster-worker";

const CLUSTER_SYMBOL_SIZE = 44;
const ICON_SIZE_MIN_PIXELS = 8;
const ICON_SIZE_MAX_PIXELS = 64;

const CLUSTER_BG: [number, number, number, number] = [50, 50, 50, 255];
const ZERO_OFFSET: [number, number] = [0, 0];
const COLOCATION_PRECISION = 1e6;
const ASSEMBLY_RADIUS = 90;
const CONNECTOR_W = ASSEMBLY_RADIUS;
const CONNECTOR_H = 2;
const CONNECTOR_SVG =
  "data:image/svg+xml," +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${CONNECTOR_W}" height="${CONNECTOR_H}"><rect width="${CONNECTOR_W}" height="${CONNECTOR_H}" rx="1" fill="rgba(140,180,210,0.6)"/></svg>`,
  );
const CONNECTOR_ICON = {
  url: CONNECTOR_SVG,
  width: CONNECTOR_W,
  height: CONNECTOR_H,
  anchorX: CONNECTOR_W / 2,
  anchorY: 1,
};

function positionKey(position: [number, number]): string {
  return `${Math.round(position[0] * COLOCATION_PRECISION)},${Math.round(position[1] * COLOCATION_PRECISION)}`;
}

function coarsePositionKey(position: [number, number]): string {
  return `${Math.round(position[0] * 1e4)},${Math.round(position[1] * 1e4)}`;
}

const BADGE_TEXT_STYLE = {
  getSize: 12,
  getColor: [255, 255, 255, 255] as [number, number, number, number],
  getTextAnchor: "middle" as const,
  getAlignmentBaseline: "center" as const,
  fontFamily: "Inter, system-ui, sans-serif",
  fontWeight: "600",
  fontSettings: { sdf: true, fontSize: 64, buffer: 8, radius: 16, cutoff: 0.2 },
  background: true,
  getBackgroundColor: CLUSTER_BG,
  backgroundPadding: [4, 2] as [number, number],
  pickable: false,
} as const;

const MILSYMBOL_COLORS_RGBA: Record<Affiliation, [number, number, number, number]> = {
  blue: [128, 224, 255, 255],
  red: [255, 128, 128, 255],
  neutral: [170, 255, 170, 255],
  unknown: [255, 255, 128, 255],
  unclassified: [156, 163, 175, 255],
};

function getAffiliationColorRGBA(
  affiliation: Affiliation | undefined,
): [number, number, number, number] {
  return MILSYMBOL_COLORS_RGBA[affiliation ?? "unknown"];
}

type EntityRenderData = {
  entity: EntityData;
  position: [number, number];
  iconKey: string;
  size: number;
  overflow?: OverflowEntry;
};

type ClusterRenderData = {
  id: string;
  lat: number;
  lng: number;
  position: [number, number];
  count: number;
  symbol?: string;
  affiliation?: Affiliation;
  iconKey?: string;
  size?: number;
  radius: number;
  pixelOffset: [number, number];
  lineColor: [number, number, number, number];
  textColor: [number, number, number, number];
  overflow?: OverflowEntry;
};

type UseEntityClustersOptions = {
  entityMap: Map<string, EntityData>;
  lastChange?: { version: number; geoChanged: boolean };
  filter: EntityFilter;
  selectedId: string | null;
  shapesVisible: boolean;
  detectionsVisible: boolean;
  zoom: number;
  pickable?: boolean;
  overlapOffsets?: OverlapOffsets | null;
  expandedAssemblies?: Set<string> | null;
  onEntityClick?: (id: string) => void | Promise<void>;
  onClusterClick?: (clusterId: string, lat: number, lng: number, expansionZoom: number) => void;
  onOverlapSpread?: (offsets: OverlapOffsets) => void;
  onAssemblyExpand?: (rootId: string) => void;
  onAssemblyCollapse?: () => void;
};

type OverlapOffsets = Map<string, [number, number]>;

type ConnectorLine = {
  position: [number, number];
  offset: [number, number];
  angle: number;
};

type UseEntityClustersResult = {
  layers: Layer[];
  selectionData: {
    entity: EntityData;
    sizePixels: number;
    offsetX: number;
    offsetY: number;
  } | null;
  labelData: {
    id: string;
    position: [number, number];
    label: string;
    offsetY: number;
    pixelOffset?: [number, number];
  }[];
  coverageEntities: EntityData[];
};

export function useEntityClusters(options: UseEntityClustersOptions): UseEntityClustersResult {
  const {
    entityMap,
    lastChange,
    filter,
    selectedId,
    shapesVisible,
    detectionsVisible,
    zoom,
    pickable = true,
    overlapOffsets = null,
    expandedAssemblies = null,
    onEntityClick,
    onClusterClick,
    onOverlapSpread,
    onAssemblyExpand,
    onAssemblyCollapse,
  } = options;

  const onEntityClickRef = useRef(onEntityClick);
  onEntityClickRef.current = onEntityClick;
  const onClusterClickRef = useRef(onClusterClick);
  onClusterClickRef.current = onClusterClick;
  const onOverlapSpreadRef = useRef(onOverlapSpread);
  onOverlapSpreadRef.current = onOverlapSpread;
  const onAssemblyExpandRef = useRef(onAssemblyExpand);
  onAssemblyExpandRef.current = onAssemblyExpand;
  const onAssemblyCollapseRef = useRef(onAssemblyCollapse);
  onAssemblyCollapseRef.current = onAssemblyCollapse;
  const assemblySpreadCache = useRef<{
    key: string;
    offsets: OverlapOffsets;
  } | null>(null);

  const typedArrayPoolRef = useRef<{
    positions: Float64Array | null;
    radii: Float32Array | null;
    colors: Uint8Array | null;
  }>({ positions: null, radii: null, colors: null });

  const [atlasVersion, setAtlasVersion] = useState(0);
  const entityAtlasRef = useRef(getSymbolAtlas(ICON_SIZE));
  const clusterAtlasRef = useRef(getSymbolAtlas(CLUSTER_SYMBOL_SIZE));

  const version = lastChange?.version ?? 0;
  const geoChanged = lastChange?.geoChanged ?? true;

  const workerResult = useClusterWorker({
    entityMap,
    filter,
    shapesVisible,
    detectionsVisible,
    zoom,
    version,
    geoChanged,
  });

  const integerZoom = Math.floor(zoom);

  const assemblyChildrenOf = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const e of entityMap.values()) {
      if (e.assemblyParentId && entityMap.has(e.assemblyParentId)) {
        let children = map.get(e.assemblyParentId);
        if (!children) {
          children = [];
          map.set(e.assemblyParentId, children);
        }
        children.push(e.id);
      }
    }
    return map;
  }, [entityMap, version]);

  if (!workerResult) {
    return {
      layers: [],
      selectionData: null,
      labelData: [],
      coverageEntities: [],
    };
  }

  const { clusters } = workerResult;

  const renderEntities: EntityRenderData[] = [];
  const renderClusters: ClusterRenderData[] = [];
  const coverageEntities: EntityData[] = [];
  const labelData: {
    id: string;
    position: [number, number];
    label: string;
    offsetY: number;
    pixelOffset?: [number, number];
  }[] = [];
  const renderedEntityIds = new Set<string>();

  const entityAtlas = entityAtlasRef.current;
  const clusterAtlas = clusterAtlasRef.current;
  let needsAtlasUpdate = false;

  for (const cluster of clusters) {
    if (cluster.isCluster) {
      const affiliationColor = getAffiliationColorRGBA(cluster.affiliation);
      const count = cluster.count ?? 0;
      const clusterData: ClusterRenderData = {
        id: `${cluster.clusterKey}-${cluster.clusterId}`,
        lat: cluster.lat,
        lng: cluster.lng,
        position: [cluster.lng, cluster.lat],
        count,
        symbol: cluster.symbol,
        affiliation: cluster.affiliation,
        radius: count < 100 ? 18 : count < 1000 ? 22 : 26,
        pixelOffset: [12, -12],
        lineColor: affiliationColor,
        textColor: affiliationColor,
      };

      if (cluster.symbol && clusterAtlas) {
        const wasNew = !clusterAtlas.hasSymbol(cluster.symbol);
        const iconKey = clusterAtlas.getOrCreate(cluster.symbol);
        if (wasNew) needsAtlasUpdate = true;

        const overflowData = clusterAtlas.getOverflowData(cluster.symbol);
        const mapping = clusterAtlas.getMapping()[iconKey];

        if (overflowData) {
          clusterData.iconKey = iconKey;
          clusterData.size =
            CLUSTER_SYMBOL_SIZE * Math.sqrt(overflowData.height / overflowData.width);
          clusterData.pixelOffset = [overflowData.width / 2 - 4, -(overflowData.height / 2) + 4];
          clusterData.overflow = overflowData;
        } else if (mapping && mapping.width > 0 && mapping.height > 0) {
          clusterData.iconKey = iconKey;
          clusterData.size = CLUSTER_SYMBOL_SIZE * Math.sqrt(mapping.height / mapping.width);
          clusterData.pixelOffset = [mapping.width / 2 - 4, -(mapping.height / 2) + 4];
        }
      }

      renderClusters.push(clusterData);
    } else {
      const entityId = cluster.entityId!;
      const entity = entityMap.get(entityId);
      const symbol = entity?.symbol ?? cluster.symbol;

      if (!symbol) continue;
      if (entity?.isDetection && !detectionsVisible && entityId !== selectedId) continue;
      if (entity?.shape && !entity.isDetection && !shapesVisible) continue;

      if (entityAtlas) {
        const wasNew = !entityAtlas.hasSymbol(symbol);
        const iconKey = entityAtlas.getOrCreate(symbol);
        if (wasNew) needsAtlasUpdate = true;

        const overflowData = entityAtlas.getOverflowData(symbol);
        const mapping = entityAtlas.getMapping()[iconKey];

        if (overflowData) {
          const size = ICON_SIZE * Math.sqrt(overflowData.height / overflowData.width);
          const position: [number, number] = entity
            ? [entity.position.lng, entity.position.lat]
            : [cluster.lng, cluster.lat];
          const renderEntity: EntityData = entity ?? {
            id: entityId,
            position: { lat: cluster.lat, lng: cluster.lng },
            affiliation: cluster.affiliation,
            symbol,
          };
          renderEntities.push({
            entity: renderEntity,
            position,
            iconKey,
            size,
            overflow: overflowData,
          });
          renderedEntityIds.add(entityId);

          if (entity?.label) {
            labelData.push({
              id: entity.id,
              position: [entity.position.lng, entity.position.lat],
              label: entity.label,
              offsetY: overflowData.height,
            });
          }
        } else if (mapping && mapping.width > 0 && mapping.height > 0) {
          const size = ICON_SIZE * Math.sqrt(mapping.height / mapping.width);
          const position: [number, number] = entity
            ? [entity.position.lng, entity.position.lat]
            : [cluster.lng, cluster.lat];
          const renderEntity: EntityData = entity ?? {
            id: entityId,
            position: { lat: cluster.lat, lng: cluster.lng },
            affiliation: cluster.affiliation,
            symbol,
          };
          renderEntities.push({
            entity: renderEntity,
            position,
            iconKey,
            size,
          });
          renderedEntityIds.add(entityId);

          if (entity?.label) {
            labelData.push({
              id: entity.id,
              position: [entity.position.lng, entity.position.lat],
              label: entity.label,
              offsetY: mapping.height,
            });
          }
        }
      }

      if (entity?.ellipseRadius !== undefined || entity?.coverageEntityIds?.length) {
        coverageEntities.push(entity);
      }
    }
  }

  // Inject expanded assembly children directly (they bypass Supercluster)
  if (expandedAssemblies) {
    let rootClustered = false;
    for (const rootId of expandedAssemblies) {
      if (!renderedEntityIds.has(rootId)) {
        rootClustered = true;
        continue;
      }
      const children = assemblyChildrenOf.get(rootId);
      if (!children) continue;
      for (const childId of children) {
        if (renderedEntityIds.has(childId)) continue;
        const child = entityMap.get(childId);
        if (!child?.symbol) continue;
        if (entityAtlas) {
          const wasNew = !entityAtlas.hasSymbol(child.symbol);
          const iconKey = entityAtlas.getOrCreate(child.symbol);
          if (wasNew) needsAtlasUpdate = true;
          const overflowData = entityAtlas.getOverflowData(child.symbol) ?? undefined;
          const mapping = overflowData ? null : entityAtlas.getMapping()[iconKey];
          const dims = overflowData ?? mapping;
          if (dims && dims.width > 0 && dims.height > 0) {
            const size = ICON_SIZE * Math.sqrt(dims.height / dims.width);
            renderEntities.push({
              entity: child,
              position: [child.position.lng, child.position.lat],
              iconKey,
              size,
              overflow: overflowData,
            });
            renderedEntityIds.add(childId);
            if (child.label) {
              labelData.push({
                id: child.id,
                position: [child.position.lng, child.position.lat],
                label: child.label,
                offsetY: dims.height,
              });
            }
          }
        }
      }
    }
    if (rootClustered) onAssemblyCollapseRef.current?.();
  }

  if (needsAtlasUpdate) {
    entityAtlas?.onReady(() => {
      setAtlasVersion((v) => v + 1);
    });
    clusterAtlas?.onReady(() => {
      setAtlasVersion((v) => v + 1);
    });
  }

  // Build overlap badges for stacked entities (same idea as cluster count badges).
  // When individual entities sit under a cluster at the same position, the badge
  // shows the combined total so the count stays consistent across zoom levels.
  type OverlapBadge = { position: [number, number]; count: number; pixelOffset: [number, number] };
  const overlapBadges: OverlapBadge[] = [];
  const stackedEntityIds = new Set<string>();

  let assemblyAutoSpread: OverlapOffsets | null = null;
  let connectorLines: ConnectorLine[] = [];

  if (expandedAssemblies) {
    for (const rootId of expandedAssemblies) {
      const children = assemblyChildrenOf.get(rootId);
      if (!children) continue;
      const rootRender = renderEntities.find((r) => r.entity.id === rootId);
      if (!rootRender) continue;
      const childSet = new Set(children);
      const rootKey = coarsePositionKey(rootRender.position);
      // Include ALL colocated entities, not just children — push siblings aside
      const colocated = renderEntities.filter(
        (r) => r.entity.id !== rootId && coarsePositionKey(r.position) === rootKey,
      );
      if (colocated.length > 0) {
        const cacheKey = rootId + ":" + colocated.map((c) => c.entity.id).join(",");
        if (assemblySpreadCache.current?.key === cacheKey) {
          assemblyAutoSpread = assemblySpreadCache.current.offsets;
        } else {
          // Children on the inner ring, non-children on an outer ring
          const childItems = colocated.filter((c) => childSet.has(c.entity.id));
          const siblingItems = colocated.filter((c) => !childSet.has(c.entity.id));
          assemblyAutoSpread = new Map();
          assemblyAutoSpread.set(rootId, [0, 0]);
          const childStep = (2 * Math.PI) / childItems.length;
          for (let j = 0; j < childItems.length; j++) {
            const angle = j * childStep - Math.PI / 2;
            assemblyAutoSpread.set(childItems[j]!.entity.id, [
              ASSEMBLY_RADIUS * Math.cos(angle),
              ASSEMBLY_RADIUS * Math.sin(angle),
            ]);
          }
          const siblingRadius = ASSEMBLY_RADIUS * 1.6;
          const siblingStep = siblingItems.length > 0 ? (2 * Math.PI) / siblingItems.length : 0;
          for (let j = 0; j < siblingItems.length; j++) {
            const angle = j * siblingStep - Math.PI / 2;
            assemblyAutoSpread.set(siblingItems[j]!.entity.id, [
              siblingRadius * Math.cos(angle),
              siblingRadius * Math.sin(angle),
            ]);
          }
          assemblySpreadCache.current = { key: cacheKey, offsets: assemblyAutoSpread };
        }
        for (const [id, offset] of assemblyAutoSpread!) {
          if (id === rootId) continue;
          if (!childSet.has(id)) continue;
          connectorLines.push({
            position: rootRender.position,
            offset: [offset[0] / 2, offset[1] / 2],
            angle: Math.atan2(offset[1], offset[0]) * (180 / Math.PI),
          });
        }
      }
    }
  } else {
    assemblySpreadCache.current = null;
  }

  // Merge assembly and overlap offsets — they target different entity sets
  let effectiveOverlapOffsets: OverlapOffsets | null = null;
  if (assemblyAutoSpread || overlapOffsets) {
    effectiveOverlapOffsets = new Map();
    if (overlapOffsets) for (const [k, v] of overlapOffsets) effectiveOverlapOffsets.set(k, v);
    if (assemblyAutoSpread)
      for (const [k, v] of assemblyAutoSpread) effectiveOverlapOffsets.set(k, v);
  }

  // Generate connector lines for regular (non-assembly) spreads
  if (overlapOffsets && overlapOffsets.size > 0) {
    const entries = [...overlapOffsets.entries()];
    const anchorEntity = renderEntities.find((r) => r.entity.id === entries[0]![0]);
    if (anchorEntity) {
      for (const [, offset] of entries) {
        if (offset[0] === 0 && offset[1] === 0) continue;
        connectorLines.push({
          position: anchorEntity.position,
          offset: [offset[0] / 2, offset[1] / 2],
          angle: Math.atan2(offset[1], offset[0]) * (180 / Math.PI),
        });
      }
    }
  }

  // Badge/stacking logic runs always, excluding entities already spread
  {
    const clusterCountByPosition = new Map<string, number>();
    for (const cluster of renderClusters) {
      const key = coarsePositionKey(cluster.position);
      clusterCountByPosition.set(key, (clusterCountByPosition.get(key) ?? 0) + cluster.count);
    }

    const positionGroups = new Map<string, EntityRenderData[]>();
    for (const entity of renderEntities) {
      if (effectiveOverlapOffsets?.has(entity.entity.id)) continue;
      const key = positionKey(entity.position);
      let group = positionGroups.get(key);
      if (!group) {
        group = [];
        positionGroups.set(key, group);
      }
      group.push(entity);
    }

    for (const group of positionGroups.values()) {
      const entityCount = group.length;
      const cKey = coarsePositionKey(group[0]!.position);
      const clusterCount = clusterCountByPosition.get(cKey) ?? 0;
      const totalCount = entityCount + clusterCount;

      if (totalCount < 2) continue;
      if (entityCount >= 2) {
        for (const entity of group) stackedEntityIds.add(entity.entity.id);
      }

      if (entityCount === 0) continue;

      overlapBadges.push({
        position: group[0]!.position,
        count: totalCount,
        pixelOffset: [14, -14],
      });
    }
  }

  // Assembly badges: show child count on collapsed assembly roots
  for (const re of renderEntities) {
    const children = assemblyChildrenOf.get(re.entity.id);
    if (!children || expandedAssemblies?.has(re.entity.id)) continue;
    overlapBadges.push({
      position: re.position,
      count: children.length + 1,
      pixelOffset: [14, -14],
    });
  }

  const overlapBadgePositions = new Set(overlapBadges.map((b) => coarsePositionKey(b.position)));

  const symbolClusters: ClusterRenderData[] = [];
  const overflowClusters: ClusterRenderData[] = [];
  const affiliationClusters: ClusterRenderData[] = [];
  const badgeClusters: ClusterRenderData[] = [];
  for (let i = 0; i < renderClusters.length; i++) {
    const c = renderClusters[i]!;
    if (c.overflow) overflowClusters.push(c);
    else if (c.iconKey) symbolClusters.push(c);
    else affiliationClusters.push(c);

    if (c.overflow || c.iconKey) {
      const cKey = coarsePositionKey(c.position);
      if (!overlapBadgePositions.has(cKey)) badgeClusters.push(c);
    }
  }

  const positionsNeeded = affiliationClusters.length * 2;
  const radiiNeeded = affiliationClusters.length;
  const colorsNeeded = affiliationClusters.length * 4;

  const pool = typedArrayPoolRef.current;
  if (!pool.positions || pool.positions.length < positionsNeeded) {
    pool.positions = new Float64Array(Math.max(positionsNeeded, 64));
  }
  if (!pool.radii || pool.radii.length < radiiNeeded) {
    pool.radii = new Float32Array(Math.max(radiiNeeded, 32));
  }
  if (!pool.colors || pool.colors.length < colorsNeeded) {
    pool.colors = new Uint8Array(Math.max(colorsNeeded, 128));
  }

  const affClusterPositions = pool.positions;
  const affClusterRadii = pool.radii;
  const affClusterLineColors = pool.colors;

  for (let i = 0; i < affiliationClusters.length; i++) {
    const c = affiliationClusters[i]!;
    affClusterPositions[i * 2] = c.position[0];
    affClusterPositions[i * 2 + 1] = c.position[1];
    affClusterRadii[i] = c.radius;
    affClusterLineColors[i * 4] = c.lineColor[0];
    affClusterLineColors[i * 4 + 1] = c.lineColor[1];
    affClusterLineColors[i * 4 + 2] = c.lineColor[2];
    affClusterLineColors[i * 4 + 3] = c.lineColor[3];
  }

  let selectionData: {
    entity: EntityData;
    sizePixels: number;
    offsetX: number;
    offsetY: number;
  } | null = null;

  if (selectedId && entityAtlas) {
    const selectedRender = renderEntities.find((r) => r.entity.id === selectedId);
    if (selectedRender) {
      const overflow = selectedRender.overflow;
      const mapping = overflow ? null : entityAtlas.getMapping()[selectedRender.iconKey];
      const dims = overflow ?? mapping;

      if (dims && dims.width > 0 && dims.height > 0) {
        const renderedH = ICON_SIZE * Math.sqrt(dims.height / dims.width);
        const renderedW = ICON_SIZE * Math.sqrt(dims.width / dims.height);
        const renderedAnchorX = (dims.anchorX / dims.width) * renderedW;
        const renderedAnchorY = (dims.anchorY / dims.height) * renderedH;

        const spreadOffset = effectiveOverlapOffsets?.get(selectedId) ?? null;
        selectionData = {
          entity: selectedRender.entity,
          sizePixels: Math.max(renderedW, renderedH),
          offsetX: renderedW / 2 - renderedAnchorX + (spreadOffset?.[0] ?? 0),
          offsetY: renderedH / 2 - renderedAnchorY + (spreadOffset?.[1] ?? 0),
        };
      }
    }
  }

  const allClusters = [...symbolClusters, ...overflowClusters, ...affiliationClusters];
  if (selectedId && !selectionData && allClusters.length > 0 && entityMap.has(selectedId)) {
    const entity = entityMap.get(selectedId)!;
    if (entity.symbol && !entity.shape) {
      let nearestCluster: ClusterRenderData | null = null;
      let nearestDist = Infinity;
      for (const c of allClusters) {
        const dx = c.lng - entity.position.lng;
        const dy = c.lat - entity.position.lat;
        const dist = dx * dx + dy * dy;
        if (dist < nearestDist) {
          nearestDist = dist;
          nearestCluster = c;
        }
      }

      if (nearestCluster) {
        let sizePixels: number;
        let offsetX = 0;
        let offsetY = 0;
        let isValid = true;

        if (nearestCluster.iconKey && clusterAtlas) {
          const mapping = clusterAtlas.getMapping()[nearestCluster.iconKey];
          if (mapping && mapping.width > 0 && mapping.height > 0) {
            const renderedH = CLUSTER_SYMBOL_SIZE * Math.sqrt(mapping.height / mapping.width);
            const renderedW = CLUSTER_SYMBOL_SIZE * Math.sqrt(mapping.width / mapping.height);
            sizePixels = Math.max(renderedW, renderedH);
            const renderedAnchorX = (mapping.anchorX / mapping.width) * renderedW;
            const renderedAnchorY = (mapping.anchorY / mapping.height) * renderedH;
            offsetX = renderedW / 2 - renderedAnchorX;
            offsetY = renderedH / 2 - renderedAnchorY;
          } else {
            isValid = false;
            sizePixels = 0;
          }
        } else {
          const radius = nearestCluster.count < 100 ? 18 : nearestCluster.count < 1000 ? 22 : 26;
          const strokeWidth = 2;
          sizePixels = radius * 2 + strokeWidth;
        }

        if (isValid) {
          selectionData = {
            entity: {
              ...entity,
              position: { lat: nearestCluster.lat, lng: nearestCluster.lng },
            },
            sizePixels,
            offsetX,
            offsetY,
          };
        }
      }
    }
  }

  if (selectedId && !selectionData && entityMap.has(selectedId) && entityAtlas) {
    const entity = entityMap.get(selectedId)!;
    if (entity.symbol && !entity.shape) {
      const iconKey = entityAtlas.getOrCreate(entity.symbol);
      const overflow = entityAtlas.getOverflowData(entity.symbol) ?? undefined;
      const mapping = overflow ? null : entityAtlas.getMapping()[iconKey];
      const dims = overflow ?? mapping;

      if (dims && dims.width > 0 && dims.height > 0) {
        const renderedH = ICON_SIZE * Math.sqrt(dims.height / dims.width);
        const renderedW = ICON_SIZE * Math.sqrt(dims.width / dims.height);
        const renderedAnchorX = (dims.anchorX / dims.width) * renderedW;
        const renderedAnchorY = (dims.anchorY / dims.height) * renderedH;

        if (!renderedEntityIds.has(selectedId)) {
          renderEntities.push({
            entity,
            position: [entity.position.lng, entity.position.lat],
            iconKey,
            size: ICON_SIZE * Math.sqrt(dims.height / dims.width),
            overflow,
          });
        }

        selectionData = {
          entity,
          sizePixels: Math.max(renderedW, renderedH),
          offsetX: renderedW / 2 - renderedAnchorX,
          offsetY: renderedH / 2 - renderedAnchorY,
        };
      }
    }
  }

  const handleEntityClick = (info: PickingInfo): boolean => {
    if (!info.object) return false;
    const clicked = info.object as EntityRenderData;
    const clickedId = clicked.entity.id;

    // Collapsed assembly root: select it and expand to reveal children
    if (assemblyChildrenOf.has(clickedId) && !expandedAssemblies?.has(clickedId)) {
      onEntityClickRef.current?.(clickedId);
      onAssemblyExpandRef.current?.(clickedId);
      return true;
    }

    // If this entity is already spread, select it normally
    if (effectiveOverlapOffsets?.has(clickedId)) {
      onEntityClickRef.current?.(clickedId);
      return true;
    }

    const clickedKey = positionKey(clicked.position);
    const colocated = renderEntities.filter(
      (other) => other.entity.id !== clickedId && positionKey(other.position) === clickedKey,
    );

    if (colocated.length > 0) {
      const group = [clicked, ...colocated];
      const angleStep = (2 * Math.PI) / group.length;
      const newOffsets: OverlapOffsets = new Map();
      for (let i = 0; i < group.length; i++) {
        const angle = i * angleStep - Math.PI / 2;
        newOffsets.set(group[i]!.entity.id, [
          ASSEMBLY_RADIUS * Math.cos(angle),
          ASSEMBLY_RADIUS * Math.sin(angle),
        ]);
      }
      onOverlapSpreadRef.current?.(newOffsets);
      return true;
    }

    onEntityClickRef.current?.(clickedId);
    return true;
  };

  const handleClusterClick = (info: PickingInfo): boolean => {
    if (!info.object) return false;
    const data = info.object as ClusterRenderData;
    onClusterClickRef.current?.(data.id, data.lat, data.lng, integerZoom + 2);
    return true;
  };

  const handleAffiliationClusterClick = (info: PickingInfo): boolean => {
    if (info.index < 0) return false;
    const data = affiliationClusters[info.index];
    if (!data) return false;
    onClusterClickRef.current?.(data.id, data.lat, data.lng, integerZoom + 2);
    return true;
  };

  const textureParameters = {
    minFilter: "linear" as const,
    magFilter: "linear" as const,
    mipmapFilter: "linear" as const,
  };

  const fallbackEntities = effectiveOverlapOffsets
    ? renderEntities.filter((e) => !effectiveOverlapOffsets.has(e.entity.id))
    : renderEntities;
  const entityFallbackLayer = new ScatterplotLayer<EntityRenderData>({
    id: "entity-fallback-dots",
    data: fallbackEntities,
    visible: fallbackEntities.length > 0,
    getPosition: (d) => d.position,
    getRadius: 4,
    radiusUnits: "pixels",
    getFillColor: (d) => getAffiliationColorRGBA(d.entity.affiliation),
    pickable: false,
  });

  const atlasEntities = renderEntities.filter((e) => !e.overflow);
  const overflowEntities = renderEntities.filter((e) => e.overflow);

  const entityAtlasData = entityAtlas?.getImageData();
  const entityAtlasMapping = entityAtlas?.getMapping() ?? {};
  const clusterAtlasData = clusterAtlas?.getImageData();
  const clusterAtlasMapping = clusterAtlas?.getMapping() ?? {};

  const connectorLayer = new IconLayer<ConnectorLine>({
    id: "assembly-connectors",
    data: connectorLines,
    visible: connectorLines.length > 0,
    getPosition: (d) => d.position,
    getPixelOffset: (d) => d.offset,
    getIcon: () => CONNECTOR_ICON,
    getSize: CONNECTOR_H,
    sizeUnits: "pixels",
    getAngle: (d) => -d.angle,
    pickable: false,
    updateTriggers: {
      getPosition: version,
      getPixelOffset: effectiveOverlapOffsets,
      getAngle: effectiveOverlapOffsets,
    },
  });

  const layers: Layer[] = [
    entityFallbackLayer,
    connectorLayer,
    ...(!entityAtlasData
      ? []
      : [
          new IconLayer<EntityRenderData>({
            id: "entities",
            data: atlasEntities,
            visible: atlasEntities.length > 0,
            getPosition: (d) => d.position,
            getPixelOffset: (d) => effectiveOverlapOffsets?.get(d.entity.id) ?? ZERO_OFFSET,
            iconAtlas: entityAtlasData as unknown as string,
            iconMapping: entityAtlasMapping,
            getIcon: (d) => d.iconKey,
            getSize: (d) => d.size,
            sizeUnits: "pixels",
            sizeMinPixels: ICON_SIZE_MIN_PIXELS,
            sizeMaxPixels: ICON_SIZE_MAX_PIXELS,
            pickable,
            autoHighlight: true,
            highlightColor: [59, 130, 246, 80],
            onClick: handleEntityClick,
            onIconError: (error) => console.error("[IconLayer] ICON ERROR:", error),
            alphaCutoff: 0.001,
            textureParameters,
            updateTriggers: {
              getIcon: atlasVersion,
              getPixelOffset: effectiveOverlapOffsets,
            },
            parameters: {
              depthCompare: "always",
              depthWriteEnabled: false,
            },
          }),
        ]),
    new IconLayer<EntityRenderData>({
      id: "entities-overflow",
      data: overflowEntities,
      visible: overflowEntities.length > 0,
      getPosition: (d) => d.position,
      getPixelOffset: (d) => effectiveOverlapOffsets?.get(d.entity.id) ?? ZERO_OFFSET,
      getIcon: (d) => ({
        url: d.overflow!.dataUrl,
        width: d.overflow!.width,
        height: d.overflow!.height,
        anchorX: d.overflow!.anchorX,
        anchorY: d.overflow!.anchorY,
      }),
      getSize: (d) => d.size,
      sizeUnits: "pixels",
      sizeMinPixels: ICON_SIZE_MIN_PIXELS,
      sizeMaxPixels: ICON_SIZE_MAX_PIXELS,
      pickable,
      autoHighlight: true,
      highlightColor: [59, 130, 246, 80],
      onClick: handleEntityClick,
      onIconError: (error) => console.error("[IconLayer] OVERFLOW ICON ERROR:", error),
      alphaCutoff: 0.001,
      textureParameters,
      updateTriggers: {
        getPixelOffset: effectiveOverlapOffsets,
      },
      parameters: {
        depthCompare: "always",
        depthWriteEnabled: false,
      },
    }),
    ...(!clusterAtlasData
      ? []
      : [
          new IconLayer<ClusterRenderData>({
            id: "symbol-clusters",
            data: symbolClusters,
            visible: symbolClusters.length > 0,
            getPosition: (d) => d.position,
            iconAtlas: clusterAtlasData as unknown as string,
            iconMapping: clusterAtlasMapping,
            getIcon: (d) => d.iconKey!,
            getSize: (d) => d.size!,
            sizeUnits: "pixels",
            sizeMinPixels: ICON_SIZE_MIN_PIXELS,
            sizeMaxPixels: ICON_SIZE_MAX_PIXELS,
            pickable,
            autoHighlight: true,
            highlightColor: [59, 130, 246, 80],
            onClick: handleClusterClick,
            onIconError: (error) => console.error("[IconLayer] CLUSTER ICON ERROR:", error),
            alphaCutoff: 0.001,
            textureParameters,
            updateTriggers: {
              getIcon: atlasVersion,
            },
            parameters: {
              depthCompare: "always",
              depthWriteEnabled: false,
            },
          }),
        ]),
    new IconLayer<ClusterRenderData>({
      id: "symbol-clusters-overflow",
      data: overflowClusters,
      visible: overflowClusters.length > 0,
      getPosition: (d) => d.position,
      getIcon: (d) => ({
        url: d.overflow!.dataUrl,
        width: d.overflow!.width,
        height: d.overflow!.height,
        anchorX: d.overflow!.anchorX,
        anchorY: d.overflow!.anchorY,
      }),
      getSize: (d) => d.size!,
      sizeUnits: "pixels",
      sizeMinPixels: ICON_SIZE_MIN_PIXELS,
      sizeMaxPixels: ICON_SIZE_MAX_PIXELS,
      pickable,
      autoHighlight: true,
      highlightColor: [59, 130, 246, 80],
      onClick: handleClusterClick,
      onIconError: (error) => console.error("[IconLayer] OVERFLOW CLUSTER ICON ERROR:", error),
      alphaCutoff: 0.001,
      textureParameters,
      parameters: {
        depthCompare: "always",
        depthWriteEnabled: false,
      },
    }),
    new TextLayer<ClusterRenderData>({
      id: "cluster-badges",
      data: badgeClusters,
      visible: badgeClusters.length > 0,
      getPosition: (d) => d.position,
      getText: (d) => (d.count < 1000 ? String(d.count) : `${Math.round(d.count / 1000)}k`),
      getPixelOffset: (d) => d.pixelOffset,
      ...BADGE_TEXT_STYLE,
    }),
    new TextLayer<OverlapBadge>({
      id: "overlap-badges",
      data: overlapBadges,
      visible: overlapBadges.length > 0,
      getPosition: (d) => d.position,
      getText: (d) => String(d.count),
      getPixelOffset: (d) => d.pixelOffset,
      ...BADGE_TEXT_STYLE,
    }),
    new ScatterplotLayer({
      id: "affiliation-clusters",
      data: {
        length: affiliationClusters.length,
        attributes: {
          getPosition: { value: affClusterPositions, size: 2 },
          getRadius: { value: affClusterRadii, size: 1 },
          getLineColor: { value: affClusterLineColors, size: 4, normalized: true },
        },
      },
      visible: affiliationClusters.length > 0,
      radiusUnits: "pixels",
      filled: true,
      getFillColor: CLUSTER_BG,
      stroked: true,
      lineWidthMinPixels: 2,
      pickable,
      autoHighlight: true,
      highlightColor: [59, 130, 246, 80],
      onClick: handleAffiliationClusterClick,
    }),
    new TextLayer<ClusterRenderData>({
      id: "affiliation-cluster-labels",
      data: affiliationClusters,
      visible: affiliationClusters.length > 0,
      getPosition: (d) => d.position,
      getText: (d) => (d.count < 1000 ? String(d.count) : `${Math.round(d.count / 1000)}k`),
      getSize: 12,
      getColor: (d) => d.textColor,
      getTextAnchor: "middle",
      getAlignmentBaseline: "center",
      fontFamily: "Inter, system-ui, sans-serif",
      fontWeight: "500",
      fontSettings: { sdf: true, fontSize: 64, buffer: 8, radius: 16, cutoff: 0.2 },
      outlineWidth: 2,
      outlineColor: [0, 0, 0, 255],
      pickable: false,
    }),
  ];

  // Apply pixel offsets to spread labels, hide stacked (non-spread) labels
  const MAX_SPREAD_LABEL_LENGTH = 20;
  for (let i = labelData.length - 1; i >= 0; i--) {
    const label = labelData[i]!;
    const offset = effectiveOverlapOffsets?.get(label.id);
    if (offset) {
      label.pixelOffset = offset;
      if (label.label.length > MAX_SPREAD_LABEL_LENGTH) {
        label.label = label.label.slice(0, MAX_SPREAD_LABEL_LENGTH) + "...";
      }
    } else if (stackedEntityIds.has(label.id)) {
      labelData.splice(i, 1);
    }
  }

  return { layers, selectionData, labelData, coverageEntities };
}
