export function parseColor(color: string): [number, number, number] {
  const rgbMatch = /rgb\((\d+),\s*(\d+),\s*(\d+)\)/.exec(color);
  if (rgbMatch)
    return [Number(rgbMatch[1]) / 255, Number(rgbMatch[2]) / 255, Number(rgbMatch[3]) / 255];
  const hexMatch = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(color);
  if (hexMatch)
    return [
      parseInt(hexMatch[1]!, 16) / 255,
      parseInt(hexMatch[2]!, 16) / 255,
      parseInt(hexMatch[3]!, 16) / 255,
    ];
  return [1, 1, 1];
}
