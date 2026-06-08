export type RadialMenuItemVariant = "default" | "destructive" | "success";

export type RadialMenuItem = {
  readonly id: string;
  readonly label: string;
  readonly variant?: RadialMenuItemVariant;
  readonly disabled?: boolean;
};

export type RadialMenuPosition = {
  readonly x: number;
  readonly y: number;
};

export type RadialMenuProps = {
  readonly position: RadialMenuPosition;
  readonly items: readonly RadialMenuItem[];
  readonly onSelect: (id: string) => void;
  readonly onClose: () => void;
  readonly title?: string;
  readonly titleIconUri?: string;
  readonly radius?: number;
};
