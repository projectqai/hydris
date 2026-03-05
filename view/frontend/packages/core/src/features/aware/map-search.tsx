import { ATTRIBUTIONS } from "@hydris/map-engine/constants";
import { ControlIconButton } from "@hydris/ui/controls";
import { GRADIENT_PROPS, useThemeColors } from "@hydris/ui/lib/theme";
import { LinearGradient } from "expo-linear-gradient";
import { MapPin, Search, X } from "lucide-react-native";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Keyboard, Pressable, Text, TextInput, View } from "react-native";
import Animated, { FadeIn, FadeOut } from "react-native-reanimated";

import { useMapEngine } from "./store/map-engine-store";
import { useMapStore } from "./store/map-store";

type SearchResult = {
  place_id: number;
  display_name: string;
  lat: string;
  lon: string;
};

const DEBOUNCE_MS = 300;
const BUTTON_SIZE = 40;
const ICON_SIZE = 16;

function formatResult(displayName: string): { primary: string; secondary: string } {
  const parts = displayName.split(",").map((s) => s.trim());
  const primary = parts[0] || displayName;
  const secondary = parts.slice(1, 3).join(", ");
  return { primary, secondary };
}

export function MapSearchControl({ isOpen, onToggle }: { isOpen: boolean; onToggle: () => void }) {
  const t = useThemeColors();
  const mapEngine = useMapEngine();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const abortControllerRef = useRef<AbortController | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<TextInput>(null);

  const searchLocation = async (searchQuery: string) => {
    if (!searchQuery.trim()) {
      setResults([]);
      setShowResults(false);
      return;
    }

    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    abortControllerRef.current = new AbortController();
    setIsLoading(true);
    setError(null);

    const response = await fetch(
      `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(searchQuery)}&limit=5`,
      {
        headers: {
          "User-Agent": "HydrisApp/1.0",
          Accept: "application/json",
        },
        signal: abortControllerRef.current.signal,
      },
    ).catch((err) => {
      if (err instanceof Error && err.name === "AbortError") {
        return null;
      }
      console.error("Search failed:", err);
      setError("Search failed");
      setResults([]);
      setShowResults(false);
      setIsLoading(false);
      return null;
    });

    if (!response) {
      return;
    }

    if (!response.ok) {
      setError(`Search failed: ${response.status}`);
      setResults([]);
      setShowResults(false);
      setIsLoading(false);
      return;
    }

    const data = await response.json();
    setResults(data);
    setShowResults(data.length > 0);
    setIsLoading(false);
  };

  const handleQueryChange = (text: string) => {
    setQuery(text);

    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    if (!text.trim()) {
      setResults([]);
      setShowResults(false);
      setError(null);
      return;
    }

    debounceRef.current = setTimeout(() => {
      searchLocation(text);
    }, DEBOUNCE_MS);
  };

  const handleSubmit = () => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }
    searchLocation(query);
  };

  const handleSelectResult = (result: SearchResult) => {
    const lat = parseFloat(result.lat);
    const lon = parseFloat(result.lon);

    Keyboard.dismiss();
    onToggle();

    requestAnimationFrame(() => {
      mapEngine.flyTo(lat, lon);
    });
  };

  const handleClear = () => {
    setQuery("");
    setResults([]);
    setShowResults(false);
    setError(null);
    inputRef.current?.focus();
  };

  // Auto-focus when opening
  useEffect(() => {
    if (isOpen) {
      requestAnimationFrame(() => inputRef.current?.focus());
    } else {
      setQuery("");
      setResults([]);
      setShowResults(false);
      setError(null);
    }
  }, [isOpen]);

  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, []);

  return (
    <View className="relative">
      <ControlIconButton
        icon={Search}
        iconSize={ICON_SIZE}
        onPress={onToggle}
        variant={isOpen ? "active" : "default"}
        size="lg"
        accessibilityLabel="Search location"
      />

      {isOpen && (
        <Animated.View
          entering={FadeIn.duration(150)}
          exiting={FadeOut.duration(100)}
          style={{ position: "absolute", top: 0, right: BUTTON_SIZE + 8 }}
        >
          <LinearGradient
            colors={t.gradients.default}
            {...GRADIENT_PROPS}
            className="border-border/40 h-10 flex-row items-center overflow-hidden rounded-lg border px-3"
            style={{ width: 280 }}
          >
            <Search size={14} color={t.iconMuted} />
            <TextInput
              ref={inputRef}
              value={query}
              onChangeText={handleQueryChange}
              onSubmitEditing={handleSubmit}
              placeholder="Search location..."
              placeholderTextColor={t.placeholder}
              className="text-foreground ml-2 h-full flex-1 font-sans text-sm focus:outline-none focus-visible:outline-none"
              returnKeyType="search"
              autoCorrect={false}
              autoCapitalize="none"
            />
            {isLoading ? (
              <ActivityIndicator size="small" color={t.iconMuted} />
            ) : query ? (
              <Pressable
                onPress={handleClear}
                hitSlop={8}
                accessibilityLabel="Clear search"
                accessibilityRole="button"
              >
                <X size={14} color={t.iconMuted} />
              </Pressable>
            ) : null}
          </LinearGradient>

          {showResults && results.length > 0 && (
            <LinearGradient
              colors={t.gradients.default}
              {...GRADIENT_PROPS}
              className="border-border/40 mt-1.5 overflow-hidden rounded-lg border"
              style={{ width: 280 }}
            >
              {results.map((result, index) => {
                const { primary, secondary } = formatResult(result.display_name);
                return (
                  <View key={result.place_id}>
                    {index > 0 && <View className="border-border/40 border-t" />}
                    <Pressable
                      onPress={() => handleSelectResult(result)}
                      className="hover:bg-surface-overlay/10 active:bg-surface-overlay/15 flex-row items-center px-3 py-2.5"
                    >
                      <View className="mr-2.5">
                        <MapPin size={14} color={t.iconMuted} />
                      </View>
                      <View className="flex-1">
                        <Text
                          className="text-foreground"
                          style={{ fontSize: 13, fontWeight: "500" }}
                          numberOfLines={1}
                        >
                          {primary}
                        </Text>
                        {secondary && (
                          <Text
                            className="text-on-surface/70"
                            style={{ fontSize: 11, marginTop: 1 }}
                            numberOfLines={1}
                          >
                            {secondary}
                          </Text>
                        )}
                      </View>
                    </Pressable>
                  </View>
                );
              })}
            </LinearGradient>
          )}

          {error && (
            <Text className="text-red-foreground mt-1 text-xs" style={{ width: 280 }}>
              {error}
            </Text>
          )}
        </Animated.View>
      )}
    </View>
  );
}

const LIGHT_LAYERS: Set<string> = new Set(["street"]);

export function MapAttribution() {
  const baseLayer = useMapStore((s) => s.layer);
  const isLight = LIGHT_LAYERS.has(baseLayer);
  return (
    <Text
      style={{
        position: "absolute",
        bottom: 4,
        left: 0,
        right: 0,
        fontSize: 10,
        lineHeight: 14,
        color: isLight ? "rgba(0, 0, 0, 0.5)" : "rgba(255, 255, 255, 0.45)",
        textAlign: "center",
      }}
      pointerEvents="none"
    >
      {ATTRIBUTIONS[baseLayer]}
    </Text>
  );
}
