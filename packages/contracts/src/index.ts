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
export type ShopListResponse = components["schemas"]["ShopListResponse"];
export type ShopSummarySchema = components["schemas"]["ShopSummarySchema"];
export type ShopDraftResponse = components["schemas"]["ShopDraftResponse"];
export type ShopVersionResponse = components["schemas"]["ShopVersionResponse"];
export type ShopVersionListResponse = components["schemas"]["ShopVersionListResponse"];
export type ShopPreviewResponse = components["schemas"]["ShopPreviewResponse"];
export type ShopContentSchema = components["schemas"]["ShopContentSchema"];
export type ShopPayloadSchema = components["schemas"]["ShopPayloadSchema"];
export type ShopIdentitySchema = components["schemas"]["ShopIdentitySchema"];
export type ProductSchema = components["schemas"]["ProductSchema"];
export type ProductViewSchema = components["schemas"]["ProductViewSchema"];
export type VariantSchema = components["schemas"]["VariantSchema"];
export type OptionSchema = components["schemas"]["OptionSchema"];
export type AttributeSchema = components["schemas"]["AttributeSchema"];
export type MediaReferenceSchema = components["schemas"]["MediaReferenceSchema"];
export type ReviewSchema = components["schemas"]["ReviewSchema"];
export type FaqEntrySchema = components["schemas"]["FaqEntrySchema"];
export type PolicySchema = components["schemas"]["PolicySchema"];
export type PaymentMethodSchema = components["schemas"]["PaymentMethodSchema"];
export type FulfilmentMethodSchema = components["schemas"]["FulfilmentMethodSchema"];
export type SupportGuidelineSchema = components["schemas"]["SupportGuidelineSchema"];
export type ToneOfVoiceSchema = components["schemas"]["ToneOfVoiceSchema"];
export type CreateShopRequest = components["schemas"]["CreateShopRequest"];
export type ReplaceShopDraftRequest = components["schemas"]["ReplaceShopDraftRequest"];
export type DefinitionIssueSchema = components["schemas"]["DefinitionIssueSchema"];
export type DefinitionChangeSchema = components["schemas"]["DefinitionChangeSchema"];
export type DefinitionVersionSummarySchema =
  components["schemas"]["DefinitionVersionSummarySchema"];
export type CustomerProfileListResponse = components["schemas"]["CustomerProfileListResponse"];
export type CustomerProfileSummarySchema = components["schemas"]["CustomerProfileSummarySchema"];
export type CustomerProfileDraftResponse = components["schemas"]["CustomerProfileDraftResponse"];
export type CustomerProfileVersionResponse =
  components["schemas"]["CustomerProfileVersionResponse"];
export type CustomerProfileVersionListResponse =
  components["schemas"]["CustomerProfileVersionListResponse"];
export type CustomerProfilePreviewResponse =
  components["schemas"]["CustomerProfilePreviewResponse"];
export type CustomerProfileShopsResponse = components["schemas"]["CustomerProfileShopsResponse"];
export type CustomerProfileContentSchema = components["schemas"]["CustomerProfileContentSchema"];
export type CustomerProfilePayloadSchema = components["schemas"]["CustomerProfilePayloadSchema"];
export type CustomerIdentitySchema = components["schemas"]["CustomerIdentitySchema"];
export type AccountFactsSchema = components["schemas"]["AccountFactsSchema"];
export type AddressSchema = components["schemas"]["AddressSchema"];
export type PersonaSchema = components["schemas"]["PersonaSchema"];
export type BackgroundEntrySchema = components["schemas"]["BackgroundEntrySchema"];
export type HiddenFactSchema = components["schemas"]["HiddenFactSchema"];
export type CreateCustomerProfileRequest = components["schemas"]["CreateCustomerProfileRequest"];
export type ReplaceCustomerProfileDraftRequest =
  components["schemas"]["ReplaceCustomerProfileDraftRequest"];
export type SupportIdentityListResponse = components["schemas"]["SupportIdentityListResponse"];
export type SupportIdentitySummarySchema = components["schemas"]["SupportIdentitySummarySchema"];
export type SupportIdentityDraftResponse = components["schemas"]["SupportIdentityDraftResponse"];
export type SupportIdentityVersionResponse =
  components["schemas"]["SupportIdentityVersionResponse"];
export type SupportIdentityVersionListResponse =
  components["schemas"]["SupportIdentityVersionListResponse"];
export type SupportIdentityPreviewResponse =
  components["schemas"]["SupportIdentityPreviewResponse"];
export type SupportIdentityPayloadSchema = components["schemas"]["SupportIdentityPayloadSchema"];
export type SupportRoleSchema = components["schemas"]["SupportRoleSchema"];
export type GuidanceNoteSchema = components["schemas"]["GuidanceNoteSchema"];
export type EscalationPolicySchema = components["schemas"]["EscalationPolicySchema"];
export type SupportPermission = components["schemas"]["SupportPermission"];
export type AccountStatus = components["schemas"]["AccountStatus"];
export type LoyaltyTier = components["schemas"]["LoyaltyTier"];
export type BackgroundKind = components["schemas"]["BackgroundKind"];
export type CreateSupportIdentityRequest = components["schemas"]["CreateSupportIdentityRequest"];
export type ReplaceSupportIdentityDraftRequest =
  components["schemas"]["ReplaceSupportIdentityDraftRequest"];
export type OrderListResponse = components["schemas"]["OrderListResponse"];
export type OrderSummarySchema = components["schemas"]["OrderSummarySchema"];
export type ShopOrderResponse = components["schemas"]["ShopOrderResponse"];
export type OrderContentSchema = components["schemas"]["OrderContentSchema"];
export type OrderLineSchema = components["schemas"]["OrderLineSchema"];
export type OrderEventSchema = components["schemas"]["OrderEventSchema"];
export type OrderEventInputSchema = components["schemas"]["OrderEventInputSchema"];
export type OrderEventKind = components["schemas"]["OrderEventKind"];
export type OrderPaymentSchema = components["schemas"]["OrderPaymentSchema"];
export type OrderFulfilmentSchema = components["schemas"]["OrderFulfilmentSchema"];
export type ShippingAddressSchema = components["schemas"]["ShippingAddressSchema"];
export type PaymentStatus = components["schemas"]["PaymentStatus"];
export type FulfilmentStatus = components["schemas"]["FulfilmentStatus"];
export type CreateOrderRequest = components["schemas"]["CreateOrderRequest"];
export type ReplaceOrderRequest = components["schemas"]["ReplaceOrderRequest"];
export type TicketListResponse = components["schemas"]["TicketListResponse"];
export type TicketSummarySchema = components["schemas"]["TicketSummarySchema"];
export type TicketDraftResponse = components["schemas"]["TicketDraftResponse"];
export type TicketVersionResponse = components["schemas"]["TicketVersionResponse"];
export type TicketVersionListResponse = components["schemas"]["TicketVersionListResponse"];
export type TicketPreviewResponse = components["schemas"]["TicketPreviewResponse"];
export type TicketContentSchema = components["schemas"]["TicketContentSchema"];
export type TicketPayloadSchema = components["schemas"]["TicketPayloadSchema"];
export type TicketMessageSchema = components["schemas"]["TicketMessageSchema"];
export type TicketOriginSchema = components["schemas"]["TicketOriginSchema"];
export type TicketOriginKind = components["schemas"]["TicketOriginKind"];
export type TicketStatus = components["schemas"]["TicketStatus"];
export type TicketAuthor = components["schemas"]["TicketAuthor"];
export type SuggestedDocumentSchema = components["schemas"]["SuggestedDocumentSchema"];
export type ShopDocumentKind = components["schemas"]["ShopDocumentKind"];
export type TicketContextSchema = components["schemas"]["TicketContextSchema"];
export type TicketCustomerSchema = components["schemas"]["TicketCustomerSchema"];
export type TicketOrderSchema = components["schemas"]["TicketOrderSchema"];
export type TicketReferenceSchema = components["schemas"]["TicketReferenceSchema"];
export type TicketShopResourcesSchema = components["schemas"]["TicketShopResourcesSchema"];
export type CreateTicketRequest = components["schemas"]["CreateTicketRequest"];
export type BlockListResponse = components["schemas"]["BlockListResponse"];
export type BlockSummarySchema = components["schemas"]["BlockSummarySchema"];
export type BlockParameterSchema = components["schemas"]["BlockParameterSchema"];
export type BlockParameterKind = components["schemas"]["BlockParameterKind"];
export type CreateBlockRequest = components["schemas"]["CreateBlockRequest"];
export type ObjectiveAssessment = components["schemas"]["ObjectiveAssessment"];
export type ObjectiveEvidence = components["schemas"]["ObjectiveEvidence"];
export type MutationEffect = components["schemas"]["MutationEffect"];
export type ObjectiveBlockDraftResponse = components["schemas"]["ObjectiveBlockDraftResponse"];
export type ObjectiveBlockVersionResponse = components["schemas"]["ObjectiveBlockVersionResponse"];
export type ObjectiveBlockPreviewResponse = components["schemas"]["ObjectiveBlockPreviewResponse"];
export type ObjectiveBlockPayloadSchema = components["schemas"]["ObjectiveBlockPayloadSchema"];
export type ReplaceObjectiveBlockDraftRequest =
  components["schemas"]["ReplaceObjectiveBlockDraftRequest"];
export type MutationBlockDraftResponse = components["schemas"]["MutationBlockDraftResponse"];
export type MutationBlockVersionResponse = components["schemas"]["MutationBlockVersionResponse"];
export type MutationBlockPreviewResponse = components["schemas"]["MutationBlockPreviewResponse"];
export type MutationBlockPayloadSchema = components["schemas"]["MutationBlockPayloadSchema"];
export type ReplaceMutationBlockDraftRequest =
  components["schemas"]["ReplaceMutationBlockDraftRequest"];
export type ReplaceTicketDraftRequest = components["schemas"]["ReplaceTicketDraftRequest"];
export type SupportChannel = components["schemas"]["SupportChannel"];
export type ScenarioListResponse = components["schemas"]["ScenarioListResponse"];
export type ScenarioSummarySchema = components["schemas"]["ScenarioSummarySchema"];
export type ScenarioDraftResponse = components["schemas"]["ScenarioDraftResponse"];
export type ScenarioVersionResponse = components["schemas"]["ScenarioVersionResponse"];
export type ScenarioVersionListResponse = components["schemas"]["ScenarioVersionListResponse"];
export type ScenarioPreviewResponse = components["schemas"]["ScenarioPreviewResponse"];
export type ScenarioContentSchema = components["schemas"]["ScenarioContentSchema"];
export type ScenarioPayloadSchema = components["schemas"]["ScenarioPayloadSchema"];
export type ScenarioResourcesSchema = components["schemas"]["ScenarioResourcesSchema"];
export type ScenarioResolutionSchema = components["schemas"]["ScenarioResolutionSchema"];
export type ScenarioBlockOptionSchema = components["schemas"]["ScenarioBlockOptionSchema"];
export type ScenarioDocumentOptionSchema = components["schemas"]["ScenarioDocumentOptionSchema"];
export type ScenarioOrderOptionSchema = components["schemas"]["ScenarioOrderOptionSchema"];
export type ScenarioCustomerOptionSchema = components["schemas"]["ScenarioCustomerOptionSchema"];
export type ResolvedDocumentSchema = components["schemas"]["ResolvedDocumentSchema"];
export type ResolvedEntitySchema = components["schemas"]["ResolvedEntitySchema"];
export type ResolvedTemplateSchema = components["schemas"]["ResolvedTemplateSchema"];
export type ScenarioBindingSchema = components["schemas"]["ScenarioBindingSchema"];
export type BoundObjectiveSchema = components["schemas"]["BoundObjectiveSchema"];
export type BoundMutationSchema = components["schemas"]["BoundMutationSchema"];
export type ContextDocumentSchema = components["schemas"]["ContextDocumentSchema"];
export type CompletionConditionsSchema = components["schemas"]["CompletionConditionsSchema"];
export type ObjectiveSeverity = components["schemas"]["ObjectiveSeverity"];
export type ScenarioEntityKind = components["schemas"]["ScenarioEntityKind"];
export type CreateScenarioRequest = components["schemas"]["CreateScenarioRequest"];
export type ReplaceScenarioDraftRequest = components["schemas"]["ReplaceScenarioDraftRequest"];

export type SandboxSnapshotResponse = components["schemas"]["SandboxSnapshotResponse"];
export type SandboxSnapshotListResponse = components["schemas"]["SandboxSnapshotListResponse"];
export type SandboxResponse = components["schemas"]["SandboxResponse"];
export type SandboxSummarySchema = components["schemas"]["SandboxSummarySchema"];
export type SandboxListResponse = components["schemas"]["SandboxListResponse"];
export type CloneSandboxRequest = components["schemas"]["CloneSandboxRequest"];
export type SandboxSnapshotSummarySchema = components["schemas"]["SandboxSnapshotSummarySchema"];
export type SandboxStateSchema = components["schemas"]["SandboxStateSchema"];
export type SandboxInteractionSchema = components["schemas"]["SandboxInteractionSchema"];
export type SandboxOrderSchema = components["schemas"]["SandboxOrderSchema"];
export type SandboxPinSchema = components["schemas"]["SandboxPinSchema"];
export type MaterializeSnapshotRequest = components["schemas"]["MaterializeSnapshotRequest"];

export type ToolContractListResponse = components["schemas"]["ToolContractListResponse"];
export type ToolContractSchema = components["schemas"]["ToolContractSchema"];
export type ToolArgumentSchema = components["schemas"]["ToolArgumentSchema"];
export type ToolArgumentKind = components["schemas"]["ToolArgumentKind"];
export type ToolCallRequest = components["schemas"]["ToolCallRequest"];
export type ToolCallResponse = components["schemas"]["ToolCallResponse"];
export type ToolOutcome = components["schemas"]["ToolOutcome"];
export type ToolRefusalSchema = components["schemas"]["ToolRefusalSchema"];
export type DefinitionValidationErrorResponse =
  components["schemas"]["DefinitionValidationErrorResponse"];

export type AgentConfigurationListResponse =
  components["schemas"]["AgentConfigurationListResponse"];
export type AgentConfigurationSummarySchema =
  components["schemas"]["AgentConfigurationSummarySchema"];
export type AgentConfigurationDraftResponse =
  components["schemas"]["AgentConfigurationDraftResponse"];
export type AgentConfigurationVersionResponse =
  components["schemas"]["AgentConfigurationVersionResponse"];
export type AgentConfigurationVersionListResponse =
  components["schemas"]["AgentConfigurationVersionListResponse"];
export type AgentConfigurationPreviewResponse =
  components["schemas"]["AgentConfigurationPreviewResponse"];
export type AgentConfigurationPayloadSchema =
  components["schemas"]["AgentConfigurationPayloadSchema"];
export type AgentConfigurationResourcesResponse =
  components["schemas"]["AgentConfigurationResourcesResponse"];
export type AgentConfigurationResolutionSchema =
  components["schemas"]["AgentConfigurationResolutionSchema"];
export type CreateAgentConfigurationRequest =
  components["schemas"]["CreateAgentConfigurationRequest"];
export type ModelSettingsSchema = components["schemas"]["ModelSettingsSchema"];
export type ToneOfVoiceSelectionSchema = components["schemas"]["ToneOfVoiceSelectionSchema"];
export type ToneOfVoiceSource = components["schemas"]["ToneOfVoiceSource"];
export type MemoryMode = components["schemas"]["MemoryMode"];
export type AgentArchitecture = components["schemas"]["AgentArchitecture"];
export type ProvenFrameworkSchema = components["schemas"]["ProvenFrameworkSchema"];
export type PromptVariableSchema = components["schemas"]["PromptVariableSchema"];
export type PromptVariableGroup = components["schemas"]["PromptVariableGroup"];
export type ResolvedVariableSchema = components["schemas"]["ResolvedVariableSchema"];
export type ResolvedToolBindingSchema = components["schemas"]["ResolvedToolBindingSchema"];
export type SupportIdentityOptionSchema = components["schemas"]["SupportIdentityOptionSchema"];
export type PreviewShopOptionSchema = components["schemas"]["PreviewShopOptionSchema"];
export type ExperimentListResponse = components["schemas"]["ExperimentListResponse"];
export type ExperimentSummarySchema = components["schemas"]["ExperimentSummarySchema"];
export type ExperimentResponse = components["schemas"]["ExperimentResponse"];
export type ExperimentPreviewResponse = components["schemas"]["ExperimentPreviewResponse"];
export type StartExperimentRequest = components["schemas"]["StartExperimentRequest"];
export type ArmSelectionSchema = components["schemas"]["ArmSelectionSchema"];
export type ExperimentRunSchema = components["schemas"]["ExperimentRunSchema"];
export type ArmStandingSchema = components["schemas"]["ArmStandingSchema"];
export type ArmMetricsSchema = components["schemas"]["ArmMetricsSchema"];
export type ArmStateDiffSchema = components["schemas"]["ArmStateDiffSchema"];
export type OrderStateDiffSchema = components["schemas"]["OrderStateDiffSchema"];
export type FieldChangeSchema = components["schemas"]["FieldChangeSchema"];
export type ModelUsageSchema = components["schemas"]["ModelUsageSchema"];
export type EstimatedCostSchema = components["schemas"]["EstimatedCostSchema"];
export type ArmAwaiting = components["schemas"]["ArmAwaiting"];
export type ComparisonVariableSchema = components["schemas"]["ComparisonVariableSchema"];
export type ComparisonDimension = components["schemas"]["ComparisonDimension"];
export type ParticipantTurnSchema = components["schemas"]["ParticipantTurnSchema"];
export type ParticipantTurnListResponse = components["schemas"]["ParticipantTurnListResponse"];
export type ParticipantTurnRequest = components["schemas"]["ParticipantTurnRequest"];
export type ParticipantDriverType = components["schemas"]["ParticipantDriverType"];
export type ParticipantTurnSource = components["schemas"]["ParticipantTurnSource"];
export type AgentTurnSchema = components["schemas"]["AgentTurnSchema"];
export type AgentTurnOutcome = components["schemas"]["AgentTurnOutcome"];
export type AgentTurnFailure = components["schemas"]["AgentTurnFailure"];
export type ToolEventSchema = components["schemas"]["ToolEventSchema"];
export type MutationEventSchema = components["schemas"]["MutationEventSchema"];
export type RunTurnResponse = components["schemas"]["RunTurnResponse"];
export type ExperimentEvaluationResponse = components["schemas"]["ExperimentEvaluationResponse"];
export type ArmEvaluationSchema = components["schemas"]["ArmEvaluationSchema"];
export type ObjectiveResultSchema = components["schemas"]["ObjectiveResultSchema"];
export type ObjectiveOutcome = components["schemas"]["ObjectiveOutcome"];
export type ExperimentTimelineResponse = components["schemas"]["ExperimentTimelineResponse"];
export type TimelineEntrySchema = components["schemas"]["TimelineEntrySchema"];
export type TimelineEntryKind = components["schemas"]["TimelineEntryKind"];
export type TimelineCategory = components["schemas"]["TimelineCategory"];
export type SourceLocationSchema = components["schemas"]["SourceLocationSchema"];
export type ExperimentTracesResponse = components["schemas"]["ExperimentTracesResponse"];
export type RunTraceSchema = components["schemas"]["RunTraceSchema"];
export type RunTraceSpanSchema = components["schemas"]["RunTraceSpanSchema"];
export type SpanKind = components["schemas"]["SpanKind"];
export type ResolvedDefinitionSchema = components["schemas"]["ResolvedDefinitionSchema"];
export type JudgementSchema = components["schemas"]["JudgementSchema"];
export type JudgeOutcome = components["schemas"]["JudgeOutcome"];
export type JudgeFailure = components["schemas"]["JudgeFailure"];
export type ScoreExperimentRequest = components["schemas"]["ScoreExperimentRequest"];
export type ExperimentAnnotationsResponse = components["schemas"]["ExperimentAnnotationsResponse"];
export type ExperimentNoteSchema = components["schemas"]["ExperimentNoteSchema"];
export type AddExperimentNoteRequest = components["schemas"]["AddExperimentNoteRequest"];
export type SetExperimentTagsRequest = components["schemas"]["SetExperimentTagsRequest"];
export type ExperimentHistoryResponse = components["schemas"]["ExperimentHistoryResponse"];
export type ExperimentHistoryEntrySchema = components["schemas"]["ExperimentHistoryEntrySchema"];
export type HistoryArmSchema = components["schemas"]["HistoryArmSchema"];
export type HistoryFacetSchema = components["schemas"]["HistoryFacetSchema"];
export type JudgeConfigurationListResponse =
  components["schemas"]["JudgeConfigurationListResponse"];
export type JudgeConfigurationSummarySchema =
  components["schemas"]["JudgeConfigurationSummarySchema"];
export type JudgeConfigurationDraftResponse =
  components["schemas"]["JudgeConfigurationDraftResponse"];
export type JudgeConfigurationVersionResponse =
  components["schemas"]["JudgeConfigurationVersionResponse"];
export type JudgeConfigurationVersionListResponse =
  components["schemas"]["JudgeConfigurationVersionListResponse"];
export type JudgeConfigurationPreviewResponse =
  components["schemas"]["JudgeConfigurationPreviewResponse"];
export type JudgeConfigurationResourcesResponse =
  components["schemas"]["JudgeConfigurationResourcesResponse"];
export type JudgeConfigurationPayloadSchema =
  components["schemas"]["JudgeConfigurationPayloadSchema"];
export type JudgeModelSchema = components["schemas"]["JudgeModelSchema"];
export type JudgeEvidenceScope = components["schemas"]["JudgeEvidenceScope"];
export type ProvenJudgeSchema = components["schemas"]["ProvenJudgeSchema"];
export type CreateJudgeConfigurationRequest =
  components["schemas"]["CreateJudgeConfigurationRequest"];
export type ReplaceJudgeConfigurationDraftRequest =
  components["schemas"]["ReplaceJudgeConfigurationDraftRequest"];
