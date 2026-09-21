import { useState } from "react";
import { Navigate } from "react-router-dom";
import { readAppLanding } from "../lib/preferences";
import { useLabSurface } from "../shell/useLabSurface";

/**
 * Where the app opens, from the *Where the app opens* preference (ADR 0054).
 *
 * The control that writes it is a later slice's; the resolution is written once here so that
 * the constant this route used to be cannot come to disagree with the preference that replaces
 * it. The remembered shop is resolved against the shop list rather than dereferenced — a shop
 * removed since the last visit would otherwise open on an error page — which is why the
 * default path mounts a component and the other two do not need to.
 */
export function Landing() {
  const [landing] = useState(readAppLanding);
  if (landing === "lab") {
    return <Navigate to="/lab/bench" replace />;
  }
  if (landing === "shops") {
    return <Navigate to="/shops" replace />;
  }
  return <RememberedShopLanding />;
}

function RememberedShopLanding() {
  const surface = useLabSurface();
  if (surface.loading) {
    return <p className="p-6 text-[13px] text-admin-muted">Opening the workspace…</p>;
  }
  return (
    <Navigate
      to={surface.rememberedShop ? `/shops/${surface.rememberedShop.shop_id}` : "/shops"}
      replace
    />
  );
}
