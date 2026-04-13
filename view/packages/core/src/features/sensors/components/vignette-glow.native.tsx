import { Canvas, Rect, Shader, Skia } from "@shopify/react-native-skia";
import { useRef, useState } from "react";
import { View } from "react-native";

import { parseColor } from "./parse-color";

type VignetteGlowProps = {
  color: string;
  intensity: number;
};

const vignetteShader = Skia.RuntimeEffect.Make(`
uniform vec2 resolution;
uniform vec3 color;
uniform float intensity;

half4 main(vec2 pos) {
  vec2 uv = pos / resolution;
  uv *= 1.0 - uv.yx;
  float vig = uv.x * uv.y * 15.0;
  vig = pow(vig, 0.25);
  float vignette = 1.0 - vig;
  return half4(color * vignette * intensity, vignette * intensity);
}
`);

export function VignetteGlow({ color, intensity }: VignetteGlowProps) {
  const dimensionsRef = useRef({ width: 400, height: 400 });
  const [, forceUpdate] = useState(0);

  if (!vignetteShader || intensity <= 0) return null;

  const uniforms = {
    resolution: [dimensionsRef.current.width, dimensionsRef.current.height],
    color: parseColor(color),
    intensity: intensity * 0.8,
  };

  return (
    <View
      className="pointer-events-none absolute inset-0"
      onLayout={(e) => {
        const { width, height } = e.nativeEvent.layout;
        const prev = dimensionsRef.current;
        if (prev.width !== width || prev.height !== height) {
          dimensionsRef.current = { width, height };
          forceUpdate((n) => n + 1);
        }
      }}
    >
      <Canvas style={{ width: dimensionsRef.current.width, height: dimensionsRef.current.height }}>
        <Rect x={0} y={0} width={dimensionsRef.current.width} height={dimensionsRef.current.height}>
          <Shader source={vignetteShader} uniforms={uniforms} />
        </Rect>
      </Canvas>
    </View>
  );
}
