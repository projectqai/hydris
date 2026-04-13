"use no memo";

import {
  cloneTree,
  countPanes,
  getNextPaneId,
  getNodeAtPath,
  getStructureKey,
  replaceAtPath,
  swapPaneIds,
  validateLayoutNode,
} from "@hydris/ui/layout/tree-utils";
import type {
  LayoutNode,
  NodePath,
  PaneContent,
  PaneId,
  SplitLayout,
} from "@hydris/ui/layout/types";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { runOnJS, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";

import { COMPONENT_REGISTRY, PERSIST_DEBOUNCE_MS, PRESETS, STORAGE_KEY } from "../constants";
import { layoutSnapshotRef } from "./layout-snapshot";

const BASE_COMPONENT_IDS = new Set(Object.keys(COMPONENT_REGISTRY));

function hasMapContent(node: LayoutNode): boolean {
  if (node.type === "pane") {
    return node.content.type === "component" && node.content.componentId === "mapPane";
  }
  return hasMapContent(node.first) || hasMapContent(node.second);
}

export function useLayoutManager(additionalComponentIds?: string[]) {
  const validIds = useMemo(() => {
    if (!additionalComponentIds?.length) return BASE_COMPONENT_IDS;
    const ids = new Set(BASE_COMPONENT_IDS);
    for (const id of additionalComponentIds) ids.add(id);
    return ids;
  }, [additionalComponentIds]);
  const [activePresetId, setActivePresetId] = useState("inspect");
  const [layoutTree, setLayoutTree] = useState<LayoutNode>(() => cloneTree(PRESETS[0]!.root));
  const [swapSourceId, setSwapSourceId] = useState<PaneId | null>(null);
  const customTreesRef = useRef<Record<string, LayoutNode>>({});
  const layoutTreeRef = useRef(layoutTree);
  layoutTreeRef.current = layoutTree;
  const structureKeyRef = useRef(getStructureKey(PRESETS[0]!.root));
  const pendingTreeRef = useRef<LayoutNode | null>(null);
  const persistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const skipPersistRef = useRef(false);
  const externalPendingRef = useRef(false);
  const opacity = useSharedValue(1);

  const applyPendingTree = useCallback(() => {
    const tree = pendingTreeRef.current;
    if (!tree) return;
    if (externalPendingRef.current) {
      skipPersistRef.current = true;
      externalPendingRef.current = false;
    }
    pendingTreeRef.current = null;
    setLayoutTree(tree);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        opacity.value = withTiming(1, { duration: 100 });
      });
    });
  }, []);

  const handlePresetSelect = useCallback(
    (id: string) => {
      const preset = PRESETS.find((p) => p.id === id);
      if (!preset) return;
      customTreesRef.current[activePresetId] = layoutTreeRef.current;
      setActivePresetId(id);
      const saved = customTreesRef.current[id];
      const newTree = saved ? cloneTree(saved) : cloneTree(preset.root);
      const newKey = getStructureKey(newTree);
      if (structureKeyRef.current !== newKey) {
        pendingTreeRef.current = newTree;
        structureKeyRef.current = newKey;
        opacity.value = withTiming(0, { duration: 70 }, (finished) => {
          if (finished) runOnJS(applyPendingTree)();
        });
      } else {
        structureKeyRef.current = newKey;
        setLayoutTree(newTree);
      }
    },
    [activePresetId, applyPendingTree],
  );

  const handleSplit = useCallback((path: NodePath, direction: "horizontal" | "vertical") => {
    setLayoutTree((prev) => {
      const target = getNodeAtPath(prev, path);
      if (target.type !== "pane") return prev;
      const newPaneId = getNextPaneId(prev);
      const split: SplitLayout = {
        type: "split",
        direction,
        ratio: 0.5,
        first: { type: "pane", id: target.id, content: target.content },
        second: { type: "pane", id: newPaneId, content: { type: "empty" } },
      };
      const next = replaceAtPath(prev, path, split);
      structureKeyRef.current = getStructureKey(next);
      return next;
    });
  }, []);

  const handleRemove = useCallback((path: NodePath) => {
    if (path.length === 0) return;
    setLayoutTree((prev) => {
      const parentPath = path.slice(0, -1);
      const removedSide = path[path.length - 1]!;
      const parent = getNodeAtPath(prev, parentPath);
      if (parent.type !== "split") return prev;
      const sibling = removedSide === "first" ? parent.second : parent.first;
      const next = replaceAtPath(prev, parentPath, sibling);
      structureKeyRef.current = getStructureKey(next);
      return next;
    });
  }, []);

  const handleSwapStart = useCallback((id: PaneId) => {
    setSwapSourceId((prev) => (prev === id ? null : id));
  }, []);

  const handleSwapTarget = useCallback(
    (targetId: PaneId) => {
      if (!swapSourceId || swapSourceId === targetId) return;
      setLayoutTree((prev) => {
        const next = swapPaneIds(prev, swapSourceId, targetId);
        structureKeyRef.current = getStructureKey(next);
        return next;
      });
      setSwapSourceId(null);
    },
    [swapSourceId],
  );

  const handleRatioChange = useCallback((path: NodePath, newRatio: number) => {
    setLayoutTree((prev) => {
      const target = getNodeAtPath(prev, path);
      if (target.type !== "split") return prev;
      return replaceAtPath(prev, path, { ...target, ratio: newRatio });
    });
  }, []);

  const handleChangeContent = useCallback((path: NodePath, content: PaneContent) => {
    setLayoutTree((prev) => {
      const target = getNodeAtPath(prev, path);
      if (target.type !== "pane") return prev;
      const next = replaceAtPath(prev, path, {
        type: "pane",
        id: target.id,
        content,
      });
      structureKeyRef.current = getStructureKey(next);
      return next;
    });
  }, []);

  const activePreset = PRESETS.find((p) => p.id === activePresetId);
  const isLayoutModified = useMemo(
    () => activePreset && getStructureKey(layoutTree) !== getStructureKey(activePreset.root),
    [layoutTree, activePreset],
  );

  const handleResetToPreset = useCallback(() => {
    if (!activePreset) return;
    delete customTreesRef.current[activePresetId];
    const newTree = cloneTree(activePreset.root);
    structureKeyRef.current = getStructureKey(newTree);
    setLayoutTree(newTree);
  }, [activePreset, activePresetId]);

  const applyExternalLayout = useCallback(
    (presetId: string, tree?: LayoutNode) => {
      const preset = PRESETS.find((p) => p.id === presetId);
      if (!preset) return;
      skipPersistRef.current = true;
      setActivePresetId(presetId);
      const newTree = tree ? cloneTree(tree) : cloneTree(preset.root);
      const newKey = getStructureKey(newTree);
      if (structureKeyRef.current !== newKey) {
        externalPendingRef.current = true;
        pendingTreeRef.current = newTree;
        structureKeyRef.current = newKey;
        opacity.value = withTiming(0, { duration: 70 }, (finished) => {
          if (finished) runOnJS(applyPendingTree)();
        });
      } else {
        structureKeyRef.current = newKey;
        setLayoutTree(newTree);
      }
    },
    [applyPendingTree],
  );

  const clearSwapSource = useCallback(() => setSwapSourceId(null), []);

  const totalPanes = useMemo(() => countPanes(layoutTree), [layoutTree]);
  const mapVisible = useMemo(() => hasMapContent(layoutTree), [layoutTree]);
  const layoutOpacity = useAnimatedStyle(() => ({ opacity: opacity.value }));

  useEffect(() => {
    if (skipPersistRef.current) {
      skipPersistRef.current = false;
      return;
    }
    if (persistTimerRef.current) clearTimeout(persistTimerRef.current);
    customTreesRef.current[activePresetId] = layoutTree;
    persistTimerRef.current = setTimeout(() => {
      AsyncStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ activePresetId, customTrees: customTreesRef.current }),
      );
    }, PERSIST_DEBOUNCE_MS);
    return () => {
      if (persistTimerRef.current) clearTimeout(persistTimerRef.current);
    };
  }, [layoutTree, activePresetId]);

  useEffect(() => {
    // Skip restore if a layout deep link is pending — useDeepLink will set state
    if (process.env.EXPO_OS === "web" && typeof window !== "undefined") {
      const url = new URL(window.location.href);
      if (url.searchParams.has("layout")) return;
    }

    AsyncStorage.getItem(STORAGE_KEY)
      .then((raw) => {
        if (!raw) return;
        let saved: { activePresetId?: string; customTrees?: Record<string, LayoutNode> };
        try {
          saved = JSON.parse(raw);
        } catch {
          return;
        }
        if (saved.activePresetId && PRESETS.some((p) => p.id === saved.activePresetId)) {
          setActivePresetId(saved.activePresetId);
        }
        if (saved.customTrees) {
          const validated: Record<string, LayoutNode> = {};
          for (const [key, raw] of Object.entries(saved.customTrees)) {
            const valid = validateLayoutNode(raw, validIds);
            if (valid) validated[key] = valid;
          }
          customTreesRef.current = validated;
          const tree = validated[saved.activePresetId ?? "inspect"];
          if (tree) {
            setLayoutTree(tree);
            structureKeyRef.current = getStructureKey(tree);
          }
        }
      })
      .catch(() => {});
  }, []);

  layoutSnapshotRef.current = {
    activePresetId,
    tree: layoutTree,
    isModified: !!isLayoutModified,
  };

  return {
    activePresetId,
    layoutTree,
    swapSourceId,
    totalPanes,
    mapVisible,
    isLayoutModified,
    layoutOpacity,
    handlePresetSelect,
    handleSplit,
    handleRemove,
    handleSwapStart,
    handleSwapTarget,
    handleResetToPreset,
    handleChangeContent,
    handleRatioChange,
    clearSwapSource,
    applyExternalLayout,
  };
}
