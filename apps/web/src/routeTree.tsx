import { createRoutesFromElements, Navigate, type Params, Route } from "react-router-dom";
import { AgentConfigurationEditorPage } from "./routes/AgentConfigurationEditorPage";
import {
  AgentConfigurationsPage,
  NewAgentConfigurationPage,
} from "./routes/AgentConfigurationsPage";
import { MutationBlockEditorPage, ObjectiveBlockEditorPage } from "./routes/BlockEditorPage";
import {
  MutationBlocksPage,
  NewMutationBlockPage,
  NewObjectiveBlockPage,
  ObjectiveBlocksPage,
} from "./routes/BlockLibraryPage";
import { CustomerEditorRoute } from "./routes/CustomerEditorPage";
import { CustomersPage, NewCustomerPage } from "./routes/CustomersPage";
import { DocumentEditorPage } from "./routes/DocumentEditorPage";
import { DocumentsPage, NewDocumentPage } from "./routes/DocumentsPage";
import { ExperimentBenchRoute } from "./routes/ExperimentBenchPage";
import { ExperimentConversationPage } from "./routes/ExperimentConversationPage";
import { ExperimentHistoryPage } from "./routes/ExperimentHistoryPage";
import { ExperimentResultsLayout } from "./routes/ExperimentResultsLayout";
import { ExperimentResultsPage } from "./routes/ExperimentResultsPage";
import { ExperimentSetupPage } from "./routes/ExperimentSetupPage";
import { ExperimentTimelinePage } from "./routes/ExperimentTimelinePage";
import { ExperimentTracesPage } from "./routes/ExperimentTracesPage";
import { GlossaryPage } from "./routes/GlossaryPage";
import { JudgeConfigurationEditorPage } from "./routes/JudgeConfigurationEditorPage";
import { JudgeConfigurationsPage, NewJudgePage } from "./routes/JudgeConfigurationsPage";
import { LabSettingsPage } from "./routes/LabSettingsPage";
import { Landing } from "./routes/Landing";
import { OrderEditorPage } from "./routes/OrderEditorPage";
import { NewOrderPage, OrdersPage } from "./routes/OrdersPage";
import { ProductEditorRoute } from "./routes/ProductEditorPage";
import { ProductsPage } from "./routes/ProductsPage";
import {
  LabRedirect,
  RedirectRetiredGlossary,
  RedirectRetiredGuidelines,
} from "./routes/RedirectRoutes";
import { ScenarioEditorPage } from "./routes/ScenarioEditorPage";
import { NewScenarioPage, ScenariosPage } from "./routes/ScenariosPage";
import { ShopHomePage } from "./routes/ShopHomePage";
import { ShopIdentityPage, ToneOfVoicePage } from "./routes/ShopSetupPages";
import { NewShopPage, ShopsPage } from "./routes/ShopsPage";
import { ShopVersionPage } from "./routes/ShopVersionPage";
import { SnapshotsPage } from "./routes/SnapshotsPage";
import { NewSupportIdentityPage, SupportIdentitiesPage } from "./routes/SupportIdentitiesPage";
import { SupportIdentityEditorPage } from "./routes/SupportIdentityEditorPage";
import { TicketEditorRoute } from "./routes/TicketEditorPage";
import { NewTicketPage, TicketsPage } from "./routes/TicketsPage";
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
      <Route path="bench/:shopId/:experimentId" element={<ExperimentBenchRoute />} />
      <Route path="bench/:shopId/:experimentId/results" element={<ExperimentResultsLayout />}>
        <Route index element={<ExperimentResultsPage />} />
        <Route path="conversation" element={<ExperimentConversationPage />} />
        <Route path="timeline" element={<ExperimentTimelinePage />} />
        <Route path="traces" element={<ExperimentTracesPage />} />
      </Route>
      <Route path="history" element={<ExperimentHistoryPage />} />
      <Route path="agent-configurations" element={<AgentConfigurationsPage />} />
      {/* Creating is a page here too, and all four of the lab's libraries have one
          (PLAN-UX Slice 13). `new` is a static segment and outranks the identifier
          beside it, so a template an operator names `new` still reaches its editor. */}
      <Route path="agent-configurations/new" element={<NewAgentConfigurationPage />} />
      <Route
        path="agent-configurations/:configurationId"
        element={<AgentConfigurationEditorPage />}
      />
      <Route path="judges" element={<JudgeConfigurationsPage />} />
      <Route path="judges/new" element={<NewJudgePage />} />
      <Route path="judges/:judgeId" element={<JudgeConfigurationEditorPage />} />
      <Route path="support-identities" element={<SupportIdentitiesPage />} />
      {/* The library left shop scope with ADR 0054 and is reached from both rails, so its
          create page is the lab's too (PLAN-UX Slice 12). */}
      <Route path="support-identities/new" element={<NewSupportIdentityPage />} />
      <Route path="support-identities/:identityId" element={<SupportIdentityEditorPage />} />
      <Route path="objective-blocks" element={<ObjectiveBlocksPage />} />
      <Route path="objective-blocks/new" element={<NewObjectiveBlockPage />} />
      <Route path="objective-blocks/:blockId" element={<ObjectiveBlockEditorPage />} />
      <Route path="mutation-blocks" element={<MutationBlocksPage />} />
      <Route path="mutation-blocks/new" element={<NewMutationBlockPage />} />
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
      <Route path="products/:handle" element={<ProductEditorRoute />} />
      <Route path="orders" element={<OrdersPage />} />
      <Route path="orders/new" element={<NewOrderPage />} />
      <Route path="orders/:orderId" element={<OrderEditorPage />} />
      <Route path="customers" element={<CustomersPage />} />
      <Route path="customers/new" element={<NewCustomerPage />} />
      <Route path="tickets" element={<TicketsPage />} />
      {/* Opening a ticket is a page that lands in its editor (ADR 0073); `new` is a static
          segment and outranks the identifier beside it. */}
      <Route path="tickets/new" element={<NewTicketPage />} />
      <Route path="tickets/:ticketId" element={<TicketEditorRoute />} />
      <Route path="customers/:profileId" element={<CustomerEditorRoute />} />
      <Route path="scenarios" element={<ScenariosPage />} />
      {/* Creating the scenario is a page too: `new` is a static segment and
          outranks the identifier beside it. */}
      <Route path="scenarios/new" element={<NewScenarioPage />} />
      <Route path="scenarios/:scenarioId" element={<ScenarioEditorPage />} />
      <Route path="scenarios/:scenarioId/snapshots" element={<SnapshotsPage />} />
      <Route path="setup/identity" element={<ShopIdentityPage />} />
      {/* The shop's three document collections, drawn as one table (PLAN-UX Slice 16). The
          address is the rail's, which ADR 0054 fixed; what it draws is the Documents table. */}
      <Route path="setup/policies" element={<DocumentsPage />} />
      {/* Creating a document is a page, because its kind is a question its editor cannot ask
          (ADR 0057). `new` is a static segment and cannot be reached by a kind slug. */}
      <Route path="setup/documents/new" element={<NewDocumentPage />} />
      <Route path="setup/documents/:kind/:docId" element={<DocumentEditorPage />} />
      {/* Support guidelines left the rail with ADR 0054 and left the route table here: the
          guidelines are rows of the Documents table now, and the old address opens it on
          them rather than on nothing. */}
      <Route path="setup/support" element={<RedirectRetiredGuidelines />} />
      <Route path="setup/tone" element={<ToneOfVoicePage />} />
      <Route path="versions/:version" element={<ShopVersionPage />} />
    </Route>
    <Route path="*" element={<Navigate to="/shops" replace />} />
  </Route>,
);
