import { getDocumentAsync } from "expo-document-picker";
import { useCallback } from "react";

import type { FilePickerOpts, PickedFile } from "./use-file-picker";

export function useFilePicker() {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  return useCallback(async (opts: FilePickerOpts = {}): Promise<PickedFile | null> => {
    const result = await getDocumentAsync({
      type: "*/*",
      copyToCacheDirectory: true,
      multiple: false,
    });
    if (result.canceled) return null;
    const asset = result.assets[0];
    if (!asset) return null;
    return { kind: "native", uri: asset.uri, name: asset.name };
  }, []);
}
