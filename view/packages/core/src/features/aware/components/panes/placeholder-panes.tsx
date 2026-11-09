import { Empty, EmptyDescription, EmptyMedia, EmptyTitle } from "@hydris/ui/empty-state";
import { AlertTriangle } from "lucide-react-native";
import { memo } from "react";

export const AlertsPlaceholder = memo(function AlertsPlaceholder() {
  return (
    <Empty>
      <EmptyMedia icon={AlertTriangle} />
      <EmptyTitle>No alerts</EmptyTitle>
      <EmptyDescription>System alerts will appear here</EmptyDescription>
    </Empty>
  );
});
