import type { WidgetGroup } from "@hydris/ui/layout/types";
import { Video } from "lucide-react-native";

import { CameraEntityPicker } from "./components/layout/camera-entity-picker";

export const CAMERA_WIDGETS: WidgetGroup[] = [
  {
    tab: "Cameras",
    icon: Video,
    widgets: [
      {
        id: "camera:feed",
        label: "Camera",
        description: "Live video feed",
        icon: Video,
      },
    ],
    EntityPicker: CameraEntityPicker,
  },
];
