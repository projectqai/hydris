import { useThemeColors } from "@hydris/ui/lib/theme";
import { cn } from "@hydris/ui/lib/utils";
import { AlertTriangle } from "lucide-react-native";
import { Text, View } from "react-native";

export function ErrorNotice({ children, className }: { children: string; className?: string }) {
  const t = useThemeColors();

  return (
    <View
      accessibilityRole="alert"
      className={cn("bg-red/10 flex-row items-start gap-2 rounded px-3 py-2", className)}
    >
      <View aria-hidden>
        <AlertTriangle size={14} strokeWidth={2} color={t.redForeground} />
      </View>
      <Text className="text-red-foreground font-mono text-xs">{children}</Text>
    </View>
  );
}
