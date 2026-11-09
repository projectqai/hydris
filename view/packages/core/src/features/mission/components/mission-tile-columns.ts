export type Columns = 1 | 2 | 3;

const GRID_PADDING = 24;
const CELL_PADDING = 8;

const MIN_TILE_WIDTH = Math.floor((560 - GRID_PADDING) / 3) - CELL_PADDING;

const TWO_BY_TWO_TILE_COUNT = 4;

export function fitColumns(tileCount: number, width: number): Columns {
  const wanted = tileCount === TWO_BY_TWO_TILE_COUNT ? 2 : tileCount;
  const isMeasured = width > 0;

  const fitting = isMeasured
    ? Math.floor((width - GRID_PADDING) / (MIN_TILE_WIDTH + CELL_PADDING))
    : wanted;

  const columns = Math.min(wanted, fitting);

  if (columns >= 3) return 3;

  if (columns === 2) return 2;

  return 1;
}
