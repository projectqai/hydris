import type { Map as MapLibreMap } from "maplibre-gl";

import type { GeoPosition } from "../../types";
import { wrapLongitude } from "../../utils/geodesic-path";

type ScreenPoint = {
  x: number;
  y: number;
};

type DragCoordinate = {
  point: ScreenPoint;
  position: GeoPosition;
};

type SetupMapGestureDragOptions<T> = {
  map: MapLibreMap;
  hitTest: (point: ScreenPoint) => T | null;
  onTap: (target: T, coordinate: DragCoordinate) => void;
  onMove: (target: T, coordinate: DragCoordinate) => void;
  onRelease: (target: T, coordinate: DragCoordinate) => void;
};

const MOUSE_DRAG_SLOP_PX = 4;
const TOUCH_DRAG_SLOP_PX = 8;

export function setupMapGestureDrag<T>({
  map,
  hitTest,
  onTap,
  onMove,
  onRelease,
}: SetupMapGestureDragOptions<T>): () => void {
  const canvas = map.getCanvas();
  let active:
    | {
        pointerId: number;
        pointerType: string;
        target: T;
        startCoordinate: DragCoordinate;
        dragging: boolean;
      }
    | undefined;

  const coordinateFor = (event: PointerEvent): DragCoordinate => {
    const bounds = canvas.getBoundingClientRect();
    const point = { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
    const lngLat = map.unproject([point.x, point.y]);
    return { point, position: { lat: lngLat.lat, lng: wrapLongitude(lngLat.lng) } };
  };

  const handlePointerDown = (event: PointerEvent) => {
    if (active || (event.pointerType !== "touch" && event.button !== 0)) return;

    const coordinate = coordinateFor(event);
    const target = hitTest(coordinate.point);
    if (target === null) return;

    active = {
      pointerId: event.pointerId,
      pointerType: event.pointerType,
      target,
      startCoordinate: coordinate,
      dragging: false,
    };
    try {
      canvas.setPointerCapture(event.pointerId);
    } catch (error) {
      // Pointer capture throws NotFoundError when the pointer is not active.
      if (!(error instanceof DOMException) || error.name !== "NotFoundError") throw error;
    }
  };

  const handleMouseDown = (event: MouseEvent) => {
    if (!active || active.pointerType === "touch") return;
    // MapLibre starts panning from mouse/touch events, after the pointer event claims the drag.
    event.stopPropagation();
  };

  const handleTouchStart = (event: TouchEvent) => {
    if (!active || active.pointerType !== "touch") return;
    event.stopPropagation();
  };

  const handlePointerMove = (event: PointerEvent) => {
    if (!active || event.pointerId !== active.pointerId) return;
    const coordinate = coordinateFor(event);
    if (!active.dragging) {
      const slop = active.pointerType === "touch" ? TOUCH_DRAG_SLOP_PX : MOUSE_DRAG_SLOP_PX;
      const dx = coordinate.point.x - active.startCoordinate.point.x;
      const dy = coordinate.point.y - active.startCoordinate.point.y;
      if (dx * dx + dy * dy <= slop * slop) return;
      active.dragging = true;
    }
    onMove(active.target, coordinate);
  };

  const finish = (event: PointerEvent, cancelled: boolean) => {
    if (!active || event.pointerId !== active.pointerId) return;

    const { pointerId, target, startCoordinate, dragging } = active;
    active = undefined;
    if (canvas.hasPointerCapture(pointerId)) canvas.releasePointerCapture(pointerId);
    if (dragging) {
      onRelease(target, coordinateFor(event));
    } else if (!cancelled) {
      onTap(target, startCoordinate);
    }
  };

  const handlePointerUp = (event: PointerEvent) => finish(event, false);
  const handlePointerCancel = (event: PointerEvent) => finish(event, true);

  canvas.addEventListener("pointerdown", handlePointerDown, true);
  canvas.addEventListener("mousedown", handleMouseDown, true);
  canvas.addEventListener("touchstart", handleTouchStart, true);
  canvas.addEventListener("pointermove", handlePointerMove, true);
  canvas.addEventListener("pointerup", handlePointerUp, true);
  canvas.addEventListener("pointercancel", handlePointerCancel, true);

  return () => {
    if (active && canvas.hasPointerCapture(active.pointerId)) {
      canvas.releasePointerCapture(active.pointerId);
    }
    active = undefined;
    canvas.removeEventListener("pointerdown", handlePointerDown, true);
    canvas.removeEventListener("mousedown", handleMouseDown, true);
    canvas.removeEventListener("touchstart", handleTouchStart, true);
    canvas.removeEventListener("pointermove", handlePointerMove, true);
    canvas.removeEventListener("pointerup", handlePointerUp, true);
    canvas.removeEventListener("pointercancel", handlePointerCancel, true);
  };
}
