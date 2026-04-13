import type { ReactNode } from "react";
import { createContext, useContext } from "react";

type CameraPaneContextValue = {
  isInPane: (entityId: string) => boolean;
};

const CameraPaneContext = createContext<CameraPaneContextValue | null>(null);

export function CameraPaneProvider({
  children,
  isInPane,
}: {
  children: ReactNode;
  isInPane: (entityId: string) => boolean;
}) {
  return <CameraPaneContext.Provider value={{ isInPane }}>{children}</CameraPaneContext.Provider>;
}

export function useCameraPaneContext() {
  return useContext(CameraPaneContext);
}
