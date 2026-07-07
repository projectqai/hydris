"use no memo";

import { ListDetailShell } from "@hydris/ui/command-palette/list-detail-drawer";
import { useCallback, useState } from "react";

import { ConfigPanel } from "../../configuration-modal/config-panel";
import { ConfigTreeSidebar } from "../../configuration-modal/config-tree-sidebar";
import type { ConfigSelection } from "../../configuration-modal/use-config-tree";
import { useConfigTree } from "../../configuration-modal/use-config-tree";

export function ConfigView({
  entityId,
  focusCategory,
  query,
  isWide,
  treeOpen,
  onTreeOpenChange,
}: {
  entityId?: string;
  focusCategory?: string;
  query: string;
  isWide: boolean;
  treeOpen: boolean;
  onTreeOpenChange: (open: boolean) => void;
}) {
  const tree = useConfigTree();
  const [selection, setSelection] = useState<ConfigSelection>(() =>
    entityId ? { type: "device", entityId } : null,
  );

  const closeTree = useCallback(() => onTreeOpenChange(false), [onTreeOpenChange]);

  const handleSelect = useCallback(
    (sel: ConfigSelection) => {
      setSelection(sel);
      if (!isWide) onTreeOpenChange(false);
    },
    [isWide, onTreeOpenChange],
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
      <ConfigPanel selection={selection} onSelect={handleSelect} />
    </ListDetailShell>
  );
}
