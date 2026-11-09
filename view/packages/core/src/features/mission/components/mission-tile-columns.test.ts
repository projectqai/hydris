import { describe, expect, it } from "vitest";

import { fitColumns } from "./mission-tile-columns";

describe("fitColumns", () => {
  it("gives each tile its own column up to three before the grid is measured", () => {
    expect([1, 2, 3, 5].map((tiles) => fitColumns(tiles, 0))).toEqual([1, 2, 3, 3]);
  });

  it("lays four tiles out two by two, even where three columns fit", () => {
    expect(fitColumns(4, 0)).toBe(2);
    expect(fitColumns(4, 560)).toBe(2);
  });

  it("drops to the columns that fit the measured width", () => {
    expect(fitColumns(5, 560)).toBe(3);
    expect(fitColumns(5, 400)).toBe(2);
    expect(fitColumns(5, 340)).toBe(1);
  });

  it("never gives more columns than tiles in a wide grid", () => {
    expect(fitColumns(2, 900)).toBe(2);
  });

  it("keeps one column when not even one tile fits", () => {
    expect(fitColumns(3, 20)).toBe(1);
  });
});
