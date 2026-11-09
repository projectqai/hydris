export const CATEGORY_IDS = ["mission", "commands", "assets", "cameras", "tracks"] as const;
export type Category = (typeof CATEGORY_IDS)[number];

export type PageTab = "overview" | "metrics" | "status";

export type PaletteMode =
  | { kind: "root" }
  | { kind: "dimension"; dimension: string; dimensionLabel: string; category: Category }
  | { kind: "location-search" }
  | { kind: "config"; entityId?: string; focusCategory?: string; adding?: boolean }
  | { kind: "asset-readiness" }
  | { kind: "tracks" }
  | { kind: "asset"; entityId: string }
  | { kind: "command-group"; groupId: string; groupLabel: string; initialCommandId?: string }
  | { kind: "mission-health" }
  | { kind: "diagnostic-export" }
  | { kind: "mission-export" }
  | { kind: "sources" }
  | { kind: "source-services"; source: string }
  | { kind: "add-source-service"; source: string }
  | { kind: "source-service"; source: string; providerId: string; tab?: PageTab }
  | { kind: "camera"; entityId: string }
  | { kind: "device"; source?: string; entityId: string; tab?: PageTab }
  | { kind: "setup"; entityId: string; created?: boolean }
  | { kind: "settings"; entityId: string }
  | { kind: "other-services" }
  | { kind: "devices-without-service" };

export type PaletteState = {
  stack: PaletteMode[];
  query: string;
  queryStack: string[];
  activeCategory: Category;
};

export type PaletteAction =
  | { type: "push"; mode: PaletteMode }
  | { type: "replace"; mode: PaletteMode }
  | { type: "pop" }
  | { type: "popTo"; index: number }
  | { type: "setQuery"; query: string }
  | { type: "setCategory"; category: Category }
  | { type: "reset" };

export const initialPaletteState: PaletteState = {
  stack: [],
  query: "",
  queryStack: [],
  activeCategory: "mission",
};

export function paletteStateAt(mode: PaletteMode): PaletteState {
  return mode.kind === "root"
    ? initialPaletteState
    : { ...initialPaletteState, stack: [mode], queryStack: [""] };
}

export function paletteReducer(state: PaletteState, action: PaletteAction): PaletteState {
  switch (action.type) {
    case "push":
      return {
        ...state,
        stack: [...state.stack, action.mode],
        query: "",
        queryStack: [...state.queryStack, state.query],
      };
    case "replace":
      return { ...state, stack: [...state.stack.slice(0, -1), action.mode] };
    case "pop":
      return {
        ...state,
        stack: state.stack.slice(0, -1),
        query: state.queryStack.at(-1) ?? "",
        queryStack: state.queryStack.slice(0, -1),
      };
    case "popTo": {
      const i = action.index;
      const len = Math.max(i + 1, 0);
      return {
        ...state,
        stack: state.stack.slice(0, len),
        query:
          i < 0
            ? (state.queryStack[0] ?? "")
            : i + 1 < state.queryStack.length
              ? state.queryStack[i + 1]!
              : state.query,
        queryStack: state.queryStack.slice(0, len),
      };
    }
    case "setQuery":
      return {
        ...state,
        query: action.query,
        activeCategory: state.activeCategory,
      };
    case "setCategory":
      return { ...state, activeCategory: action.category };
    case "reset":
      return initialPaletteState;
  }
}

export function currentMode(state: PaletteState): PaletteMode {
  return state.stack.at(-1) ?? { kind: "root" };
}
