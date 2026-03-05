import type { PaletteMode } from "@hydris/ui/command-palette/palette-reducer";
import { createContext } from "react";

export type PaletteContextValue = { open(mode?: PaletteMode): void };

export const PaletteContext = createContext<PaletteContextValue>({ open: () => {} });
