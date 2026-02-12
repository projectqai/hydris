import type { Feature, Point } from "geojson";
import Supercluster from "supercluster";

import type { Affiliation } from "../types";

const CLUSTER_RADIUS = 100;
const CLUSTER_MAX_ZOOM = 15;
const SYMBOL_CLUSTER_MIN_ZOOM = 13;
const AFFILIATION_CLUSTER_MIN_ZOOM = 10;
const CLUSTER_NODE_SIZE = 128;

export const AFFILIATION_CODE = {
  blue: 0,
  red: 1,
  neutral: 2,
  unknown: 3,
} as const satisfies Record<Affiliation, number>;

type AffiliationCode = (typeof AFFILIATION_CODE)[Affiliation];

const AFFILIATION_NAME = [
  "blue",
  "red",
  "neutral",
  "unknown",
] as const satisfies readonly Affiliation[];

type ClusterProperties = {
  cluster: boolean;
  cluster_id?: number;
  point_count?: number;
  entityId?: string;
  affiliation?: Affiliation;
  symbol?: string;
};

export type PackedEntities = {
  positions: Float64Array;
  affiliations: Uint8Array;
  ids: string[];
  symbols: (string | null)[];
  count: number;
};

export type FilterInput = Record<Affiliation, boolean>;

export type ClusterOutput = {
  isCluster: boolean;
  lat: number;
  lng: number;
  clusterId?: number;
  count?: number;
  clusterKey?: string;
  entityId?: string;
  affiliation: Affiliation;
  symbol?: string;
};

type IndexType = "all" | "affiliation" | "symbol";

function getTargetIndexType(zoom: number): IndexType {
  if (zoom >= SYMBOL_CLUSTER_MIN_ZOOM) return "symbol";
  if (zoom >= AFFILIATION_CLUSTER_MIN_ZOOM) return "affiliation";
  return "all";
}

function affiliationAt(code: AffiliationCode): Affiliation {
  return AFFILIATION_NAME[code];
}

function makeFeature(
  packed: PackedEntities,
  i: number,
  affiliation: Affiliation,
): Feature<Point, ClusterProperties> {
  const lng = packed.positions[i * 2 + 1] as number;
  const lat = packed.positions[i * 2] as number;
  return {
    type: "Feature",
    geometry: { type: "Point", coordinates: [lng, lat] },
    properties: {
      cluster: false,
      entityId: packed.ids[i],
      affiliation,
      symbol: packed.symbols[i] ?? undefined,
    },
  };
}

export function createClusterEngine() {
  let clusterAll: Supercluster<ClusterProperties, object> | null = null;
  let clustersByAffiliation = new Map<
    Affiliation,
    Supercluster<ClusterProperties, { affiliation?: Affiliation }>
  >();
  let clustersBySymbol = new Map<string, Supercluster<ClusterProperties, { symbol?: string }>>();
  let activeIndexType: IndexType | null = null;

  function buildIndices(packed: PackedEntities, filter: FilterInput, targetIndexType: IndexType) {
    const { count } = packed;

    if (targetIndexType === "symbol") {
      const featuresBySymbol = new Map<string, Feature<Point, ClusterProperties>[]>();
      for (let i = 0; i < count; i++) {
        const aff = affiliationAt(packed.affiliations[i] as AffiliationCode);
        if (!filter[aff]) continue;
        const sym = packed.symbols[i];
        if (!sym) continue;
        const list = featuresBySymbol.get(sym) ?? [];
        list.push(makeFeature(packed, i, aff));
        featuresBySymbol.set(sym, list);
      }

      clustersBySymbol = new Map();
      for (const [symbol, features] of featuresBySymbol) {
        const cluster = new Supercluster<ClusterProperties, { symbol?: string }>({
          radius: CLUSTER_RADIUS,
          maxZoom: CLUSTER_MAX_ZOOM,
          minPoints: 3,
          nodeSize: CLUSTER_NODE_SIZE,
          map: (p) => ({ symbol: p.symbol }),
          reduce: (acc, p) => {
            acc.symbol = p.symbol;
          },
        });
        cluster.load(features);
        clustersBySymbol.set(symbol, cluster);
      }
    } else if (targetIndexType === "affiliation") {
      const featuresByAff = new Map<Affiliation, Feature<Point, ClusterProperties>[]>();
      for (let i = 0; i < count; i++) {
        const aff = affiliationAt(packed.affiliations[i] as AffiliationCode);
        if (!filter[aff]) continue;
        if (!packed.symbols[i]) continue;
        const list = featuresByAff.get(aff) ?? [];
        list.push(makeFeature(packed, i, aff));
        featuresByAff.set(aff, list);
      }

      clustersByAffiliation = new Map();
      for (const [affiliation, features] of featuresByAff) {
        const cluster = new Supercluster<ClusterProperties, { affiliation?: Affiliation }>({
          radius: CLUSTER_RADIUS,
          maxZoom: SYMBOL_CLUSTER_MIN_ZOOM - 1,
          minPoints: 3,
          nodeSize: CLUSTER_NODE_SIZE,
          map: (p) => ({ affiliation: p.affiliation }),
          reduce: (acc, p) => {
            acc.affiliation = p.affiliation;
          },
        });
        cluster.load(features);
        clustersByAffiliation.set(affiliation, cluster);
      }
    } else {
      const features: Feature<Point, ClusterProperties>[] = [];
      for (let i = 0; i < count; i++) {
        const aff = affiliationAt(packed.affiliations[i] as AffiliationCode);
        if (!filter[aff]) continue;
        if (!packed.symbols[i]) continue;
        features.push(makeFeature(packed, i, aff));
      }

      clusterAll = new Supercluster<ClusterProperties, object>({
        radius: CLUSTER_RADIUS,
        maxZoom: AFFILIATION_CLUSTER_MIN_ZOOM - 1,
        minPoints: 3,
        nodeSize: CLUSTER_NODE_SIZE,
      });
      clusterAll.load(features);
    }

    activeIndexType = targetIndexType;
  }

  function getClusters(zoom: number): ClusterOutput[] {
    const integerZoom = Math.floor(zoom);
    const worldBounds: [number, number, number, number] = [-180, -85, 180, 85];
    const targetIndexType = getTargetIndexType(integerZoom);

    type FeatureWithSymbol = Feature<Point, ClusterProperties> & { _sourceSymbol?: string };
    let features: FeatureWithSymbol[] = [];

    if (targetIndexType === "symbol") {
      for (const [symbol, cluster] of clustersBySymbol.entries()) {
        for (const f of cluster.getClusters(worldBounds, integerZoom)) {
          (f as FeatureWithSymbol)._sourceSymbol = symbol;
          features.push(f as FeatureWithSymbol);
        }
      }
    } else if (targetIndexType === "affiliation") {
      features = [...clustersByAffiliation.values()].flatMap((c) =>
        c.getClusters(worldBounds, integerZoom),
      );
    } else if (clusterAll) {
      features = clusterAll.getClusters(worldBounds, integerZoom);
    }

    const results: ClusterOutput[] = [];

    for (const feature of features) {
      const coords = feature.geometry.coordinates as [number, number];
      const [lng, lat] = coords;
      const props = feature.properties;
      const sourceSymbol = feature._sourceSymbol;

      if (props.cluster) {
        const symbolForCluster = sourceSymbol ?? props.symbol;
        const clusterKey =
          targetIndexType === "symbol"
            ? (symbolForCluster ?? "unknown")
            : targetIndexType === "affiliation"
              ? (props.affiliation ?? "unknown")
              : "all";

        results.push({
          isCluster: true,
          lat,
          lng,
          clusterId: props.cluster_id,
          count: props.point_count ?? 0,
          clusterKey,
          affiliation: props.affiliation ?? "unknown",
          symbol: targetIndexType === "symbol" ? symbolForCluster : undefined,
        });
      } else {
        results.push({
          isCluster: false,
          lat,
          lng,
          entityId: props.entityId,
          affiliation: props.affiliation ?? "unknown",
          symbol: props.symbol,
        });
      }
    }

    return results;
  }

  let lastFilter: FilterInput | null = null;

  function process(
    packed: PackedEntities,
    filter: FilterInput,
    zoom: number,
    geoChanged: boolean,
  ): ClusterOutput[] {
    const targetIndexType = getTargetIndexType(Math.floor(zoom));
    const indexTypeChanged = targetIndexType !== activeIndexType;
    const filterChanged =
      !lastFilter ||
      filter.blue !== lastFilter.blue ||
      filter.red !== lastFilter.red ||
      filter.neutral !== lastFilter.neutral ||
      filter.unknown !== lastFilter.unknown;
    const needsRebuild =
      geoChanged || indexTypeChanged || filterChanged || activeIndexType === null;

    if (needsRebuild) {
      buildIndices(packed, filter, targetIndexType);
      lastFilter = { ...filter };
    }

    return getClusters(zoom);
  }

  return { process };
}
