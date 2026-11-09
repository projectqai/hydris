import { create } from "@bufbuild/protobuf";
import { drawingPreviewForPath } from "@hydris/map-engine/geometry/drawing-preview";
import type { MapPath } from "@hydris/map-engine/geometry/rendered-paths";
import { geodesicDistance } from "@hydris/map-engine/utils/geodesy";
import { EntitySchema } from "@projectqai/proto/world";
import { expect, it, vi } from "vitest";

vi.mock("../../../lib/api/world-client", () => ({ worldClient: {} }));

import { preparePathLayerData } from "../../../../../map-engine/src/layers/path-logic";
import { CONTROLLER_ID } from "../../../lib/api/controller-id";
import { writeDrawing, writeMetrics } from "../../../lib/api/write-drawing";
import { buildPathLayerData } from "./path-layer-data";
import { readDrawing } from "./transform-entities";

it("caps ring sets before their labelled ranges cease to be shortest geodesics", () => {
  // GeographicLib 2.0 WGS84: Direct at 37 degrees; the global cut-distance bound is pi * b.
  const maximumM = 19_970_326.371122573;
  const cases = [
    {
      centre: { lat: 70, lng: 21 },
      edge: { lat: 70.2379536280464, lng: 21.531663308914677 },
      radiusM: 33_350,
    },
    {
      centre: { lat: 0, lng: 99.963865 },
      edge: { lat: 49.46621870556641, lng: -141.69110820478988 },
      radiusM: 12_012_596.445,
    },
  ];
  for (const { centre, edge, radiusM } of cases) {
    const placed: MapPath = {
      id: "bounded-rings",
      kind: "rb-circle",
      points: [
        { type: "coordinate", position: centre },
        { type: "coordinate", position: edge },
      ],
      rings: 3,
    };
    const entity = create(EntitySchema, {
      id: placed.id,
      controller: { id: CONTROLLER_ID },
      shape: writeDrawing(placed.kind, placed.points, placed.rings),
      metric: writeMetrics(placed.kind, placed.points, placed.rings),
    });
    const saved = readDrawing(entity);
    if (!saved) throw new Error("Expected a saved ring set");
    for (const path of [placed, { id: placed.id, ...saved }]) {
      const data = buildPathLayerData(path, new Map(), new Map());
      const shape = drawingPreviewForPath({ ...data, zoom: 1 });
      if (shape?.type !== "collection") throw new Error("Expected rendered rings");
      expect(data.totals).toHaveLength(3);
      expect(shape.geometries).toHaveLength(3);
      for (const [index, geometry] of shape.geometries.entries()) {
        const total = data.totals[index];
        if (!total || geometry.type !== "polygon") throw new Error("Expected a labelled ring");
        const labelledM = Number.parseFloat(total.label.replaceAll(",", "")) * 1000;
        expect(geometry.outer[0]).toBeDefined();
        for (const point of [...geometry.outer, total.position]) {
          const shortestM = geodesicDistance(
            { latitude: centre.lat, longitude: centre.lng },
            { latitude: point.lat, longitude: point.lng },
          );
          expect(
            Math.abs(shortestM - labelledM),
            `${total.label} must equal its rendered shortest geodesic range within 5 m rounding`,
          ).toBeLessThanOrEqual(5.001);
        }
      }
      const expectedOuterM = Math.min(radiusM * 3, maximumM);
      const outer = data.totals.at(-1);
      if (!outer) throw new Error("Expected an outer ring label");
      expect(
        geodesicDistance(
          { latitude: centre.lat, longitude: centre.lng },
          { latitude: outer.position.lat, longitude: outer.position.lng },
        ),
      ).toBeCloseTo(expectedOuterM, 6);
    }
    const expectedSpacingM = Math.min(radiusM, maximumM / 3);
    const plane = entity.shape?.geometry?.planar?.plane;
    if (plane?.case !== "collection") throw new Error("Expected stored rings");
    for (const [index, ring] of plane.value.geometries.entries()) {
      if (ring.plane.case !== "circle") throw new Error("Expected a stored circle");
      expect(ring.plane.value.radiusM).toBeCloseTo(expectedSpacingM * (index + 1), 6);
    }
    const metrics = entity.metric?.metrics;
    expect(metrics?.find((metric) => metric.label === "Radius")?.val.value).toBeCloseTo(
      expectedSpacingM / 1000,
      8,
    );
    expect(metrics?.find((metric) => metric.label === "Outer Radius")?.val.value).toBeCloseTo(
      (expectedSpacingM * 3) / 1000,
      8,
    );
  }
});

it("aligns a segment label with its independently projected geodesic tangent", () => {
  const path = buildPathLayerData(
    {
      id: "off-axis-range",
      kind: "range",
      points: [
        { type: "coordinate", position: { lat: 70, lng: 21 } },
        { type: "coordinate", position: { lat: 73, lng: 37 } },
      ],
    },
    new Map(),
    new Map(),
  );
  const prepared = preparePathLayerData({ paths: [path], drawingId: null }, null);
  expect(prepared.segmentLabels).toHaveLength(1);
  const label = prepared.segmentLabels[0];
  if (!label) throw new Error("Expected a segment label");

  // GeographicLib 2.0 WGS84 positions 10 m either side of the midpoint, projected to Mercator.
  const tangentScreenDegrees = -31.04368274934582;
  const labelScreenDegrees = -label.angleDegrees;
  const orientationErrorDegrees = Math.abs(
    ((((labelScreenDegrees - tangentScreenDegrees) % 180) + 270) % 180) - 90,
  );
  expect(
    orientationErrorDegrees,
    "segment label orientation must agree with its geodesic tangent within 0.05 degrees",
  ).toBeLessThan(0.05);
});

it("keeps each ring distance on its rendered outline without a floating radius readout", () => {
  const path = buildPathLayerData(
    {
      id: "off-axis-rings",
      kind: "rb-circle",
      points: [
        { type: "coordinate", position: { lat: 70, lng: 21 } },
        {
          type: "coordinate",
          position: { lat: 70.2379536280464, lng: 21.531663308914677 },
        },
      ],
      rings: 3,
    },
    new Map(),
    new Map(),
  );
  const zoom = 7;
  const prepared = preparePathLayerData({ paths: [path], drawingId: null }, null, null, zoom);
  const shape = drawingPreviewForPath({ ...path, zoom });
  if (shape?.type !== "collection") throw new Error("Expected rendered rings");
  expect(shape.geometries).toHaveLength(3);
  const outlineVertices = shape.geometries.flatMap((geometry) =>
    geometry.type === "polygon" ? geometry.outer : [],
  );
  const projectedOutline = outlineVertices.map((position) => ({
    x: position.lng / 360,
    y: -Math.log(Math.tan(Math.PI / 4 + (position.lat * Math.PI) / 360)) / (2 * Math.PI),
  }));
  const labels = [
    ...prepared.segmentLabels.map((label) => ({ ...label, pixelOffset: [0, 0] })),
    ...prepared.totals.map(({ total, pixelOffset }) => ({ ...total, pixelOffset })),
  ];
  const worldPixels = 512 * 2 ** zoom;
  for (const label of labels) {
    const [offsetX, offsetY] = label.pixelOffset;
    if (offsetX === undefined || offsetY === undefined) throw new Error("Missing label offset");
    const x = label.position.lng / 360 + offsetX / worldPixels;
    const y =
      -Math.log(Math.tan(Math.PI / 4 + (label.position.lat * Math.PI) / 360)) / (2 * Math.PI) +
      offsetY / worldPixels;
    const nearestVertexPx =
      Math.min(...projectedOutline.map((vertex) => Math.hypot(x - vertex.x, y - vertex.y))) *
      worldPixels;
    expect(
      nearestVertexPx,
      `${label.label} must sit within 0.5 CSS px of a rendered ring vertex`,
    ).toBeLessThan(0.5);
  }

  // GeographicLib 2.0: Direct(70, 21, 37, 33350), with ring readouts at azimuth 180.
  const referenceLabels = [
    { label: "33.35 km GD", lat: 69.7010580687474 },
    { label: "66.70 km GD", lat: 69.40210588474784 },
    { label: "100.05 km GD", lat: 69.10314332324596 },
  ];
  expect(labels).toHaveLength(referenceLabels.length);
  for (const reference of referenceLabels) {
    const matching = labels.filter((label) => label.label === reference.label);
    expect(matching).toHaveLength(1);
    expect(matching[0]?.position.lat).toBeCloseTo(reference.lat, 8);
    expect(matching[0]?.position.lng).toBeCloseTo(21, 8);
  }
});
