export const API_VERSION = "v1" as const;

export type { components, operations, paths } from "./generated/v1";

import type { components } from "./generated/v1";

export type ErrorResponse = components["schemas"]["ErrorResponse"];
export type ActionProposalResponse = components["schemas"]["ActionProposalResponse"];
export type AgentFrameworkListResponse = components["schemas"]["AgentFrameworkListResponse"];
export type ConversationResponse = components["schemas"]["ConversationResponse"];
export type GenerateScenarioRequest = components["schemas"]["GenerateScenarioRequest"];
export type DecideOrderActionRequest = components["schemas"]["DecideOrderActionRequest"];
export type GeneratedScenarioResponse = components["schemas"]["GeneratedScenarioResponse"];
export type SendConversationMessageRequest =
  components["schemas"]["SendConversationMessageRequest"];
export type StartConversationRequest = components["schemas"]["StartConversationRequest"];
export type ProposeOrderActionRequest = components["schemas"]["ProposeOrderActionRequest"];
