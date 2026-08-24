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
