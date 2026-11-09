import { PaletteRow } from "@hydris/ui/command-palette/palette-row";
import { useListNav } from "@hydris/ui/command-palette/use-list-nav";
import { Empty, EmptyDescription, EmptyMedia, EmptyTitle } from "@hydris/ui/empty-state";
import { useThemeColors } from "@hydris/ui/lib/theme";
import { ScrollShadow } from "@hydris/ui/scroll-shadow";
import { FlashList } from "@shopify/flash-list";
import { MapPin } from "lucide-react-native";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Text, View } from "react-native";

import { type LocationResult, searchLocations } from "../../../../../lib/location-search";
import { mapEngineActions } from "../../../store/map-engine-store";

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

      searchLocations(query, controller.signal)
        .then((data) => {
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
        <Empty>
          <EmptyMedia icon={MapPin} />
          <EmptyTitle>Search for a location</EmptyTitle>
          <EmptyDescription>Type an address or place name</EmptyDescription>
        </Empty>
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
        <Empty>
          <EmptyMedia icon={MapPin} />
          <EmptyTitle>Search failed</EmptyTitle>
          <EmptyDescription>Try a different search term</EmptyDescription>
        </Empty>
      </View>
    );
  }

  if (results.length === 0) {
    return (
      <View className="flex-1 items-center justify-center">
        <Empty>
          <EmptyMedia icon={MapPin} />
          <EmptyTitle>No results found</EmptyTitle>
          <EmptyDescription>Try a different search term</EmptyDescription>
        </Empty>
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
      <ScrollShadow size="sm" className="flex-1">
        <FlashList
          ref={listRef}
          data={results}
          onScroll={handleScroll}
          keyExtractor={(item: LocationResult) => String(item.place_id)}
          renderItem={({ item, index }: { item: LocationResult; index: number }) => {
            const { primary, secondary } = formatResult(item.display_name);
            const isHighlighted = index === highlightedIndex;

            return (
              <PaletteRow
                ref={isHighlighted ? setHighlightedEl : undefined}
                icon={MapPin}
                highlighted={isHighlighted}
                onPress={() => handleActivate(item)}
              >
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
              </PaletteRow>
            );
          }}
        />
      </ScrollShadow>
    </View>
  );
}
