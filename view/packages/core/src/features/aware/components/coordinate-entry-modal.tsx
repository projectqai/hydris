import { ControlButton, ControlInput } from "@hydris/ui/controls";
import { useKeyboardShortcut } from "@hydris/ui/keyboard";
import { useThemeColors } from "@hydris/ui/lib/theme";
import { SegmentedControl } from "@hydris/ui/segmented-control";
import { ClipboardPaste, X } from "lucide-react-native";
import { forward, toPoint } from "mgrs";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";

import type { CoordFormat } from "../store/map-store";
import { useMapStore } from "../store/map-store";
import { PickerModalShell } from "./layout/picker-modal-shell";

const MODES: { id: CoordFormat; label: string }[] = [
  { id: "latlng", label: "Lat / Long" },
  { id: "mgrs", label: "MGRS" },
];

// strict parse. rejects "45.1.2" / "45m" that Number.parseFloat would truncate
function toNumber(value: string): number {
  return value.trim() === "" ? NaN : Number(value);
}

function parseCoord(value: string, min: number, max: number): number | null {
  const n = toNumber(value);
  return Number.isFinite(n) && n >= min && n <= max ? n : null;
}

function parseAltitude(value: string): number | null {
  const n = toNumber(value);
  return Number.isFinite(n) ? n : null;
}

function splitCoords(value: string): { lat: string; lng: string; alt?: string } | null {
  const parts = value.split(/[\s,]+/).filter(Boolean);
  if (parts.length !== 2 && parts.length !== 3) return null;
  if (parseCoord(parts[0]!, -90, 90) == null || parseCoord(parts[1]!, -180, 180) == null) {
    return null;
  }
  if (parts.length === 3 && parseAltitude(parts[2]!) == null) return null;
  return { lat: parts[0]!, lng: parts[1]!, alt: parts[2] };
}

function parseMgrs(value: string): { lat: number; lng: number } | null {
  const cleaned = value.replace(/\s+/g, "").toUpperCase();
  if (!cleaned) return null;
  try {
    const [lng, lat] = toPoint(cleaned);
    return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
  } catch {
    return null;
  }
}

function toMgrs(lat: number, lng: number): string {
  try {
    return forward([lng, lat], 5);
  } catch {
    return "";
  }
}

type CoordinateEntryModalProps = {
  initial: { latitude: number; longitude: number; altitude?: number };
  onApply: (coords: { latitude: number; longitude: number; altitude?: number }) => void;
  onClose: () => void;
};

export function CoordinateEntryModal({ initial, onApply, onClose }: CoordinateEntryModalProps) {
  const t = useThemeColors();
  const coordEntryFormat = useMapStore((s) => s.coordEntryFormat);
  const setCoordEntryFormat = useMapStore((s) => s.setCoordEntryFormat);
  const [mode, setMode] = useState<CoordFormat>(coordEntryFormat);
  const [lat, setLat] = useState(() => initial.latitude.toFixed(6));
  const [lng, setLng] = useState(() => initial.longitude.toFixed(6));
  const [mgrs, setMgrs] = useState(() =>
    coordEntryFormat === "mgrs" ? toMgrs(initial.latitude, initial.longitude) : "",
  );
  const [alt, setAlt] = useState(() =>
    initial.altitude != null ? String(Math.round(initial.altitude)) : "",
  );

  useKeyboardShortcut(
    "Escape",
    () => {
      onClose();
      return true;
    },
    { priority: 200 },
  );

  const latValue = parseCoord(lat, -90, 90);
  const lngValue = parseCoord(lng, -180, 180);
  const mgrsPoint = parseMgrs(mgrs);

  const latlngPoint =
    latValue != null && lngValue != null ? { lat: latValue, lng: lngValue } : null;
  const point = mode === "mgrs" ? mgrsPoint : latlngPoint;

  // altitude is optional: blank (undefined) is fine, non-numeric text (null) blocks apply
  const altValue = alt.trim() === "" ? undefined : parseAltitude(alt);
  const valid = point != null && altValue !== null;

  const switchMode = (next: CoordFormat) => {
    if (next === mode) return;
    if (next === "mgrs" && latValue != null && lngValue != null) {
      setMgrs(toMgrs(latValue, lngValue));
    } else if (next === "latlng" && mgrsPoint) {
      setLat(mgrsPoint.lat.toFixed(6));
      setLng(mgrsPoint.lng.toFixed(6));
    }
    setMode(next);
    setCoordEntryFormat(next);
  };

  // paste convenience: a value that parses as a full "lat, lng[, alt]" or as MGRS
  // fills the form and switches mode. anything else just updates the edited field.
  const handleChange = (value: string, field: "lat" | "lng" | "mgrs") => {
    const split = splitCoords(value);
    if (split) {
      setMode("latlng");
      setLat(split.lat);
      setLng(split.lng);
      if (split.alt !== undefined) setAlt(split.alt);
      return;
    }
    if (field !== "mgrs" && parseMgrs(value)) {
      setMode("mgrs");
      setMgrs(value);
      return;
    }
    if (field === "lat") setLat(value);
    else if (field === "lng") setLng(value);
    else setMgrs(value);
  };

  const apply = () => {
    if (point == null || altValue === null) return;
    onApply({ latitude: point.lat, longitude: point.lng, altitude: altValue });
  };

  return (
    <PickerModalShell ariaLabel="Enter coordinates" onClose={onClose} maxWidth={440}>
      <View className="flex-row items-center gap-2.5 px-4 py-3">
        <Text className="text-foreground font-sans-medium flex-1 text-sm">Enter coordinates</Text>
        <Pressable onPress={onClose} aria-label="Close" tabIndex={-1} hitSlop={8} className="p-1">
          <X size={14} strokeWidth={2} color={t.iconMuted} />
        </Pressable>
      </View>
      <View className="bg-surface-overlay/6 h-px" />

      <View className="gap-3 px-4 py-4">
        <SegmentedControl tabs={MODES} activeTab={mode} onTabChange={switchMode} className="p-0" />

        {mode === "latlng" ? (
          <>
            <View className="gap-1.5">
              <Text className="text-foreground font-sans-medium text-sm">Latitude</Text>
              <ControlInput
                value={lat}
                onChangeText={(v) => handleChange(v, "lat")}
                placeholder="-90 to 90"
                keyboardType="numeric"
                autoComplete="off"
                selectTextOnFocus
                onSubmitEditing={apply}
                accessibilityLabel="Latitude"
              />
            </View>
            <View className="gap-1.5">
              <Text className="text-foreground font-sans-medium text-sm">Longitude</Text>
              <ControlInput
                value={lng}
                onChangeText={(v) => handleChange(v, "lng")}
                placeholder="-180 to 180"
                keyboardType="numeric"
                autoComplete="off"
                selectTextOnFocus
                onSubmitEditing={apply}
                accessibilityLabel="Longitude"
              />
            </View>
          </>
        ) : (
          <View className="gap-1.5">
            <Text className="text-foreground font-sans-medium text-sm">MGRS</Text>
            <ControlInput
              value={mgrs}
              onChangeText={(v) => handleChange(v, "mgrs")}
              placeholder="33U XP 04897 12345"
              autoComplete="off"
              autoCapitalize="characters"
              selectTextOnFocus
              onSubmitEditing={apply}
              accessibilityLabel="MGRS grid reference"
            />
          </View>
        )}

        <View className="gap-1.5">
          <Text className="text-foreground font-sans-medium text-sm">Altitude (m)</Text>
          <ControlInput
            value={alt}
            onChangeText={setAlt}
            placeholder="Optional"
            keyboardType="numeric"
            autoComplete="off"
            selectTextOnFocus
            onSubmitEditing={apply}
            accessibilityLabel="Altitude in meters"
          />
        </View>

        <View className="flex-row items-center gap-1.5">
          <ClipboardPaste size={15} strokeWidth={2} color={t.iconMuted} />
          <Text className="text-muted-foreground font-mono text-xs" numberOfLines={1}>
            Paste lat/long or MGRS to autofill
          </Text>
        </View>

        <ControlButton
          onPress={apply}
          label="Apply"
          variant={valid ? "success" : "default"}
          disabled={!valid}
          size="lg"
          fullWidth
          labelClassName="font-mono text-xs font-semibold uppercase"
          className="mt-1"
          accessibilityLabel="Apply coordinates"
        />
      </View>
    </PickerModalShell>
  );
}
