import type { Feature, LineString, Point, Polygon } from "geojson";

export type ActiveSensorSector =
  | "north"
  | "south"
  | "west"
  | "east"
  | "north-east"
  | "north-west"
  | "south-west"
  | "south-east";

export type ActiveSensorSectors = Set<ActiveSensorSector>;

export interface CircleSector<T = string> {
  label: T;
  start: number;
  end: number;
}

export type GeoPosition = {
  lat: number;
  lng: number;
  alt?: number;
};

export type PathPoint =
  | { type: "coordinate"; position: GeoPosition }
  | { type: "entity"; entityId: string; lastKnownPosition?: GeoPosition };

export type DrawingKind = "circle" | "rectangle" | "freeform" | "rb-circle";

export type EditKind = DrawingKind | "range";

export type ShapeLineStyle = "solid" | "dashed" | "dotted";

export type ShapeGeometry =
  | {
      type: "polygon";
      outer: GeoPosition[];
      holes?: GeoPosition[][];
      lineStyle?: ShapeLineStyle;
      // A rim alone cannot distinguish a polar cap from its complementary region.
      enclosedPoles?: "north" | "south" | "both";
    }
  | { type: "polyline"; points: GeoPosition[]; lineStyle?: ShapeLineStyle }
  | { type: "point"; position: GeoPosition }
  | { type: "collection"; geometries: ShapeGeometry[] };

export type ShapeFeature = Feature<Polygon | LineString | Point, ShapeProperties>;

export type ShapeProperties = {
  id: string;
  color: [number, number, number];
  affiliation: Affiliation;
  lineStyle?: ShapeLineStyle;
  drawn?: boolean;
  collectionMember?: boolean;
  fillOnly?: boolean;
};

export type Affiliation = "blue" | "red" | "neutral" | "unknown" | "unclassified";

export type RGBA = [number, number, number, number];

export type ConnectorHealth = "healthy" | "degraded" | "failed";

export type MapLayer = {
  kind: "tiles" | "image";
  url: string;
  opacity: number;
  zIndex?: number;
  // bbox only when kind === "image"
  west?: number;
  south?: number;
  east?: number;
  north?: number;
};

export type EntityData = {
  id: string;
  position?: GeoPosition;
  velocityEnu?: { up: number };
  symbol?: string;
  label?: string;
  affiliation?: Affiliation;
  ellipseRadius?: number;
  trackHistoryId?: string;
  trackPredictionId?: string;
  activeSectors?: ActiveSensorSectors;
  shape?: ShapeGeometry;
  coverageEntityIds?: string[];
  parentEntityId?: string;
  assemblyParentId?: string;
  assemblyOutlineIds?: string[];
  isDetection?: boolean;
  isDrawn?: boolean;
  mapLayer?: MapLayer;
  health?: ConnectorHealth;
  pathPoints?: PathPoint[];
  pathKind?: EditKind;
  pathRings?: number;
  pathRadiusM?: number;
};

export type BaseLayer = "dark" | "satellite" | "street";

export type SceneMode = "2d" | "2.5d" | "3d";

export type EntityFilter = {
  tracks: {
    blue: boolean;
    red: boolean;
    neutral: boolean;
    unknown: boolean;
    unclassified: boolean;
  };
  sensors: Record<string, boolean>;
};
