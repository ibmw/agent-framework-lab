import { useEffect } from "react";
import { Navigate, type Params, useLocation, useNavigate, useParams } from "react-router-dom";
import { writeLastVisitedShop } from "../lib/preferences";

/**
 * A bookmark to a lab surface in shop scope, rescued with the context it was holding.
 *
 * The shop in the old address is the one thing the new one does not carry, and it is exactly
 * what the lab needs to know: an operator who bookmarked Northstar's bench is an operator
 * whose lab composes for Northstar. So the redirect writes it into the remembered-shop
 * preference on the way through, and only then replaces the address (ADR 0054).
 *
 * The query and the fragment travel with it. Experiment history keeps its narrowing in the URL
 * precisely so that a finding can be shared at the narrowing it was found in (ADR 0033), and a
 * redirect that rebuilt the path and dropped the query would rescue the page while discarding
 * the reason somebody kept the link. `RedirectRetiredGlossary` below already carries its hash
 * for the same reason.
 *
 * `useNavigate` in one effect rather than `<Navigate>` beside a second: it puts the write and
 * the move in one place in one order, which is the whole point of the component.
 */
export function LabRedirect({ to }: { to: (params: Readonly<Params<string>>) => string }) {
  const params = useParams();
  const { search, hash } = useLocation();
  const navigate = useNavigate();
  const shopId = params.shopId ?? "";
  const target = to(params);
  useEffect(() => {
    if (shopId !== "") {
      writeLastVisitedShop(shopId);
    }
    navigate({ pathname: target, search, hash }, { replace: true });
  }, [navigate, shopId, target, search, hash]);
  return null;
}

export function RedirectRetiredGlossary() {
  const { hash } = useLocation();
  return <Navigate to={{ pathname: "/glossary", hash }} replace />;
}
