import { ControlButton } from "@hydris/ui/controls";
import { useThemeColors } from "@hydris/ui/lib/theme";
import { PlacementHelpIcon } from "@hydris/ui/top-bar/placement-help-icon";
import { Keyboard, X } from "lucide-react-native";
import { Text, View } from "react-native";

type PlacementBarContentProps = {
  onConfirm: () => void;
  onAbort: () => void;
  onTypeCoordinates: () => void;
};

export function PlacementBarContent({
  onConfirm,
  onAbort,
  onTypeCoordinates,
}: PlacementBarContentProps) {
  const t = useThemeColors();
  return (
    <>
      <View className="flex-1 flex-row items-center gap-1.5">
        <View className="size-1.5 rounded-full" style={{ backgroundColor: t.placementAccent }} />
        <Text className="font-sans-medium text-11" style={{ color: t.placementAccent }}>
          Set position
        </Text>
        <PlacementHelpIcon />
      </View>
      <View className="flex-1 flex-row items-center justify-end gap-1.5">
        <ControlButton
          onPress={onTypeCoordinates}
          icon={Keyboard}
          label="Enter coordinates"
          variant="active"
          size="md"
          labelClassName="font-sans-medium text-11"
          accessibilityLabel="Enter coordinates manually"
        />
        <ControlButton
          onPress={onAbort}
          icon={X}
          label="Cancel"
          variant="destructive"
          size="md"
          labelClassName="font-sans-semibold text-11"
          accessibilityLabel="Cancel placement"
        />
        <ControlButton
          onPress={onConfirm}
          label="Confirm"
          variant="success"
          labelClassName="font-sans-semibold text-11"
          accessibilityLabel="Confirm position"
        />
      </View>
    </>
  );
}
