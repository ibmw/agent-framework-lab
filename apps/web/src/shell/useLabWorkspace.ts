import { createContext, useContext } from "react";
import type { LabWorkspaceValue } from "./LabWorkspace";

export const LabContext = createContext<LabWorkspaceValue | null>(null);

export function useLabWorkspace(): LabWorkspaceValue {
  const value = useContext(LabContext);
  if (!value) {
    throw new Error("useLabWorkspace must be used inside the experiment lab");
  }
  return value;
}
