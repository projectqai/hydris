import type { WidgetGroup } from "@hydris/ui/layout/types";
import { Video } from "lucide-react-native";

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
    createContent: () => ({ type: "camera" }),
  },
];
