/* eslint-disable react-compiler/react-compiler */
import { useEffect, useRef } from "react";

import { parseColor } from "./parse-color";

type VignetteGlowProps = {
  color: string;
  intensity: number;
};

const VERTEX_SHADER = `#version 300 es
in vec2 a_position;
void main() { gl_Position = vec4(a_position, 0.0, 1.0); }
`;

const FRAGMENT_SHADER = `#version 300 es
precision highp float;
uniform vec2 u_resolution;
uniform vec3 u_color;
uniform float u_intensity;
out vec4 fragColor;
void main() {
  vec2 pos = gl_FragCoord.xy;
  pos.y = u_resolution.y - pos.y;
  vec2 uv = pos / u_resolution;
  uv *= 1.0 - uv.yx;
  float vig = uv.x * uv.y * 15.0;
  vig = pow(vig, 0.25);
  float vignette = 1.0 - vig;
  fragColor = vec4(u_color * vignette * u_intensity, vignette * u_intensity);
}
`;

function compileShader(gl: WebGL2RenderingContext, type: number, source: string) {
  const shader = gl.createShader(type)!;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  return shader;
}

type GLState = {
  gl: WebGL2RenderingContext;
  resolutionLoc: WebGLUniformLocation;
  colorLoc: WebGLUniformLocation;
  intensityLoc: WebGLUniformLocation;
  draw: () => void;
};

export function VignetteGlow({ color, intensity }: VignetteGlowProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const glRef = useRef<GLState | null>(null);
  const propsRef = useRef({ color, intensity });
  propsRef.current = { color, intensity };

  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;
    const gl = canvas.getContext("webgl2", { preserveDrawingBuffer: true, alpha: true });
    if (!gl) return;

    const program = gl.createProgram()!;
    const vs = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
    const fs = compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    gl.useProgram(program);

    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
      gl.STATIC_DRAW,
    );
    const posLoc = gl.getAttribLocation(program, "a_position");
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    const resolutionLoc = gl.getUniformLocation(program, "u_resolution")!;
    const colorLoc = gl.getUniformLocation(program, "u_color")!;
    const intensityLoc = gl.getUniformLocation(program, "u_intensity")!;

    const draw = () => {
      const { color: c, intensity: i } = propsRef.current;
      if (i <= 0 || canvas.width === 0 || canvas.height === 0) return;
      const [r, g, b] = parseColor(c);
      gl.uniform2f(resolutionLoc, canvas.width, canvas.height);
      gl.uniform3f(colorLoc, r, g, b);
      gl.uniform1f(intensityLoc, i * 0.8);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    };

    glRef.current = { gl, resolutionLoc, colorLoc, intensityLoc, draw };

    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      const { width, height } = entry.contentRect;
      if (width === 0 || height === 0) return;
      const dpr = window.devicePixelRatio || 1;
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      gl.viewport(0, 0, canvas.width, canvas.height);
      draw();
    });
    observer.observe(container);

    return () => {
      observer.disconnect();
      gl.deleteShader(vs);
      gl.deleteShader(fs);
      gl.deleteProgram(program);
      gl.deleteBuffer(buffer);
    };
  }, []);

  useEffect(() => {
    glRef.current?.draw();
  }, [color, intensity]);

  if (intensity <= 0) return null;

  return (
    <div
      ref={containerRef}
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        pointerEvents: "none",
      }}
    >
      <canvas ref={canvasRef} style={{ width: "100%", height: "100%", display: "block" }} />
    </div>
  );
}
