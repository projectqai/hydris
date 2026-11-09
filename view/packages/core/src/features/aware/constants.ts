export const COLLAPSE_FADE_START = 0.1;
export const SIZE_COLLAPSED = 30;
export const SIZE_COLLAPSE_FADE = 80;
export const STORAGE_KEY = "@hydris/layout";
export const PERSIST_DEBOUNCE_MS = 500;

export const Z = {
  DROP_ZONE: 110,
  PALETTE: 100,
  WIDGET_PICKER: 90,
  SCREEN_LOCK: 70,
  FLOATING_WINDOW: 60,
  TOPBAR: 50,
  SWAP_OVERLAY: 25,
  COLLAPSED: 20,
  HEADER: 10,
} as const;

// feature flag: hides the shape drawing tools in map controls
export const FEATURE_SHAPE_DRAWING = false;
