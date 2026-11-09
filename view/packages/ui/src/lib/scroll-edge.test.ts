import { describe, expect, it } from "vitest";

import { edgeOpacity } from "./scroll-edge";

const MIDWAY = { offset: 137, viewport: 412, content: 1290 };

const FITS = { offset: 0, viewport: 412, content: 389 };

const FADE_DISTANCE = 12;

describe("edgeOpacity in auto", () => {
  it("hides both edges when the content fits the viewport", () => {
    expect(edgeOpacity("start", "auto", FITS, FADE_DISTANCE)).toBe(0);
    expect(edgeOpacity("end", "auto", FITS, FADE_DISTANCE)).toBe(0);
  });

  it("shows only the end edge at the start of overflowing content", () => {
    const atStart = { ...MIDWAY, offset: 0 };

    expect(edgeOpacity("start", "auto", atStart, FADE_DISTANCE)).toBe(0);
    expect(edgeOpacity("end", "auto", atStart, FADE_DISTANCE)).toBe(1);
  });

  it("shows both edges fully while content is hidden on both sides", () => {
    expect(edgeOpacity("start", "auto", MIDWAY, FADE_DISTANCE)).toBe(1);
    expect(edgeOpacity("end", "auto", MIDWAY, FADE_DISTANCE)).toBe(1);
  });

  it("fades each edge in with the distance scrolled past it", () => {
    const nearStart = { ...MIDWAY, offset: 4 };
    const nearEnd = { ...MIDWAY, offset: MIDWAY.content - MIDWAY.viewport - 7 };

    expect(edgeOpacity("start", "auto", nearStart, FADE_DISTANCE)).toBeCloseTo(0.25);
    expect(edgeOpacity("end", "auto", nearEnd, FADE_DISTANCE)).toBeCloseTo(0.5);
  });

  it("hides the end edge at the end despite fractional layout sizes", () => {
    const atEnd = { offset: 877.6667, viewport: 412.3333, content: 1290.5 };

    expect(edgeOpacity("start", "auto", atEnd, FADE_DISTANCE)).toBe(1);
    expect(edgeOpacity("end", "auto", atEnd, FADE_DISTANCE)).toBe(0);
  });

  it("hides both edges before the scroller is measured", () => {
    const unmeasured = { offset: 0, viewport: 0, content: 0 };

    expect(edgeOpacity("start", "auto", unmeasured, FADE_DISTANCE)).toBe(0);
    expect(edgeOpacity("end", "auto", unmeasured, FADE_DISTANCE)).toBe(0);
  });
});

describe("edgeOpacity when forced", () => {
  it("shows only the forced start edge, whatever the scroll", () => {
    expect(edgeOpacity("start", "start", FITS, FADE_DISTANCE)).toBe(1);
    expect(edgeOpacity("end", "start", MIDWAY, FADE_DISTANCE)).toBe(0);
  });

  it("shows only the forced end edge, whatever the scroll", () => {
    expect(edgeOpacity("end", "end", FITS, FADE_DISTANCE)).toBe(1);
    expect(edgeOpacity("start", "end", MIDWAY, FADE_DISTANCE)).toBe(0);
  });

  it("shows both edges when both are forced", () => {
    expect(edgeOpacity("start", "both", FITS, FADE_DISTANCE)).toBe(1);
    expect(edgeOpacity("end", "both", FITS, FADE_DISTANCE)).toBe(1);
  });
});
