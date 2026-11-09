import type { BaseLayer, GeoPosition } from "../../types";
import { MAP_CENTER } from "./path-map-interaction";

const RETICLE_COLORS: Record<BaseLayer, { accent: string; shadow: string }> = {
  dark: { accent: "rgb(16, 185, 129)", shadow: "rgba(0, 0, 0, 0.85)" },
  satellite: { accent: "rgb(255, 255, 255)", shadow: "rgba(0, 0, 0, 0.85)" },
  street: { accent: "rgb(15, 23, 42)", shadow: "rgba(255, 255, 255, 0.9)" },
};

type CoordinateColors = { bg: string; border: string; text: string };

type CenterReticleProps = {
  baseLayer: BaseLayer;
  coordinateColors?: CoordinateColors;
  position: GeoPosition;
};

const RETICLE_SIZE = 48;
const DOT_SIZE = 6;

export function CenterReticle(props: CenterReticleProps) {
  const colors = RETICLE_COLORS[props.baseLayer];

  return (
    <div
      style={{
        position: "absolute",
        left: `${MAP_CENTER.x * 100}%`,
        top: `${MAP_CENTER.y * 100}%`,
        transform: "translate(-50%, -50%)",
        pointerEvents: "none",
        zIndex: 5,
      }}
    >
      <div
        style={{
          position: "relative",
          width: RETICLE_SIZE,
          height: RETICLE_SIZE,
          borderRadius: "50%",
          border: `2px solid ${colors.accent}`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          boxShadow: `0 0 14px ${colors.shadow}, 0 0 6px ${colors.shadow}`,
        }}
      >
        <div
          style={{
            width: DOT_SIZE,
            height: DOT_SIZE,
            borderRadius: "50%",
            backgroundColor: colors.accent,
            boxShadow: `0 0 5px ${colors.shadow}`,
          }}
        />
        <div
          style={{
            position: "absolute",
            top: "100%",
            left: "50%",
            transform: "translateX(-50%)",
            marginTop: 8,
            whiteSpace: "nowrap",
            backgroundColor: props.coordinateColors?.bg ?? "rgba(20, 20, 20, 0.9)",
            border: `1px solid ${props.coordinateColors?.border ?? "rgba(255, 255, 255, 0.12)"}`,
            borderRadius: 4,
            padding: "4px 8px",
            fontFamily: "monospace",
            fontSize: 11,
            color: props.coordinateColors?.text ?? "rgb(245, 245, 245)",
            textAlign: "center",
          }}
        >
          {props.position.lat.toFixed(6)}, {props.position.lng.toFixed(6)}
        </div>
      </div>
    </div>
  );
}
