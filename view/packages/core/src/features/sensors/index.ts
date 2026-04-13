import type { WidgetGroup } from "@hydris/ui/layout/types";
import { Activity, BarChart3 } from "lucide-react-native";

import { SensorEntityPicker } from "./components/entity-picker";

export { AlarmOverlay } from "./components/alarm-overlay";
export { SensorPane } from "./components/sensor-pane";

export const SENSOR_WIDGETS: WidgetGroup[] = [
  {
    tab: "Sensors",
    icon: Activity,
    widgets: [
      {
        id: "sensor:metric",
        label: "Metric",
        description: "Numeric sensor reading",
        icon: Activity,
      },
      {
        id: "sensor:levels",
        label: "Levels",
        description: "Multi-channel bar levels",
        icon: BarChart3,
      },
    ],
    EntityPicker: SensorEntityPicker,
  },
];
