const GOLDEN_ANGLE = 137.508;
const WCAG_AA = 5.0;
const SATURATION = 0.75;

// Relative luminance of bg-glass on each theme background
const BG_LUMINANCE = { dark: 0.015, light: 0.638 };

const FNV_OFFSET = 2166136261; // FNV-1a 32-bit
const FNV_PRIME = 16777619;

function sRGBtoLinear(value: number): number {
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

// Channel offsets R=0, G=8, B=4 per CSS Color Level 4 HSL→RGB
function hslToLuminance(hue: number, sat: number, light: number): number {
  const amount = sat * Math.min(light, 1 - light);
  const channel = (offset: number) => {
    const k = (offset + hue / 30) % 12;
    return light - amount * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return (
    0.2126 * sRGBtoLinear(channel(0)) +
    0.7152 * sRGBtoLinear(channel(8)) +
    0.0722 * sRGBtoLinear(channel(4))
  );
}

function contrastRatio(lum1: number, lum2: number): number {
  const [lighter, darker] = lum1 > lum2 ? [lum1, lum2] : [lum2, lum1];
  return (lighter + 0.05) / (darker + 0.05);
}

function accessibleLightness(hue: number, bgLuminance: number, isDark: boolean): number {
  let lower = isDark ? 0.5 : 0.05;
  let upper = isDark ? 0.95 : 0.5;
  for (let i = 0; i < 16; i++) {
    const mid = (lower + upper) / 2;
    if (contrastRatio(hslToLuminance(hue, SATURATION, mid), bgLuminance) >= WCAG_AA) {
      if (isDark) upper = mid;
      else lower = mid;
    } else {
      if (isDark) lower = mid;
      else upper = mid;
    }
  }
  return isDark ? upper : lower;
}

const cache = new Map<string, string>();

export function senderColor(name: string, isDark: boolean): string {
  const key = isDark ? `d\0${name}` : `l\0${name}`;
  const cached = cache.get(key);
  if (cached) return cached;

  let hash = FNV_OFFSET;
  for (let i = 0; i < name.length; i++) {
    hash ^= name.charCodeAt(i);
    hash = Math.imul(hash, FNV_PRIME);
  }

  const hue = ((hash >>> 0) * GOLDEN_ANGLE) % 360;
  const bgLum = isDark ? BG_LUMINANCE.dark : BG_LUMINANCE.light;
  const lightness = accessibleLightness(hue, bgLum, isDark);
  const color = `hsl(${hue}, ${SATURATION * 100}%, ${lightness * 100}%)`;

  cache.set(key, color);
  return color;
}
