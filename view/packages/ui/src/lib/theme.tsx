import { LinearGradient } from "expo-linear-gradient";
import { useColorScheme } from "nativewind";
import type { ComponentProps } from "react";

const DARK_GRADIENTS = {
  default: [
    "rgba(22, 22, 22, 0.98)",
    "rgba(24, 24, 24, 0.98)",
    "rgba(27, 27, 27, 0.98)",
    "rgba(30, 30, 30, 0.98)",
    "rgba(34, 34, 34, 0.98)",
  ],
  active: [
    "rgba(38, 38, 38, 0.98)",
    "rgba(41, 41, 41, 0.98)",
    "rgba(44, 44, 44, 0.98)",
    "rgba(47, 47, 47, 0.98)",
    "rgba(50, 50, 50, 0.98)",
  ],
  dense: [
    "rgba(22, 22, 22, 0.98)",
    "rgba(24, 24, 24, 0.98)",
    "rgba(27, 27, 27, 0.98)",
    "rgba(30, 30, 30, 0.98)",
    "rgba(34, 34, 34, 0.98)",
  ],
  card: [
    "rgba(27, 27, 27, 0.98)",
    "rgba(30, 30, 30, 0.98)",
    "rgba(33, 33, 33, 0.98)",
    "rgba(36, 36, 36, 0.98)",
    "rgba(39, 39, 39, 0.98)",
  ],
} as const;

const LIGHT_GRADIENTS = {
  default: [
    "rgba(233, 233, 234, 0.98)",
    "rgba(231, 231, 232, 0.98)",
    "rgba(229, 229, 230, 0.98)",
    "rgba(227, 227, 228, 0.98)",
    "rgba(225, 225, 227, 0.98)",
  ],
  active: [
    "rgba(219, 219, 221, 0.98)",
    "rgba(217, 217, 219, 0.98)",
    "rgba(215, 215, 217, 0.98)",
    "rgba(213, 213, 215, 0.98)",
    "rgba(211, 211, 213, 0.98)",
  ],
  dense: [
    "rgba(231, 231, 232, 0.98)",
    "rgba(229, 229, 230, 0.98)",
    "rgba(227, 227, 228, 0.98)",
    "rgba(225, 225, 227, 0.98)",
    "rgba(223, 223, 225, 0.98)",
  ],
  card: [
    "rgba(241, 241, 242, 0.98)",
    "rgba(239, 239, 241, 0.98)",
    "rgba(237, 237, 239, 0.98)",
    "rgba(235, 235, 237, 0.98)",
    "rgba(233, 233, 235, 0.98)",
  ],
} as const;

type ThemeColorValues = {
  background: string;
  foreground: string;
  card: string;
  muted: string;
  mutedForeground: string;
  border: string;
  iconActive: string;
  iconStrong: string;
  iconDefault: string;
  iconSubtle: string;
  iconMuted: string;
  backdrop: string;
  borderSubtle: string;
  borderFaint: string;
  borderMedium: string;
  surfaceInset: string;
  surfaceInsetSelected: string;
  placeholder: string;
  controlBg: string;
  controlBgHover: string;
  controlBorder: string;
  controlBorderHover: string;
  controlFg: string;
  controlFgActive: string;
  controlFgDisabled: string;
  controlTrackOff: readonly [string, string];
  controlTrackOn: readonly [string, string];
  controlInputBg: string;
  controlTextMuted: string;
  divider: string;
  dividerPill: string;
  topBarBg: string;
  topBarCustomizeBg: string;
  topBarBorderBottom: string;
  gradientOverlay: string;
  paneHeaderBg: string;
  switchTrackBg: string;
  switchTrackBorder: string;
  switchTrackInset: string;
  insetBg: string;
  insetBorder: string;
  insetHighlight: string;
  insetShadow: string;
  activeGreen: string;
  warning: string;
  destructiveRed: string;
  cardShadow: string;
  segmentBg: string;
  segmentShadow: string;
  tabIndicator: string;
  customizeAccent: string;
  customizeAccentSubtle: string;
  customizeSwapBorder: string;
  controlShadow: {
    color: string;
    offset: number;
    opacity: number;
    radius: number;
  };
  gradients: {
    default: readonly [string, string, ...string[]];
    active: readonly [string, string, ...string[]];
    dense: readonly [string, string, ...string[]];
    card: readonly [string, string, ...string[]];
  };
};

const THEME_COLORS: Record<"dark" | "light", ThemeColorValues> = {
  dark: {
    background: "rgb(22, 22, 22)",
    foreground: "rgb(220, 220, 220)",
    card: "rgb(27, 27, 27)",
    muted: "rgb(33, 33, 33)",
    mutedForeground: "rgb(153, 153, 153)",
    border: "rgb(60, 60, 60)",
    iconActive: "rgba(255, 255, 255, 1)",
    iconStrong: "rgba(255, 255, 255, 0.9)",
    iconDefault: "rgba(255, 255, 255, 0.7)",
    iconSubtle: "rgba(255, 255, 255, 0.6)",
    iconMuted: "rgba(255, 255, 255, 0.5)",
    backdrop: "rgba(0, 0, 0, 0.75)",
    borderSubtle: "rgba(255, 255, 255, 0.08)",
    borderFaint: "rgba(255, 255, 255, 0.03)",
    borderMedium: "rgba(255, 255, 255, 0.12)",
    surfaceInset: "rgba(255, 255, 255, 0.04)",
    surfaceInsetSelected: "rgba(0, 0, 0, 0.3)",
    placeholder: "rgba(255, 255, 255, 0.4)",
    controlBg: "#222",
    controlBgHover: "#2a2a2e",
    controlBorder: "#27272a",
    controlBorderHover: "#3f3f46",
    controlFg: "rgb(163, 163, 163)",
    controlFgActive: "rgb(220, 220, 220)",
    controlFgDisabled: "rgb(113, 113, 113)",
    controlTrackOff: ["#52525b", "#3f3f46"],
    controlTrackOn: ["#e5e5e5", "#d4d4d4"],
    controlInputBg: "#09090b",
    controlTextMuted: "rgb(140, 140, 140)",
    divider: "rgb(0, 0, 0)",
    dividerPill: "rgba(255, 255, 255, 0.5)",
    topBarBg: "rgb(22, 22, 24)",
    topBarCustomizeBg: "rgb(36, 28, 18)",
    topBarBorderBottom: "rgba(0, 0, 0, 0.6)",
    gradientOverlay: "rgba(0, 0, 0, 0.6)",
    paneHeaderBg: "rgba(0, 0, 0, 0.80)",
    switchTrackBg: "#09090b",
    switchTrackBorder: "#27272a",
    switchTrackInset: "rgba(0, 0, 0, 0.5)",
    insetBg: "rgba(0, 0, 0, 0.35)",
    insetBorder: "rgba(0, 0, 0, 0.30)",
    insetHighlight: "rgba(255, 255, 255, 0.08)",
    insetShadow: "inset 0 1px 3px rgba(0,0,0,0.45)",
    activeGreen: "rgb(34, 197, 94)",
    warning: "rgb(249, 87, 56)",
    destructiveRed: "rgb(205, 24, 24)",
    cardShadow: "0 1px 4px rgba(0,0,0,0.40), 0 1px 2px rgba(0,0,0,0.30)",
    segmentBg: "rgb(50, 50, 52)",
    segmentShadow: "0 1px 2px rgba(0,0,0,0.3)",
    tabIndicator: "rgb(220, 220, 220)",
    customizeAccent: "rgb(245, 158, 11)",
    customizeAccentSubtle: "rgba(245, 158, 11, 0.25)",
    customizeSwapBorder: "rgb(245, 158, 11)",
    controlShadow: { color: "#000", offset: 1, opacity: 0.3, radius: 3 },
    gradients: DARK_GRADIENTS,
  },
  light: {
    background: "rgb(220, 220, 222)",
    foreground: "rgb(24, 24, 26)",
    card: "rgb(228, 228, 230)",
    muted: "rgb(202, 202, 206)",
    mutedForeground: "rgb(72, 72, 76)",
    border: "rgb(188, 188, 192)",
    iconActive: "rgba(0, 0, 0, 0.88)",
    iconStrong: "rgba(0, 0, 0, 0.75)",
    iconDefault: "rgba(0, 0, 0, 0.62)",
    iconSubtle: "rgba(0, 0, 0, 0.52)",
    iconMuted: "rgba(0, 0, 0, 0.45)",
    backdrop: "rgba(0, 0, 0, 0.45)",
    borderSubtle: "rgba(0, 0, 0, 0.09)",
    borderFaint: "rgba(0, 0, 0, 0.04)",
    borderMedium: "rgba(0, 0, 0, 0.15)",
    surfaceInset: "rgba(0, 0, 0, 0.10)",
    surfaceInsetSelected: "rgba(0, 0, 0, 0.15)",
    placeholder: "rgba(0, 0, 0, 0.45)",
    controlBg: "rgb(226, 226, 228)",
    controlBgHover: "rgb(216, 216, 218)",
    controlBorder: "rgb(180, 180, 184)",
    controlBorderHover: "rgb(148, 148, 152)",
    controlFg: "rgb(72, 72, 78)",
    controlFgActive: "rgb(24, 24, 26)",
    controlFgDisabled: "rgb(164, 164, 170)",
    controlTrackOff: ["#ffffff", "#f2f2f4"],
    controlTrackOn: ["#ffffff", "#f2f2f4"],
    controlInputBg: "rgb(240, 240, 242)",
    controlTextMuted: "rgb(84, 84, 90)",
    divider: "rgb(180, 180, 184)",
    dividerPill: "rgba(0, 0, 0, 0.25)",
    topBarBg: "rgb(222, 222, 224)",
    topBarCustomizeBg: "rgb(36, 28, 18)",
    topBarBorderBottom: "rgba(0, 0, 0, 0.12)",
    gradientOverlay: "rgba(240, 240, 242, 0.7)",
    paneHeaderBg: "rgba(222, 222, 224, 0.95)",
    switchTrackBg: "rgb(200, 200, 204)",
    switchTrackBorder: "rgb(180, 180, 184)",
    switchTrackInset: "rgba(0, 0, 0, 0.22)",
    insetBg: "rgba(0, 0, 0, 0.05)",
    insetBorder: "rgba(0, 0, 0, 0.06)",
    insetHighlight: "rgba(255, 255, 255, 0.60)",
    insetShadow: "inset 0 1px 3px rgba(0,0,0,0.12)",
    activeGreen: "rgb(40, 180, 99)",
    warning: "rgb(168, 52, 8)",
    destructiveRed: "rgb(190, 18, 18)",
    cardShadow: "0 1px 3px rgba(0,0,0,0.08), 0 1px 2px rgba(0,0,0,0.06)",
    segmentBg: "rgb(238, 238, 240)",
    segmentShadow: "0 1px 3px rgba(0,0,0,0.10), 0 1px 2px rgba(0,0,0,0.06)",
    tabIndicator: "rgb(72, 72, 76)",
    customizeAccent: "rgb(245, 158, 11)",
    customizeAccentSubtle: "rgba(245, 158, 11, 0.25)",
    customizeSwapBorder: "rgb(245, 158, 11)",
    controlShadow: { color: "#000", offset: 1, opacity: 0.15, radius: 4 },
    gradients: LIGHT_GRADIENTS,
  },
};

export type ThemeColors = ThemeColorValues;

export function useThemeColors(): ThemeColors {
  const { colorScheme } = useColorScheme();
  return THEME_COLORS[colorScheme ?? "dark"];
}

export const GRADIENT_PROPS = {
  locations: [0, 0.25, 0.5, 0.75, 1] as const,
  start: { x: 0, y: 0 },
  end: { x: 1, y: 1 },
};

type GradientVariant = keyof typeof DARK_GRADIENTS;

type GradientPanelProps = Omit<ComponentProps<typeof LinearGradient>, "colors"> & {
  variant?: GradientVariant;
};

export function GradientPanel({ variant = "default", children, ...props }: GradientPanelProps) {
  const t = useThemeColors();
  return (
    <LinearGradient colors={t.gradients[variant]} {...GRADIENT_PROPS} {...props}>
      {children}
    </LinearGradient>
  );
}
