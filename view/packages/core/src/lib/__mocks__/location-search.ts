import { fn } from "storybook/test";

import type * as real from "../location-search";

const PLACES: real.LocationResult[] = [
  { place_id: 1, display_name: "Berlin, Brandenburg, Germany", lat: "52.5170", lon: "13.3889" },
  {
    place_id: 2,
    display_name: "Bern, Bern-Mittelland, Switzerland",
    lat: "46.9481",
    lon: "7.4474",
  },
  { place_id: 3, display_name: "Bergen, Vestland, Norway", lat: "60.3943", lon: "5.3259" },
];

export const searchLocations = fn<typeof real.searchLocations>(async (query) => {
  const needle = query.trim().toLowerCase();

  return PLACES.filter((place) => place.display_name.toLowerCase().includes(needle));
}).mockName("searchLocations");
