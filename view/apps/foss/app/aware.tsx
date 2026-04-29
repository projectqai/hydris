import AwareScreen from "@hydris/core/features/aware/aware-screen";
import { CAMERA_WIDGETS } from "@hydris/core/features/aware/camera-widgets";
import { SENSOR_WIDGETS } from "@hydris/core/features/sensors";

const IS_MOBILE = process.env.EXPO_OS !== "web";

const ADDITIONAL_WIDGETS = [...SENSOR_WIDGETS, ...CAMERA_WIDGETS];

export default function AwarePage() {
  return <AwareScreen additionalWidgets={ADDITIONAL_WIDGETS} commandButtonRight={IS_MOBILE} />;
}
