import type { ComponentType } from "react";
import type { SharedValue } from "react-native-reanimated";

export type PaneId = string;

export type PaneContent =
  | { type: "component"; componentId: string; props?: Record<string, unknown> }
  | { type: "iframe"; url: string }
  | { type: "camera"; entityId: string }
  | { type: "sensor"; entityId: string; widgetId: string }
  | { type: "empty" };

export type SplitLayout = {
  type: "split";
  direction: "horizontal" | "vertical";
  ratio: number;
  first: LayoutNode;
  second: LayoutNode;
};

export type PaneLayout = {
  type: "pane";
  id: PaneId;
  content: PaneContent;
};

export type LayoutNode = SplitLayout | PaneLayout;

export type Preset = {
  id: string;
  name: string;
  root: LayoutNode;
};

export type PathStep = "first" | "second";
export type NodePath = PathStep[];

export type SplitRatioContextValue = {
  ratio: SharedValue<number>;
  collapsedRatio: SharedValue<number>;
  position: "first" | "second";
  defaultRatio: number;
  direction: "horizontal" | "vertical";
  path: NodePath;
  parent: SplitRatioContextValue | null;
};

export type LeafRendererProps = {
  id: PaneId;
  path: NodePath;
  content: PaneContent;
};

export type WidgetPickerState = {
  path: NodePath;
  currentContent: PaneContent;
} | null;

export type WidgetDefinition = {
  id: string;
  label: string;
  description: string;
  icon: ComponentType<{ size: number; strokeWidth: number; color: string }>;
  component?: ComponentType;
};

export type EntityPickerProps = {
  widgetId: string;
  onSelect: (content: PaneContent) => void;
};

export type WidgetGroup = {
  tab: string;
  icon?: ComponentType<{ size: number; strokeWidth: number; color: string }>;
  widgets: WidgetDefinition[];
  EntityPicker?: ComponentType<EntityPickerProps>;
};

export type LayoutEditingContextValue = {
  customizeProgress: SharedValue<number>;
  isCustomizing: boolean;
  onSplit: (path: NodePath, direction: "horizontal" | "vertical") => void;
  onRemove: (path: NodePath) => void;
  onChangeContent: (path: NodePath, content: PaneContent) => void;
  onRatioChange: (path: NodePath, ratio: number) => void;
  totalPanes: number;
  swapSourceId: PaneId | null;
  onSwapStart: (id: PaneId) => void;
  onSwapTarget: (id: PaneId) => void;
  pickerState: WidgetPickerState;
  openPicker: (path: NodePath, currentContent: PaneContent) => void;
  closePicker: () => void;
};
