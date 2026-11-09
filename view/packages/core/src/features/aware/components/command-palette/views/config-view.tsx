"use no memo";

import { ListDetailShell } from "@hydris/ui/command-palette/list-detail-drawer";
import { useCallback, useState } from "react";

import { useDiscardUnsavedDevice } from "../../../hooks/use-discard-unsaved-device";
import { ConfigPanel } from "../../configuration-modal/config-panel";
import { ConfigTreeSidebar } from "../../configuration-modal/config-tree-sidebar";
import type { ConfigSelection } from "../../configuration-modal/use-config-tree";
import { useConfigTree } from "../../configuration-modal/use-config-tree";

export function ConfigView({
  entityId,
  focusCategory,
  adding,
  query,
  isWide,
  treeOpen,
  onTreeOpenChange,
}: {
  entityId?: string;
  focusCategory?: string;
  adding?: boolean;
  query: string;
  isWide: boolean;
  treeOpen: boolean;
  onTreeOpenChange: (open: boolean) => void;
}) {
  const tree = useConfigTree();
  const [selection, setSelection] = useState<ConfigSelection>(() =>
    entityId ? { type: "device", entityId } : null,
  );

  const [created, setCreated] = useState<string>();

  useDiscardUnsavedDevice(selection?.entityId === created ? created : undefined);

  const closeTree = useCallback(() => onTreeOpenChange(false), [onTreeOpenChange]);

  const handleSelect = useCallback(
    (sel: ConfigSelection) => {
      setSelection(sel);
      if (!isWide) onTreeOpenChange(false);
    },
    [isWide, onTreeOpenChange],
  );

  const handleCreated = useCallback(
    (createdId: string) => {
      setCreated(createdId);
      handleSelect({ type: "device", entityId: createdId });
    },
    [handleSelect],
  );

  return (
    <ListDetailShell
      isWide={isWide}
      treeOpen={treeOpen}
      onTreeClose={closeTree}
      closeLabel="Close device list"
      sidebar={
        <ConfigTreeSidebar
          tree={tree}
          selection={selection}
          onSelect={handleSelect}
          query={query}
          focusCategory={focusCategory}
        />
      }
    >
      <ConfigPanel selection={selection} onCreated={handleCreated} defaultAddMode={adding} />
    </ListDetailShell>
  );
}
