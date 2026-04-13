import type { ReactNode } from "react";

type PanelCollapsedProps = {
  children: ReactNode;
};

export function PanelCollapsed({ children }: PanelCollapsedProps) {
  return children;
}
