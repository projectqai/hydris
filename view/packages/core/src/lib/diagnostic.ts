import { Platform } from "react-native";

import { baseUrl } from "./api/world-client";
import { downloadFromEndpoint } from "./download";
import { toast } from "./sonner";

export async function exportDiagnostic() {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  await downloadFromEndpoint({
    url: `${baseUrl}/diagnostic/export`,
    fallbackFilename: `hydris-diagnostic-${stamp}.zip`,
    parentFolder: "Hydris-Diagnostics",
    mimeType: "application/zip",
  });
  toast.info(Platform.OS === "web" ? "Sent to downloads" : "Saved to Downloads/Hydris-Diagnostics");
}
