import { useKeyboardShortcut } from "@hydris/ui/keyboard";
import type { PaneId } from "@hydris/ui/layout/types";
import { usePanelContext } from "@hydris/ui/panels";

import { usePIPContext } from "../pip-context";
import { useSelectionStore } from "../store/selection-store";

export function useEscapeHandler({
  swapSourceId,
  clearSwapSource,
  isCustomizing,
  exitCustomize,
}: {
  swapSourceId: PaneId | null;
  clearSwapSource: () => void;
  isCustomizing: boolean;
  exitCustomize: () => void;
}) {
  const { windows, closeAllPIP } = usePIPContext();
  const { collapseAll } = usePanelContext();
  const selectedEntityId = useSelectionStore((s) => s.selectedEntityId);
  const viewedEntityId = useSelectionStore((s) => s.viewedEntityId);
  const select = useSelectionStore((s) => s.select);
  const clearSelection = useSelectionStore((s) => s.clearSelection);

  useKeyboardShortcut(
    "Escape",
    () => {
      if (swapSourceId) {
        clearSwapSource();
        return true;
      }
      if (isCustomizing) {
        exitCustomize();
        return true;
      }
      if (windows.length > 0) {
        closeAllPIP();
        return true;
      }
      if (selectedEntityId) {
        select(null);
        return true;
      }
      if (viewedEntityId) {
        clearSelection();
        collapseAll();
        return true;
      }
      collapseAll();
      return true;
    },
    { priority: 100 },
  );
}
