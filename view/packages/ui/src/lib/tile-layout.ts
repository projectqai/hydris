import { useCallback, useState } from "react";

export type TileSize = { width: number; height: number };

// Raw size, not useMeasuredScale's scale factor: the fit needs the actual box.
export function useTileMeasure(): {
  size: TileSize;
  onLayout: (e: { nativeEvent: { layout: TileSize } }) => void;
} {
  const [size, setSize] = useState<TileSize>({ width: 0, height: 0 });
  const onLayout = useCallback((e: { nativeEvent: { layout: TileSize } }) => {
    const { width, height } = e.nativeEvent.layout;
    setSize((prev) =>
      Math.abs(prev.width - width) < 1 && Math.abs(prev.height - height) < 1
        ? prev
        : { width, height },
    );
  }, []);
  return { size, onLayout };
}

// heroBlock = headline height (number + label + gauge if present). the stacked
// fit subtracts it for the row budget. heroWidth is the estimated headline text
// width. split mode rejects tiers whose headline would overflow the hero column.
export type TileGeometry = {
  heroBlock: number;
  heroWidth?: number;
  row: number;
  rowGap: number;
  sectionGap: number;
};

export type TileFit<T> = { tier: T; wide: boolean; perPage: number };

// Arithmetic fit (React Native can't render-measure-retry): from each tier's
// closed-form geometry, pick the most spacious tier that still seats minRows.
// Tiers must be ordered most-spacious first.
export function chooseTileFit<T>(params: {
  width: number;
  height: number;
  rowCount: number;
  minRows: number;
  tiers: readonly T[];
  geometry: (tier: T) => TileGeometry;
  minSplitWidth?: number;
}): TileFit<T> {
  const { width, height, rowCount, minRows, tiers, geometry, minSplitWidth = 165 } = params;
  // single-row tiles only split when clearly wide. near-square reads better stacked
  const aspect = rowCount <= 1 ? 1.6 : 1.15;
  const wantWide = width >= height * aspect && width >= minSplitWidth;
  const need = Math.min(rowCount, minRows);
  const rowsThatFit = (tier: T, wide: boolean) => {
    const g = geometry(tier);
    const avail = wide ? height : height - g.heroBlock - g.sectionGap;
    const step = g.row + g.rowGap;
    return Math.max(0, Math.floor((avail + g.rowGap) / step));
  };
  // split reserves 2/5 of the width for the hero column
  const heroFitsSplit = (tier: T) => {
    const g = geometry(tier);
    return g.heroWidth === undefined || g.heroWidth <= ((width - g.sectionGap * 2) * 2) / 5;
  };
  const pick = (wide: boolean): TileFit<T> | null => {
    for (const tier of tiers) {
      if (wide && !heroFitsSplit(tier)) continue;
      const fit = rowsThatFit(tier, wide);
      if (fit >= need) return { tier, wide, perPage: Math.max(1, fit) };
    }
    return null;
  };
  const fit = (wantWide ? pick(true) : null) ?? pick(false);
  if (fit) return fit;
  const tier = tiers[tiers.length - 1]!;
  return { tier, wide: wantWide, perPage: rowsThatFit(tier, wantWide) };
}
