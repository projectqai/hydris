import { EmptyState } from "@hydris/ui/empty-state";
import { AlertTriangle } from "lucide-react-native";
import { memo } from "react";

export const AlertsPlaceholder = memo(function AlertsPlaceholder() {
  return (
    <EmptyState icon={AlertTriangle} title="No alerts" subtitle="System alerts will appear here" />
  );
});
