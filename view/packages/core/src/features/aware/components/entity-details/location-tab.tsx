import { InfoRow } from "@hydris/ui/info-row";
import type { Entity } from "@projectqai/proto/world";
import { Compass } from "lucide-react-native";
import { ScrollView, Text, View } from "react-native";

type LocationTabProps = {
  entity: Entity;
};

export function LocationTab({ entity }: LocationTabProps) {
  return (
    <ScrollView className="flex-1">
      <View>
        {entity.bearing && (
          <View className="px-3 pt-3 pb-2">
            <Text className="text-foreground/75 text-11 mb-1 font-mono tracking-widest uppercase">
              Bearing
            </Text>
            {entity.bearing.azimuth !== undefined && (
              <InfoRow
                icon={Compass}
                label="Azimuth"
                value={`${entity.bearing.azimuth.toFixed(1)}°`}
                mono
              />
            )}
            {entity.bearing.elevation !== undefined && (
              <InfoRow
                icon={Compass}
                label="Elevation"
                value={`${entity.bearing.elevation.toFixed(1)}°`}
                mono
              />
            )}
          </View>
        )}

        {entity.geo?.covariance && (
          <View className="border-foreground/10 border-t px-3 pt-3 pb-2">
            <Text className="text-foreground/75 text-11 mb-1 font-mono tracking-widest uppercase">
              Position Covariance
            </Text>
            {(
              [
                ["mxx", "σ²xx"],
                ["mxy", "σ²xy"],
                ["mxz", "σ²xz"],
                ["myy", "σ²yy"],
                ["myz", "σ²yz"],
                ["mzz", "σ²zz"],
              ] as const
            ).map(([key, label]) => {
              const v = entity.geo!.covariance![key as keyof typeof entity.geo.covariance];
              if (typeof v !== "number") return null;
              return <InfoRow key={key} label={label} value={`${v.toFixed(4)} m²`} mono />;
            })}
          </View>
        )}
      </View>
    </ScrollView>
  );
}
