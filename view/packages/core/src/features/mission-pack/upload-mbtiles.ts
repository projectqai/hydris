import { toast } from "../../lib/sonner";
import type { PickedFile } from "../../lib/use-file-picker";
import { startUploadArtifact } from "./upload-artifact";

const MBTILES_CONTENT_TYPE = "application/vnd.mbtiles";

export async function uploadMbtiles(picked: PickedFile): Promise<void> {
  const entityId = `tileset.${Date.now()}`;
  const name = picked.kind === "web" ? picked.file.name : picked.name;
  const label = name.replace(/\.mbtiles$/i, "");
  const toastId = toast.loading(`Uploading ${label}…`);
  try {
    const { promise } = startUploadArtifact(picked, {
      id: entityId,
      label,
      contentType: MBTILES_CONTENT_TYPE,
    });
    await promise;
    toast.success(`Map ${label} loaded`, { id: toastId });
  } catch (err) {
    toast.error(err instanceof Error ? err.message : "Upload failed", { id: toastId });
  }
}
