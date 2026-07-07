// Base sizes (px at scale 1.0) every metric tile scales from, so the hero,
// rows, and gauge stay in proportion across tiles.
export const METRIC_TOKENS = {
  padding: 8,
  heroText: 36,
  unitText: 14,
  labelText: 14,
  headerText: 14,
  metaText: 13,
  supportingLabel: 14,
  supportingValue: 15,
  sectionGap: 6,
  rowGap: 6,
  rowPadding: 16,
  gaugeHeight: 5,
  gaugeIndicator: 16,
} as const;
