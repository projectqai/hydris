import type { ReactNode } from "react";
import { createContext, useContext } from "react";

type PaneEntity = {
  entityId?: string;
  onPin?: () => void;
};

const PaneEntityContext = createContext<PaneEntity>({});

export function PaneEntityProvider({
  entityId,
  onPin,
  children,
}: {
  entityId?: string;
  onPin?: () => void;
  children: ReactNode;
}) {
  return (
    <PaneEntityContext.Provider value={{ entityId, onPin }}>{children}</PaneEntityContext.Provider>
  );
}

export function usePaneEntity(): PaneEntity {
  return useContext(PaneEntityContext);
}
