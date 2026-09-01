import { Navigate, Route, Routes } from "react-router-dom";
import { AgentConfigurationEditorPage } from "./routes/AgentConfigurationEditorPage";
import { AgentConfigurationsPage } from "./routes/AgentConfigurationsPage";
import { MutationBlockEditorPage, ObjectiveBlockEditorPage } from "./routes/BlockEditorPage";
import { MutationBlocksPage, ObjectiveBlocksPage } from "./routes/BlockLibraryPage";
import { CustomerEditorPage } from "./routes/CustomerEditorPage";
import { CustomersPage } from "./routes/CustomersPage";
import { ExperimentBenchPage } from "./routes/ExperimentBenchPage";
import { ExperimentSetupPage } from "./routes/ExperimentSetupPage";
import { ExperimentTimelinePage } from "./routes/ExperimentTimelinePage";
import { JudgeConfigurationEditorPage } from "./routes/JudgeConfigurationEditorPage";
import { JudgeConfigurationsPage } from "./routes/JudgeConfigurationsPage";
import { OrderEditorPage } from "./routes/OrderEditorPage";
import { OrdersPage } from "./routes/OrdersPage";
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
import { ShopsPage } from "./routes/ShopsPage";
import { ShopVersionPage } from "./routes/ShopVersionPage";
import { SnapshotsPage } from "./routes/SnapshotsPage";
import { SupportIdentitiesPage } from "./routes/SupportIdentitiesPage";
import { SupportIdentityEditorPage } from "./routes/SupportIdentityEditorPage";
import { TicketsPage } from "./routes/TicketsPage";
import { ShopWorkspace } from "./shell/ShopWorkspace";

export function App() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/shops" replace />} />
      <Route path="/shops" element={<ShopsPage />} />
      <Route path="/shops/:shopId" element={<ShopWorkspace />}>
        <Route index element={<ShopHomePage />} />
        <Route path="products" element={<ProductsPage />} />
        <Route path="products/:handle" element={<ProductEditorPage />} />
        <Route path="orders" element={<OrdersPage />} />
        <Route path="orders/:orderId" element={<OrderEditorPage />} />
        <Route path="customers" element={<CustomersPage />} />
        <Route path="tickets" element={<TicketsPage />} />
        <Route path="tickets/:ticketId" element={<TicketsPage />} />
        <Route path="customers/:profileId" element={<CustomerEditorPage />} />
        <Route path="bench" element={<ExperimentSetupPage />} />
        <Route path="bench/:experimentId" element={<ExperimentBenchPage />} />
        <Route path="bench/:experimentId/timeline" element={<ExperimentTimelinePage />} />
        <Route path="scenarios" element={<ScenariosPage />} />
        <Route path="scenarios/:scenarioId" element={<ScenarioEditorPage />} />
        <Route path="scenarios/:scenarioId/snapshots" element={<SnapshotsPage />} />
        <Route path="objective-blocks" element={<ObjectiveBlocksPage />} />
        <Route path="objective-blocks/:blockId" element={<ObjectiveBlockEditorPage />} />
        <Route path="mutation-blocks" element={<MutationBlocksPage />} />
        <Route path="mutation-blocks/:blockId" element={<MutationBlockEditorPage />} />
        <Route path="support-identities" element={<SupportIdentitiesPage />} />
        <Route path="agent-configurations" element={<AgentConfigurationsPage />} />
        <Route
          path="agent-configurations/:configurationId"
          element={<AgentConfigurationEditorPage />}
        />
        <Route path="judges" element={<JudgeConfigurationsPage />} />
        <Route path="judges/:judgeId" element={<JudgeConfigurationEditorPage />} />
        <Route path="support-identities/:identityId" element={<SupportIdentityEditorPage />} />
        <Route path="setup/identity" element={<ShopIdentityPage />} />
        <Route path="setup/policies" element={<PoliciesAndFaqPage />} />
        <Route path="setup/support" element={<SupportGuidelinesPage />} />
        <Route path="setup/tone" element={<ToneOfVoicePage />} />
        <Route path="versions/:version" element={<ShopVersionPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/shops" replace />} />
    </Routes>
  );
}
