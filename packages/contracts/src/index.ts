export const API_VERSION = "v1" as const;

export type { components, operations, paths } from "./generated/v1";

import type { components } from "./generated/v1";

export type ErrorResponse = components["schemas"]["ErrorResponse"];
export type ActionProposalResponse = components["schemas"]["ActionProposalResponse"];
export type AgentFrameworkListResponse = components["schemas"]["AgentFrameworkListResponse"];
export type ConversationResponse = components["schemas"]["ConversationResponse"];
export type ConversationSummaryResponse = components["schemas"]["ConversationSummaryResponse"];
export type ConversationListResponse = components["schemas"]["ConversationListResponse"];
export type GeneratedScenarioSummaryResponse =
  components["schemas"]["GeneratedScenarioSummaryResponse"];
export type GeneratedScenarioListResponse = components["schemas"]["GeneratedScenarioListResponse"];
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
export type SandboxSnapshotSummarySchema = components["schemas"]["SandboxSnapshotSummarySchema"];
export type SandboxStateSchema = components["schemas"]["SandboxStateSchema"];
export type SandboxInteractionSchema = components["schemas"]["SandboxInteractionSchema"];
export type SandboxOrderSchema = components["schemas"]["SandboxOrderSchema"];
export type SandboxPinSchema = components["schemas"]["SandboxPinSchema"];
export type MaterializeSnapshotRequest = components["schemas"]["MaterializeSnapshotRequest"];
export type DefinitionValidationErrorResponse =
  components["schemas"]["DefinitionValidationErrorResponse"];
