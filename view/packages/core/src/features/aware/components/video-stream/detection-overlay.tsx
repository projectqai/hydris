import { computeScale } from "@hydris/ui/lib/widget-scale";
import { Fragment, useMemo, useState } from "react";
import type { LayoutChangeEvent } from "react-native";
import { Text, View } from "react-native";
import { useShallow } from "zustand/react/shallow";

import { isExpired } from "../../../../lib/api/use-track-utils";
import { selectDetectionsByDetector, useEntityStore } from "../../store/entity-store";

type DetectionOverlayProps = {
  cameraEntityId: string;
  objectFit?: "contain" | "cover";
};

const BOX_COLOR = "#00ff00";
const LABEL_BG = "rgba(0,0,0,0.6)";
const BORDER_WIDTH = 1.5;
const LABEL_GAP = 2;
const LABEL_FLIP_THRESHOLD = 16;
const LABEL_FONT_SIZE = 12;
const LABEL_FONT_MIN = 9;

function computeContentFit(
  containerW: number,
  containerH: number,
  frameW: number,
  frameH: number,
  fit: "contain" | "cover",
): { offsetX: number; offsetY: number; scale: number } {
  const containerAR = containerW / containerH;
  const frameAR = frameW / frameH;

  let scale: number;
  if (fit === "contain") {
    scale = containerAR > frameAR ? containerH / frameH : containerW / frameW;
  } else {
    scale = containerAR > frameAR ? containerW / frameW : containerH / frameH;
  }

  return {
    offsetX: (containerW - frameW * scale) / 2,
    offsetY: (containerH - frameH * scale) / 2,
    scale,
  };
}

export function DetectionOverlay({ cameraEntityId, objectFit = "cover" }: DetectionOverlayProps) {
  const [size, setSize] = useState({ width: 0, height: 0 });

  const detections = useEntityStore(useShallow(selectDetectionsByDetector(cameraEntityId)));

  const handleLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setSize((prev) => (prev.width === width && prev.height === height ? prev : { width, height }));
  };

  const boxes = useMemo(() => {
    if (size.width === 0 || size.height === 0) return [];

    return detections.flatMap((det) => {
      const bbox = det.detection?.imageBbox;
      if (!bbox?.frameWidth || !bbox.frameHeight) return [];

      if (isExpired(det)) return [];

      const { offsetX, offsetY, scale } = computeContentFit(
        size.width,
        size.height,
        bbox.frameWidth,
        bbox.frameHeight,
        objectFit,
      );
      const top = offsetY + bbox.y * scale;
      const confidence = det.detection?.confidence;

      return [
        {
          id: det.id,
          left: offsetX + bbox.x * scale,
          top,
          width: bbox.width * scale,
          height: bbox.height * scale,
          labelBelow: top < LABEL_FLIP_THRESHOLD,
          text:
            det.label && confidence != null
              ? `${det.label} ${Math.round(confidence * 100)}%`
              : det.label,
        },
      ];
    });
  }, [detections, size, objectFit]);

  // derive the label size from the same measured container the boxes use, so
  // it shrinks with small camera tiles instead of overpowering the frame.
  const labelFontSize = useMemo(
    () =>
      Math.max(
        LABEL_FONT_MIN,
        Math.round(LABEL_FONT_SIZE * computeScale(size.width, size.height).body),
      ),
    [size],
  );

  return (
    <View pointerEvents="none" className="absolute inset-0 overflow-hidden" onLayout={handleLayout}>
      {boxes.map((box) => (
        <Fragment key={box.id}>
          <View
            style={{
              position: "absolute",
              left: box.left,
              top: box.top,
              width: box.width,
              height: box.height,
              borderWidth: BORDER_WIDTH,
              borderColor: BOX_COLOR,
            }}
          />
          {box.text ? (
            // label lives at the overlay layer, not inside the box, so its width
            // is bounded by the video edge rather than the (often narrow) box.
            // matches web: full text, clipped only where it runs off the frame.
            <View
              style={{
                position: "absolute",
                left: box.left - BORDER_WIDTH,
                ...(box.labelBelow
                  ? { top: box.top + box.height + LABEL_GAP }
                  : { bottom: size.height - box.top + LABEL_GAP }),
                backgroundColor: LABEL_BG,
                paddingHorizontal: 3,
                paddingVertical: 1,
              }}
            >
              <Text
                numberOfLines={1}
                style={{ color: BOX_COLOR, fontFamily: "monospace", fontSize: labelFontSize }}
              >
                {box.text}
              </Text>
            </View>
          ) : null}
        </Fragment>
      ))}
    </View>
  );
}
