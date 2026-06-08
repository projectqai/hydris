// Stable metric ids the dongle plugin publishes. The sensor widget picks
// dose rate and accumulated dose from these; other radiation metrics still
// flow through the entity-details drill-down via the generic category widget.

export const RAD_DOSE_RATE_IDS: ReadonlySet<number> = new Set([1, 20]);
export const RAD_ACCUMULATED_IDS: ReadonlySet<number> = new Set([2, 21]);
