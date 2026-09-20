import { useEffect, useState } from "react";
import {
  createRoutesFromElements,
  Navigate,
  type Params,
  Route,
  useLocation,
  useNavigate,
  useParams,
} from "react-router-dom";
import { readAppLanding, writeLastVisitedShop } from "./lib/preferences";
import { AgentConfigurationEditorPage } from "./routes/AgentConfigurationEditorPage";
import { AgentConfigurationsPage } from "./routes/AgentConfigurationsPage";
import { MutationBlockEditorPage, ObjectiveBlockEditorPage } from "./routes/BlockEditorPage";
import { MutationBlocksPage, ObjectiveBlocksPage } from "./routes/BlockLibraryPage";
import { CustomerEditorPage } from "./routes/CustomerEditorPage";
import { CustomersPage, NewCustomerPage } from "./routes/CustomersPage";
import { ExperimentBenchPage } from "./routes/ExperimentBenchPage";
import { ExperimentHistoryPage } from "./routes/ExperimentHistoryPage";
import { ExperimentResultsLayout } from "./routes/ExperimentResultsLayout";
import { ExperimentResultsPage } from "./routes/ExperimentResultsPage";
import { ExperimentSetupPage } from "./routes/ExperimentSetupPage";
import { ExperimentTimelinePage } from "./routes/ExperimentTimelinePage";
import { ExperimentTracesPage } from "./routes/ExperimentTracesPage";
import { GlossaryPage } from "./routes/GlossaryPage";
import { JudgeConfigurationEditorPage } from "./routes/JudgeConfigurationEditorPage";
import { JudgeConfigurationsPage } from "./routes/JudgeConfigurationsPage";
import { LabSettingsPage } from "./routes/LabSettingsPage";
import { OrderEditorPage } from "./routes/OrderEditorPage";
import { NewOrderPage, OrdersPage } from "./routes/OrdersPage";
import { ProductEditorPage } from "./routes/ProductEditorPage";
import { ProductsPage } from "./routes/ProductsPage";
import { ScenarioEditorPage } from "./routes/ScenarioEditorPage";
import { ScenariosPage } from "./routes/ScenariosPage";
import { ShopHomePage } from "./routes/ShopHomePage";
import {
  PoliciesAndFaqPage,
  ShopIdentityPage,
  SupportGuidelinesPage,
  ToneOfVoicePage,
} from "./routes/ShopSetupPages";
import { NewShopPage, ShopsPage } from "./routes/ShopsPage";
import { ShopVersionPage } from "./routes/ShopVersionPage";
import { SnapshotsPage } from "./routes/SnapshotsPage";
import { NewSupportIdentityPage, SupportIdentitiesPage } from "./routes/SupportIdentitiesPage";
import { SupportIdentityEditorPage } from "./routes/SupportIdentityEditorPage";
import { TicketsPage } from "./routes/TicketsPage";
import { useLabSurface } from "./shell/LabSurface";
import { LabWorkspace } from "./shell/LabWorkspace";
import { ShopWorkspace } from "./shell/ShopWorkspace";
import { UnsavedChangesGuard } from "./shell/UnsavedChangesGuard";

/**
 * Every lab path the shop layout used to hold, and where it goes now.
 *
 * One table rather than fifteen hand-written elements, so that a path added to the lab and
 * forgotten here is a visible hole rather than a plausible-looking list. The destination is a
 * function of the matched parameters because four of them carry an identifier through.
 */
const LAB_REDIRECTS: readonly [string, (params: Readonly<Params<string>>) => string][] = [
  ["/shops/:shopId/bench", () => "/lab/bench"],
  ["/shops/:shopId/bench/:experimentId", (p) => `/lab/bench/${p.shopId}/${p.experimentId}`],
  [
    "/shops/:shopId/bench/:experimentId/results",
    (p) => `/lab/bench/${p.shopId}/${p.experimentId}/results`,
  ],
  [
    "/shops/:shopId/bench/:experimentId/results/timeline",
    (p) => `/lab/bench/${p.shopId}/${p.experimentId}/results/timeline`,
  ],
  [
    "/shops/:shopId/bench/:experimentId/results/traces",
    (p) => `/lab/bench/${p.shopId}/${p.experimentId}/results/traces`,
  ],
  ["/shops/:shopId/history", () => "/lab/history"],
  ["/shops/:shopId/agent-configurations", () => "/lab/agent-configurations"],
  [
    "/shops/:shopId/agent-configurations/:configurationId",
    (p) => `/lab/agent-configurations/${p.configurationId}`,
  ],
  ["/shops/:shopId/judges", () => "/lab/judges"],
  ["/shops/:shopId/judges/:judgeId", (p) => `/lab/judges/${p.judgeId}`],
  ["/shops/:shopId/support-identities", () => "/lab/support-identities"],
  [
    "/shops/:shopId/support-identities/:identityId",
    (p) => `/lab/support-identities/${p.identityId}`,
  ],
  ["/shops/:shopId/objective-blocks", () => "/lab/objective-blocks"],
  ["/shops/:shopId/objective-blocks/:blockId", (p) => `/lab/objective-blocks/${p.blockId}`],
  ["/shops/:shopId/mutation-blocks", () => "/lab/mutation-blocks"],
  ["/shops/:shopId/mutation-blocks/:blockId", (p) => `/lab/mutation-blocks/${p.blockId}`],
];

/**
 * The application's routes, as route objects for a data router.
 *
 * They are still written as `<Route>` elements and read the same way they always did:
 * `createRoutesFromElements` is the translation, so the migration to `createBrowserRouter` —
 * which `useBlocker` requires — changed how the tree is handed to the router and not what is
 * in it (ADR 0051). The one addition is the pathless root, which adds no path and matches no
 * URL of its own; it is the layout that holds the guard above every route.
 */
export const routeTree = createRoutesFromElements(
  <Route element={<UnsavedChangesGuard />}>
    <Route path="/" element={<Landing />} />
    <Route path="/shops" element={<ShopsPage />} />
    {/* Creating a shop is a page, not a side card on the index (PLAN-UX Slice 12). It sits
        beside `/shops` rather than under `/shops/:shopId`, because there is no shop to be
        the workspace of yet; `new` is a static segment and outranks `:shopId`. */}
    <Route path="/shops/new" element={<NewShopPage />} />
    {/* Lab-level surfaces sit beside /shops rather than inside one: the first step of the
        chain is creating the shop a new operator does not have yet (ADR 0044). */}
    <Route path="/settings" element={<LabSettingsPage />} />
    <Route path="/glossary" element={<GlossaryPage />} />
    {/* The Guides section retired once the chain lived on each surface and the
        fast path on settings (ADR 0049). Old paths still land somewhere useful. */}
    <Route path="/guides" element={<Navigate to="/settings" replace />} />
    <Route path="/guides/setup" element={<Navigate to="/settings" replace />} />
    <Route path="/guides/glossary" element={<RedirectRetiredGlossary />} />

    {/* The experiment lab: everything shared by every shop in this lab, addressed without
        one. The two surfaces that read a single run carry that run's shop in the path,
        because the API addresses an experiment under its shop and a link that dropped it
        would have to look it up before it could ask (ADR 0054). */}
    <Route path="/lab" element={<LabWorkspace />}>
      <Route index element={<Navigate to="/lab/bench" replace />} />
      <Route path="bench" element={<ExperimentSetupPage />} />
      <Route path="bench/:shopId/:experimentId" element={<ExperimentBenchPage />} />
      <Route path="bench/:shopId/:experimentId/results" element={<ExperimentResultsLayout />}>
        <Route index element={<ExperimentResultsPage />} />
        <Route path="timeline" element={<ExperimentTimelinePage />} />
        <Route path="traces" element={<ExperimentTracesPage />} />
      </Route>
      <Route path="history" element={<ExperimentHistoryPage />} />
      <Route path="agent-configurations" element={<AgentConfigurationsPage />} />
      <Route
        path="agent-configurations/:configurationId"
        element={<AgentConfigurationEditorPage />}
      />
      <Route path="judges" element={<JudgeConfigurationsPage />} />
      <Route path="judges/:judgeId" element={<JudgeConfigurationEditorPage />} />
      <Route path="support-identities" element={<SupportIdentitiesPage />} />
      {/* The library left shop scope with ADR 0054 and is reached from both rails, so its
          create page is the lab's too (PLAN-UX Slice 12). */}
      <Route path="support-identities/new" element={<NewSupportIdentityPage />} />
      <Route path="support-identities/:identityId" element={<SupportIdentityEditorPage />} />
      <Route path="objective-blocks" element={<ObjectiveBlocksPage />} />
      <Route path="objective-blocks/:blockId" element={<ObjectiveBlockEditorPage />} />
      <Route path="mutation-blocks" element={<MutationBlocksPage />} />
      <Route path="mutation-blocks/:blockId" element={<MutationBlockEditorPage />} />
    </Route>

    {/* Where those surfaces used to live. Declared here rather than as children of the shop
        layout below, which no longer holds them: two branches matching one URL would be
        settled by the router's ranking, and a redirect nested in the layout would load the
        whole shop draft on its way to a screen that does not want it. */}
    {LAB_REDIRECTS.map(([from, to]) => (
      <Route key={from} path={from} element={<LabRedirect to={to} />} />
    ))}

    <Route path="/shops/:shopId" element={<ShopWorkspace />}>
      <Route index element={<ShopHomePage />} />
      <Route path="products" element={<ProductsPage />} />
      <Route path="products/:handle" element={<ProductEditorPage />} />
      <Route path="orders" element={<OrdersPage />} />
      <Route path="orders/new" element={<NewOrderPage />} />
      <Route path="orders/:orderId" element={<OrderEditorPage />} />
      <Route path="customers" element={<CustomersPage />} />
      <Route path="customers/new" element={<NewCustomerPage />} />
      <Route path="tickets" element={<TicketsPage />} />
      <Route path="tickets/:ticketId" element={<TicketsPage />} />
      <Route path="customers/:profileId" element={<CustomerEditorPage />} />
      <Route path="scenarios" element={<ScenariosPage />} />
      <Route path="scenarios/:scenarioId" element={<ScenarioEditorPage />} />
      <Route path="scenarios/:scenarioId/snapshots" element={<SnapshotsPage />} />
      <Route path="setup/identity" element={<ShopIdentityPage />} />
      <Route path="setup/policies" element={<PoliciesAndFaqPage />} />
      <Route path="setup/support" element={<SupportGuidelinesPage />} />
      <Route path="setup/tone" element={<ToneOfVoicePage />} />
      <Route path="versions/:version" element={<ShopVersionPage />} />
    </Route>
    <Route path="*" element={<Navigate to="/shops" replace />} />
  </Route>,
);

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
function LabRedirect({ to }: { to: (params: Readonly<Params<string>>) => string }) {
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

/**
 * Where the app opens, from the *Where the app opens* preference (ADR 0054).
 *
 * The control that writes it is a later slice's; the resolution is written once here so that
 * the constant this route used to be cannot come to disagree with the preference that replaces
 * it. The remembered shop is resolved against the shop list rather than dereferenced — a shop
 * removed since the last visit would otherwise open on an error page — which is why the
 * default path mounts a component and the other two do not need to.
 */
function Landing() {
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

function RedirectRetiredGlossary() {
  const { hash } = useLocation();
  return <Navigate to={{ pathname: "/glossary", hash }} replace />;
}
