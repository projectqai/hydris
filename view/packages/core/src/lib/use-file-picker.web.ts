import { useCallback } from "react";

import type { FilePickerOpts, PickedFile } from "./use-file-picker";

export function useFilePicker() {
  return useCallback((opts: FilePickerOpts = {}): Promise<PickedFile | null> => {
    return new Promise((resolve) => {
      const input = document.createElement("input");
      input.type = "file";
      if (opts.accept) input.accept = opts.accept;
      input.style.display = "none";

      const cleanup = () => {
        input.remove();
      };

      input.onchange = () => {
        const file = input.files?.[0] ?? null;
        cleanup();
        resolve(file ? { kind: "web", file } : null);
      };
      input.oncancel = () => {
        cleanup();
        resolve(null);
      };

      document.body.appendChild(input);
      input.click();
    });
  }, []);
}
