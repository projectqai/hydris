import type { FilterInput, PackedEntities } from "./cluster-logic";
import { createClusterEngine } from "./cluster-logic";

const engine = createClusterEngine();

let lastPacked: PackedEntities | null = null;
let lastFilter: FilterInput | null = null;

addEventListener("message", (e: MessageEvent) => {
  const { zoom, version } = e.data;

  if ("positions" in e.data) {
    const { positions, affiliations, ids, symbols, count, filter, geoChanged } = e.data;
    lastPacked = { positions, affiliations, ids, symbols, count };
    lastFilter = filter;
    const clusters = engine.process(lastPacked, filter as FilterInput, zoom, geoChanged);
    postMessage({ clusters, version });
  } else if ("filter" in e.data && lastPacked) {
    const filter = e.data.filter as FilterInput;
    lastFilter = filter;
    const clusters = engine.process(lastPacked, filter, zoom, false);
    postMessage({ clusters, version });
  } else if (lastPacked && lastFilter) {
    const clusters = engine.process(lastPacked, lastFilter, zoom, false);
    postMessage({ clusters, version });
  }
});
