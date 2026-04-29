export const CATEGORY_IDS = ["commands", "assets", "cameras", "tracks"] as const;
export type Category = (typeof CATEGORY_IDS)[number];

export type PaletteMode =
  | { kind: "root" }
  | { kind: "dimension"; dimension: string; dimensionLabel: string; category: Category }
  | { kind: "entity-actions"; entityId: string; entityLabel: string }
  | { kind: "location-search" }
  | { kind: "config"; entityId?: string }
  | { kind: "command-group"; groupId: string; groupLabel: string; initialCommandId?: string };

export type PaletteState = {
  stack: PaletteMode[];
  query: string;
  queryStack: string[];
  activeCategory: Category;
};

export type PaletteAction =
  | { type: "push"; mode: PaletteMode }
  | { type: "pop" }
  | { type: "popTo"; index: number }
  | { type: "setQuery"; query: string }
  | { type: "setCategory"; category: Category }
  | { type: "reset" };

export const initialPaletteState: PaletteState = {
  stack: [],
  query: "",
  queryStack: [],
  activeCategory: "commands",
};

export function paletteReducer(state: PaletteState, action: PaletteAction): PaletteState {
  switch (action.type) {
    case "push":
      return {
        ...state,
        stack: [...state.stack, action.mode],
        query: "",
        queryStack: [...state.queryStack, state.query],
      };
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
