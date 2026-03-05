import { useListNav } from "@hydris/ui/command-palette/use-list-nav";
import { EmptyState } from "@hydris/ui/empty-state";
import { useThemeColors } from "@hydris/ui/lib/theme";
import { cn } from "@hydris/ui/lib/utils";
import { FlashList } from "@shopify/flash-list";
import { MapPin } from "lucide-react-native";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";

import { mapEngineActions } from "../../../store/map-engine-store";

type LocationResult = {
  place_id: number;
  display_name: string;
  lat: string;
  lon: string;
};

const DEBOUNCE_MS = 300;

function formatResult(displayName: string): { primary: string; secondary: string } {
  const parts = displayName.split(",").map((s) => s.trim());
  const primary = parts[0] || displayName;
  const secondary = parts.slice(1, 3).join(", ");
  return { primary, secondary };
}

export function LocationSearchView({ query, onClose }: { query: string; onClose: () => void }) {
  const t = useThemeColors();
  const [results, setResults] = useState<LocationResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (!query.trim()) {
      setResults([]);
      setIsLoading(false);
      setError(null);
      return;
    }

    setIsLoading(true);
    debounceRef.current = setTimeout(() => {
      if (abortRef.current) abortRef.current.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      fetch(
        `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=5`,
        {
          headers: { "User-Agent": "HydrisApp/1.0", Accept: "application/json" },
          signal: controller.signal,
        },
      )
        .then((res) => {
          if (!res.ok) throw new Error(`Search failed: ${res.status}`);
          return res.json();
        })
        .then((data: LocationResult[]) => {
          setResults(data);
          setIsLoading(false);
          setError(null);
        })
        .catch((err) => {
          if (err instanceof Error && err.name === "AbortError") return;
          setError("Search failed");
          setResults([]);
          setIsLoading(false);
        });
    }, DEBOUNCE_MS);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  const handleActivate = (item: LocationResult) => {
    mapEngineActions.flyTo(parseFloat(item.lat), parseFloat(item.lon));
    onClose();
  };

  const { highlightedIndex, listRef, setHighlightedEl, handleScroll } = useListNav({
    items: results,
    isSelectable: () => true,
    onActivate: handleActivate,
    resetKey: query,
  });

  if (!query.trim()) {
    return (
      <View className="flex-1 items-center justify-center">
        <EmptyState
          icon={MapPin}
          title="Search for a location"
          subtitle="Type an address or place name"
        />
      </View>
    );
  }

  if (isLoading && results.length === 0) {
    return (
      <View className="flex-1 items-center justify-center">
        <ActivityIndicator size="small" color={t.iconMuted} accessibilityLabel="Searching" />
      </View>
    );
  }

  if (error) {
    return (
      <View className="flex-1 items-center justify-center">
        <EmptyState icon={MapPin} title="Search failed" subtitle="Try a different search term" />
      </View>
    );
  }

  if (results.length === 0) {
    return (
      <View className="flex-1 items-center justify-center">
        <EmptyState icon={MapPin} title="No results found" subtitle="Try a different search term" />
      </View>
    );
  }

  return (
    <View className="flex-1">
      <View accessibilityLiveRegion="polite" className="sr-only">
        <Text>
          {results.length} {results.length === 1 ? "result" : "results"}
        </Text>
      </View>
      <FlashList
        ref={listRef}
        data={results}
        onScroll={handleScroll}
        keyExtractor={(item: LocationResult) => String(item.place_id)}
        renderItem={({ item, index }: { item: LocationResult; index: number }) => {
          const { primary, secondary } = formatResult(item.display_name);
          const isHighlighted = index === highlightedIndex;
          return (
            <Pressable
              ref={isHighlighted ? setHighlightedEl : undefined}
              onPress={() => handleActivate(item)}
              tabIndex={-1}
              className={cn(
                "active:bg-surface-overlay/8 flex-row items-center gap-3 px-4 py-3",
                isHighlighted ? "bg-surface-overlay/8" : "hover:bg-surface-overlay/5",
              )}
            >
              <View className="bg-surface-overlay/6 size-8 items-center justify-center rounded">
                <MapPin size={16} strokeWidth={2} color={t.iconMuted} />
              </View>
              <View className="flex-1 gap-0.5">
                <Text className="font-sans-medium text-foreground text-sm" numberOfLines={1}>
                  {primary}
                </Text>
                {secondary && (
                  <Text className="text-muted-foreground font-sans text-xs" numberOfLines={1}>
                    {secondary}
                  </Text>
                )}
              </View>
            </Pressable>
          );
        }}
      />
    </View>
  );
}
