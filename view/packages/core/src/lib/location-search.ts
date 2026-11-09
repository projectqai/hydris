export type LocationResult = {
  place_id: number;
  display_name: string;
  lat: string;
  lon: string;
};

export async function searchLocations(
  query: string,
  signal: AbortSignal,
): Promise<LocationResult[]> {
  const res = await fetch(
    `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=5`,
    {
      headers: { "User-Agent": "HydrisApp/1.0", Accept: "application/json" },
      signal,
    },
  );

  if (!res.ok) throw new Error(`Search failed: ${res.status}`);

  return res.json();
}
