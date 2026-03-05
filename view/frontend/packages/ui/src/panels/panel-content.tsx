import type { ReactNode } from "react";

type PanelContentProps = {
  children: ReactNode;
};

export function PanelContent({ children }: PanelContentProps) {
  return children;
}
