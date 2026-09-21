import { createContext, useContext } from "react";
import type { ShopWorkspaceValue } from "./ShopWorkspace";

export const WorkspaceContext = createContext<ShopWorkspaceValue | null>(null);

export function useShopWorkspace(): ShopWorkspaceValue {
  const value = useContext(WorkspaceContext);
  if (!value) {
    throw new Error("useShopWorkspace must be used inside the shop workspace");
  }
  return value;
}
