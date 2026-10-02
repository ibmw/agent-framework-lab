import { describe, expect, it } from "vitest";
import contentDomain from "../../../api/src/capability_lab/domain/content.py?raw";
import experimentDomain from "../../../api/src/capability_lab/domain/experiment.py?raw";
import { SLUG_MAX_LENGTH } from "./entryIds";
import { EXPERIMENT_LABEL_MAX_LENGTH } from "./experimentStart";
import {
  CHIP_LABEL_MAX_LENGTH,
  LABEL_MAX_LENGTH,
  NOTE_MAX_LENGTH,
  TEXT_MAX_LENGTH,
  TICKET_TAG_MAX_LENGTH,
} from "./fieldRules";
import { METHOD_LABEL_MAX_LENGTH } from "./shopMethods";

/**
 * Every text the operator types stops where the lab would refuse it.
 *
 * Enumerated from both ends, as `idFieldCaps.test.ts` does for identifiers. From the lab's end,
 * every `require_label`, `require_text` and `require_email` call in the domain (and the two the
 * application makes) is read out of the Python and must be in `RULES`: either the controls that
 * type it, or why nothing does. From the workspace's end, every text control in every page and
 * component — each `<input>` that takes text, each `<textarea>`, each `ChipListField` and
 * `DerivedIdField` — is found in the source and must be in `CONTROLS`, with the `maxLength` of the
 * rule its value is sent to, or with why it carries none. A new rule, or a new control, fails here
 * until someone reads which it is. Every call of the three is counted as well, whatever its
 * arguments look like, so a call the field-name reading cannot parse fails rather than slipping by.
 *
 * The sweep reads the three shared caps only. A stricter cap one field adds on top of its rule —
 * `MAX_NOTE_LENGTH` on a run note, `MAX_PARTICIPANT_TURN_LENGTH` on a turn, `MAX_RATIONALE_LENGTH`
 * on a verdict's rationale — is bound by the row that names it in `RULES`, not found by the sweep:
 * a new one is caught only by whoever writes that row.
 */

const pages = import.meta.glob(["../**/*.tsx", "!../**/*.test.tsx"], {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

const python = import.meta.glob(
  [
    "../../../api/src/capability_lab/domain/*.py",
    "../../../api/src/capability_lab/application/*.py",
  ],
  { query: "?raw", import: "default", eager: true },
) as Record<string, string>;

/** The caps, by the name a call site passes them under. Each is held to the backend below. */
const CAPS: Record<string, number> = {
  LABEL_MAX_LENGTH,
  TEXT_MAX_LENGTH,
  NOTE_MAX_LENGTH,
  CHIP_LABEL_MAX_LENGTH,
  METHOD_LABEL_MAX_LENGTH,
  EXPERIMENT_LABEL_MAX_LENGTH,
  SLUG_MAX_LENGTH,
  TICKET_TAG_MAX_LENGTH,
};

type Cap = keyof typeof CAPS;

/**
 * Every text control, by file and what it holds — its `value`, or its `label` for a component,
 * with `#2` on a second control of the same key — and the cap its `maxLength` names; or the
 * prop a component forwards its caller's cap through; or why it carries none.
 */
const CONTROLS: Record<string, Cap | { forwards: string } | { none: string }> = {
  // Components: a cap their caller gives them, or a value no length rule reads.
  "ChipListField.tsx · typed": { forwards: "each call site is swept as `ChipListField`" },
  "DerivedIdField.tsx · shown": { forwards: "each call site is swept as `DerivedIdField`" },
  "CountryField.tsx · value": { none: "a two-letter code, `require_country_code`" },
  "LocaleField.tsx · value": { none: "a locale shaped like en or en-GB, `require_locale`" },
  "ParameterForm.tsx · label": {
    none: "never sent: the identifier derived from it is cut to its cap (`toIdentifier`, `uniqueParameterName`)",
  },
  "ProvenModelField.tsx · value": "LABEL_MAX_LENGTH",
  "SandboxToolConsole.tsx · value": {
    none: "a tool argument, bounded by the tool contract's own props (`argumentInputProps`)",
  },
  "SearchField.tsx · value": { none: "a query, never stored" },

  "AgentConfigurationEditorPage.tsx · content.name": "LABEL_MAX_LENGTH",
  "AgentConfigurationEditorPage.tsx · content.tone_of_voice.guideline_id": "SLUG_MAX_LENGTH",
  "AgentConfigurationEditorPage.tsx · content.model.temperature": {
    none: "a decimal, `TEMPERATURE_PATTERN`",
  },
  "AgentConfigurationEditorPage.tsx · content.description": "TEXT_MAX_LENGTH",
  "AgentConfigurationEditorPage.tsx · content.prompt": "TEXT_MAX_LENGTH",
  "AgentConfigurationsPage.tsx · name": "LABEL_MAX_LENGTH",

  "BlockEditorPage.tsx · content.name": "SLUG_MAX_LENGTH",
  "BlockEditorPage.tsx · content.statement": "TEXT_MAX_LENGTH",
  "BlockEditorPage.tsx · form.fields.label": {
    none: "never sent: the identifier derived from it is cut to its cap (`toIdentifier`, `uniqueParameterName`)",
  },
  "BlockEditorPage.tsx · form.fields.description": "TEXT_MAX_LENGTH",
  'BlockEditorPage.tsx · form.fields.default ?? ""': "TEXT_MAX_LENGTH",
  "BlockEditorPage.tsx · content.description": "TEXT_MAX_LENGTH",
  "BlockLibraryPage.tsx · label": {
    none: "never sent: the slug derived from it is cut to its cap (`toSlug`)",
  },

  "CustomerEditorPage.tsx · content.identity.given_name": "LABEL_MAX_LENGTH",
  "CustomerEditorPage.tsx · content.identity.family_name": "LABEL_MAX_LENGTH",
  "CustomerEditorPage.tsx · content.identity.email": "LABEL_MAX_LENGTH",
  'CustomerEditorPage.tsx · content.identity.phone ?? ""': {
    none: "a phone number, which `require_phone`'s pattern holds to 32 characters",
  },
  "CustomerEditorPage.tsx · form.fields[field]": "LABEL_MAX_LENGTH",
  "CustomerEditorPage.tsx · form.fields.note": "TEXT_MAX_LENGTH",
  "CustomerEditorPage.tsx · form.fields.note #2": "TEXT_MAX_LENGTH",
  "CustomerEditorPage.tsx · form.fields.revealedWhen": "TEXT_MAX_LENGTH",
  "CustomerEditorPage.tsx · content.account.notes": "TEXT_MAX_LENGTH",
  "CustomerEditorPage.tsx · content.persona.summary": "TEXT_MAX_LENGTH",
  "CustomerEditorPage.tsx · ChipListField New trait": "CHIP_LABEL_MAX_LENGTH",
  "CustomersPage.tsx · givenName": "LABEL_MAX_LENGTH",
  "CustomersPage.tsx · familyName": "LABEL_MAX_LENGTH",
  "CustomersPage.tsx · email": "LABEL_MAX_LENGTH",

  "DocumentEditorPage.tsx · document.title": "LABEL_MAX_LENGTH",
  "DocumentEditorPage.tsx · document.body": "TEXT_MAX_LENGTH",
  "DocumentsPage.tsx · title": "LABEL_MAX_LENGTH",
  "DocumentsPage.tsx · DerivedIdField Slug": "SLUG_MAX_LENGTH",

  "ExperimentBenchPage.tsx · message": "TEXT_MAX_LENGTH",
  "ExperimentResultsPage.tsx · tag": {
    none: "folded before it is stored (`fold_tag`), so its typed length is not the length kept",
  },
  "ExperimentResultsPage.tsx · note": "NOTE_MAX_LENGTH",
  "ExperimentSetupPage.tsx · DerivedIdField Name": "EXPERIMENT_LABEL_MAX_LENGTH",

  "JudgeConfigurationEditorPage.tsx · content.name": "LABEL_MAX_LENGTH",
  "JudgeConfigurationEditorPage.tsx · content.description": "TEXT_MAX_LENGTH",
  "JudgeConfigurationEditorPage.tsx · content.model.temperature": {
    none: "a decimal, `TEMPERATURE_PATTERN`",
  },
  "JudgeConfigurationEditorPage.tsx · content.rubric": "TEXT_MAX_LENGTH",
  "JudgeConfigurationsPage.tsx · name": "LABEL_MAX_LENGTH",
  "JudgeConfigurationsPage.tsx · rubric": "TEXT_MAX_LENGTH",

  'LabSettingsPage.tsx · typed ?? ""': {
    none: "a provider's key, kept as a secret and read by no text rule",
  },
  "LabSettingsPage.tsx · baseUrl": {
    none: "an endpoint URL, which the connection's own rule reads",
  },

  "OrderEditorPage.tsx · content.shipping_fee.amount": { none: "an amount, `MONEY_PATTERN`" },
  "OrderEditorPage.tsx · form.fields.summary": "TEXT_MAX_LENGTH",
  "OrdersPage.tsx · DerivedIdField Reference": "SLUG_MAX_LENGTH",

  "ProductEditorPage.tsx · product.title": "LABEL_MAX_LENGTH",
  "ProductEditorPage.tsx · product.category": "LABEL_MAX_LENGTH",
  "ProductEditorPage.tsx · form.fields.name": "LABEL_MAX_LENGTH",
  "ProductEditorPage.tsx · rowEdit.fields.sku": "SLUG_MAX_LENGTH",
  'ProductEditorPage.tsx · variant.price?.amount ?? ""': { none: "an amount, `MONEY_PATTERN`" },
  "ProductEditorPage.tsx · amount": { none: "an amount, `MONEY_PATTERN`" },
  "ProductEditorPage.tsx · form.fields.altText": "LABEL_MAX_LENGTH",
  "ProductEditorPage.tsx · form.fields.label": "LABEL_MAX_LENGTH",
  "ProductEditorPage.tsx · form.fields.value": "LABEL_MAX_LENGTH",
  "ProductEditorPage.tsx · form.fields.unit": "LABEL_MAX_LENGTH",
  "ProductEditorPage.tsx · form.fields.author": "LABEL_MAX_LENGTH",
  "ProductEditorPage.tsx · form.fields.body": "TEXT_MAX_LENGTH",
  "ProductEditorPage.tsx · product.description": "TEXT_MAX_LENGTH",
  "ProductEditorPage.tsx · ChipListField New value": "CHIP_LABEL_MAX_LENGTH",
  "ProductEditorPage.tsx · ChipListField New choice": "CHIP_LABEL_MAX_LENGTH",
  "ProductEditorPage.tsx · DerivedIdField Handle": "SLUG_MAX_LENGTH",
  "ProductEditorPage.tsx · DerivedIdField Option key": "SLUG_MAX_LENGTH",
  "ProductEditorPage.tsx · DerivedIdField New variant SKU": "SLUG_MAX_LENGTH",
  "ProductEditorPage.tsx · DerivedIdField Key": "SLUG_MAX_LENGTH",

  "ScenarioEditorPage.tsx · content.name": "LABEL_MAX_LENGTH",
  "ScenarioEditorPage.tsx · value": "TEXT_MAX_LENGTH",
  "ScenarioEditorPage.tsx · content.hidden_facts": "TEXT_MAX_LENGTH",
  "ScenarioEditorPage.tsx · content.completion.statement": "TEXT_MAX_LENGTH",
  "ScenariosPage.tsx · name": "LABEL_MAX_LENGTH",
  "ScenariosPage.tsx · ChipListField New hidden fact": "CHIP_LABEL_MAX_LENGTH",

  "ShopMethodCards.tsx · value": "METHOD_LABEL_MAX_LENGTH",
  "ShopMethodCards.tsx · form.fields.carrier": "METHOD_LABEL_MAX_LENGTH",
  "ShopMethodCards.tsx · DerivedIdField ID": "SLUG_MAX_LENGTH",
  "ShopSetupPages.tsx · identity.name": "LABEL_MAX_LENGTH",
  "ShopSetupPages.tsx · form.fields.name": "LABEL_MAX_LENGTH",
  "ShopSetupPages.tsx · form.fields.guidance": "TEXT_MAX_LENGTH",
  "ShopSetupPages.tsx · DerivedIdField Slug": "SLUG_MAX_LENGTH",
  "ShopSetupPages.tsx · DerivedIdField ID": "SLUG_MAX_LENGTH",
  "ShopsPage.tsx · name": "LABEL_MAX_LENGTH",
  "ShopsPage.tsx · DerivedIdField Slug": "SLUG_MAX_LENGTH",

  "SnapshotsPage.tsx · label": "LABEL_MAX_LENGTH",

  "SupportIdentitiesPage.tsx · name": "LABEL_MAX_LENGTH",
  "SupportIdentitiesPage.tsx · title": "LABEL_MAX_LENGTH",
  "SupportIdentitiesPage.tsx · remit": "TEXT_MAX_LENGTH",
  "SupportIdentityEditorPage.tsx · content.role.name": "LABEL_MAX_LENGTH",
  "SupportIdentityEditorPage.tsx · content.role.title": "LABEL_MAX_LENGTH",
  "SupportIdentityEditorPage.tsx · content.escalation.escalate_to": "TEXT_MAX_LENGTH",
  "SupportIdentityEditorPage.tsx · form.fields.title": "LABEL_MAX_LENGTH",
  "SupportIdentityEditorPage.tsx · content.role.description": "TEXT_MAX_LENGTH",
  "SupportIdentityEditorPage.tsx · form.fields.body": "TEXT_MAX_LENGTH",
  "SupportIdentityEditorPage.tsx · ChipListField New condition": "CHIP_LABEL_MAX_LENGTH",

  "TicketEditorPage.tsx · content.subject": "LABEL_MAX_LENGTH",
  "TicketEditorPage.tsx · body": "TEXT_MAX_LENGTH",
  "TicketEditorPage.tsx · ChipListField New tag": "TICKET_TAG_MAX_LENGTH",
  "TicketsPage.tsx · subject": "LABEL_MAX_LENGTH",
  "TicketsPage.tsx · DerivedIdField Reference": "SLUG_MAX_LENGTH",
};

/**
 * Every rule that caps a text, by module and the field name it refuses under, with the controls
 * that type it — each must stop at the rule's cap — or why no control does.
 */
const LAB_WRITES = "written by the lab or the run, never typed";
const RULES: Record<string, { cap: Cap; typed: readonly string[] } | { notTyped: string }> = {
  "application/experiments.py · experiment label": {
    cap: "EXPERIMENT_LABEL_MAX_LENGTH",
    typed: ["ExperimentSetupPage.tsx · DerivedIdField Name"],
  },
  "application/sandboxes.py · sandbox label": {
    cap: "LABEL_MAX_LENGTH",
    typed: ["SnapshotsPage.tsx · label"],
  },
  "domain/agent_configuration.py · model ID": {
    cap: "LABEL_MAX_LENGTH",
    typed: ["ProvenModelField.tsx · value"],
  },
  "domain/agent_configuration.py · agent configuration name": {
    cap: "LABEL_MAX_LENGTH",
    typed: [
      "AgentConfigurationsPage.tsx · name",
      "AgentConfigurationEditorPage.tsx · content.name",
    ],
  },
  "domain/agent_configuration.py · agent configuration description": {
    cap: "TEXT_MAX_LENGTH",
    typed: ["AgentConfigurationEditorPage.tsx · content.description"],
  },
  "domain/agent_configuration.py · system prompt": {
    cap: "TEXT_MAX_LENGTH",
    typed: ["AgentConfigurationEditorPage.tsx · content.prompt"],
  },
  "domain/agent_configuration.py · enabled tool name": {
    notTyped: "ticked off the lab's published tool set",
  },
  "domain/agent_turn.py · agent turn body": { notTyped: LAB_WRITES },
  "domain/blocks.py · block parameter description": {
    cap: "TEXT_MAX_LENGTH",
    typed: ["BlockEditorPage.tsx · form.fields.description"],
  },
  "domain/blocks.py · block parameter default": {
    cap: "TEXT_MAX_LENGTH",
    typed: ['BlockEditorPage.tsx · form.fields.default ?? ""'],
  },
  "domain/blocks.py · objective block statement": {
    cap: "TEXT_MAX_LENGTH",
    typed: ["BlockEditorPage.tsx · content.statement"],
  },
  "domain/blocks.py · objective block description": {
    cap: "TEXT_MAX_LENGTH",
    typed: ["BlockEditorPage.tsx · content.description"],
  },
  "domain/blocks.py · mutation block statement": {
    cap: "TEXT_MAX_LENGTH",
    typed: ["BlockEditorPage.tsx · content.statement"],
  },
  "domain/blocks.py · mutation block description": {
    cap: "TEXT_MAX_LENGTH",
    typed: ["BlockEditorPage.tsx · content.description"],
  },
  "domain/customer_profile.py · customer given name": {
    cap: "LABEL_MAX_LENGTH",
    typed: [
      "CustomersPage.tsx · givenName",
      "CustomerEditorPage.tsx · content.identity.given_name",
    ],
  },
  "domain/customer_profile.py · customer family name": {
    cap: "LABEL_MAX_LENGTH",
    typed: [
      "CustomersPage.tsx · familyName",
      "CustomerEditorPage.tsx · content.identity.family_name",
    ],
  },
  "domain/customer_profile.py · customer email": {
    cap: "LABEL_MAX_LENGTH",
    typed: ["CustomersPage.tsx · email", "CustomerEditorPage.tsx · content.identity.email"],
  },
  "domain/customer_profile.py · account notes": {
    cap: "TEXT_MAX_LENGTH",
    typed: ["CustomerEditorPage.tsx · content.account.notes"],
  },
  ...Object.fromEntries(
    ["label", "recipient", "line 1", "postal code", "city", "line 2", "region"].map((part) => [
      `domain/customer_profile.py · address ${part}`,
      { cap: "LABEL_MAX_LENGTH", typed: ["CustomerEditorPage.tsx · form.fields[field]"] },
    ]),
  ),
  "domain/customer_profile.py · persona summary": {
    cap: "TEXT_MAX_LENGTH",
    typed: ["CustomerEditorPage.tsx · content.persona.summary"],
  },
  "domain/customer_profile.py · persona trait": {
    cap: "CHIP_LABEL_MAX_LENGTH",
    typed: ["CustomerEditorPage.tsx · ChipListField New trait"],
  },
  "domain/customer_profile.py · background entry note": {
    cap: "TEXT_MAX_LENGTH",
    typed: ["CustomerEditorPage.tsx · form.fields.note"],
  },
  "domain/customer_profile.py · hidden fact note": {
    cap: "TEXT_MAX_LENGTH",
    typed: ["CustomerEditorPage.tsx · form.fields.note #2"],
  },
  "domain/customer_profile.py · hidden fact reveal condition": {
    cap: "TEXT_MAX_LENGTH",
    typed: ["CustomerEditorPage.tsx · form.fields.revealedWhen"],
  },
  "domain/entities.py · persona": { notTyped: "the POC's seeded persona, which no page writes" },
  "domain/entities.py · customer": { notTyped: "the POC's seeded customer, which no page writes" },
  "domain/experiment.py · participant turn body": {
    cap: "TEXT_MAX_LENGTH",
    typed: ["ExperimentBenchPage.tsx · message"],
  },
  "domain/experiment.py · note body": {
    cap: "NOTE_MAX_LENGTH",
    typed: ["ExperimentResultsPage.tsx · note"],
  },
  "domain/judge.py · judge model ID": {
    cap: "LABEL_MAX_LENGTH",
    typed: ["ProvenModelField.tsx · value"],
  },
  "domain/judge.py · judge configuration name": {
    cap: "LABEL_MAX_LENGTH",
    typed: [
      "JudgeConfigurationsPage.tsx · name",
      "JudgeConfigurationEditorPage.tsx · content.name",
    ],
  },
  "domain/judge.py · judge configuration description": {
    cap: "TEXT_MAX_LENGTH",
    typed: ["JudgeConfigurationEditorPage.tsx · content.description"],
  },
  "domain/judge.py · judge rubric": {
    cap: "TEXT_MAX_LENGTH",
    typed: [
      "JudgeConfigurationsPage.tsx · rubric",
      "JudgeConfigurationEditorPage.tsx · content.rubric",
    ],
  },
  "domain/judgement.py · judge model ID": { notTyped: LAB_WRITES },
  "domain/judgement.py · judge rationale": { notTyped: LAB_WRITES },
  ...Object.fromEntries(
    ["SKU", "title", "variant summary"].map((part) => [
      `domain/order_fixture.py · order line ${part}`,
      { notTyped: "frozen by the lab from the catalog; a line sends the SKU it chose from a list" },
    ]),
  ),
  ...Object.fromEntries(
    ["source label", "recipient", "line 1", "postal code", "city", "line 2", "region"].map(
      (part) => [
        `domain/order_fixture.py · shipping address ${part}`,
        { notTyped: "copied by the lab from the profile's address the order chose" },
      ],
    ),
  ),
  "domain/order_fixture.py · payment method name": {
    notTyped: "frozen by the lab from the shop's method the order chose",
  },
  "domain/order_fixture.py · fulfilment method name": {
    notTyped: "frozen by the lab from the shop's method the order chose",
  },
  "domain/order_fixture.py · order event summary": {
    cap: "TEXT_MAX_LENGTH",
    typed: ["OrderEditorPage.tsx · form.fields.summary"],
  },
  "domain/scenario.py · binding value": {
    cap: "TEXT_MAX_LENGTH",
    typed: ["ScenarioEditorPage.tsx · value"],
  },
  "domain/scenario.py · completion statement": {
    cap: "TEXT_MAX_LENGTH",
    typed: ["ScenarioEditorPage.tsx · content.completion.statement"],
  },
  "domain/scenario.py · scenario name": {
    cap: "LABEL_MAX_LENGTH",
    typed: ["ScenariosPage.tsx · name", "ScenarioEditorPage.tsx · content.name"],
  },
  // The create page types it one fact to a chip and joins them, so the whole is refused on
  // Create in words (`hiddenFactsTooLongRule`) as well as each chip stopping at its own cap.
  "domain/scenario.py · scenario hidden facts": {
    cap: "TEXT_MAX_LENGTH",
    typed: ["ScenarioEditorPage.tsx · content.hidden_facts"],
  },
  "domain/shop.py · option name": {
    cap: "LABEL_MAX_LENGTH",
    typed: ["ProductEditorPage.tsx · form.fields.name"],
  },
  "domain/shop.py · option value": {
    cap: "CHIP_LABEL_MAX_LENGTH",
    typed: ["ProductEditorPage.tsx · ChipListField New value"],
  },
  "domain/shop.py · attribute label": {
    cap: "LABEL_MAX_LENGTH",
    typed: ["ProductEditorPage.tsx · form.fields.label"],
  },
  "domain/shop.py · attribute value": {
    cap: "LABEL_MAX_LENGTH",
    typed: ["ProductEditorPage.tsx · form.fields.value"],
  },
  "domain/shop.py · attribute unit": {
    cap: "LABEL_MAX_LENGTH",
    typed: ["ProductEditorPage.tsx · form.fields.unit"],
  },
  "domain/shop.py · attribute choice": {
    cap: "CHIP_LABEL_MAX_LENGTH",
    typed: ["ProductEditorPage.tsx · ChipListField New choice"],
  },
  "domain/shop.py · media reference": {
    notTyped: "an image's reference is the one its upload returned, never typed (ADR 0076)",
  },
  "domain/shop.py · media alt text": {
    cap: "LABEL_MAX_LENGTH",
    typed: ["ProductEditorPage.tsx · form.fields.altText"],
  },
  "domain/shop.py · variant option value": {
    notTyped: "a variant picks one of its option's values from a select",
  },
  "domain/shop.py · review author": {
    cap: "LABEL_MAX_LENGTH",
    typed: ["ProductEditorPage.tsx · form.fields.author"],
  },
  "domain/shop.py · review body": {
    cap: "TEXT_MAX_LENGTH",
    typed: ["ProductEditorPage.tsx · form.fields.body"],
  },
  "domain/shop.py · product title": {
    cap: "LABEL_MAX_LENGTH",
    typed: ["ProductEditorPage.tsx · product.title"],
  },
  "domain/shop.py · product description": {
    cap: "TEXT_MAX_LENGTH",
    typed: ["ProductEditorPage.tsx · product.description"],
  },
  "domain/shop.py · product category": {
    cap: "LABEL_MAX_LENGTH",
    typed: ["ProductEditorPage.tsx · product.category"],
  },
  ...Object.fromEntries(
    ["FAQ question", "policy title", "support guideline title"].map((rule) => [
      `domain/shop.py · ${rule}`,
      {
        cap: "LABEL_MAX_LENGTH",
        typed: ["DocumentsPage.tsx · title", "DocumentEditorPage.tsx · document.title"],
      },
    ]),
  ),
  ...Object.fromEntries(
    ["FAQ answer", "policy body", "support guideline body"].map((rule) => [
      `domain/shop.py · ${rule}`,
      { cap: "TEXT_MAX_LENGTH", typed: ["DocumentEditorPage.tsx · document.body"] },
    ]),
  ),
  "domain/shop.py · payment method name": {
    cap: "METHOD_LABEL_MAX_LENGTH",
    typed: ["ShopMethodCards.tsx · value"],
  },
  "domain/shop.py · fulfilment method name": {
    cap: "METHOD_LABEL_MAX_LENGTH",
    typed: ["ShopMethodCards.tsx · value"],
  },
  "domain/shop.py · fulfilment carrier": {
    cap: "METHOD_LABEL_MAX_LENGTH",
    typed: ["ShopMethodCards.tsx · form.fields.carrier"],
  },
  "domain/shop.py · tone-of-voice name": {
    cap: "LABEL_MAX_LENGTH",
    typed: ["ShopSetupPages.tsx · form.fields.name"],
  },
  "domain/shop.py · tone-of-voice guidance": {
    cap: "TEXT_MAX_LENGTH",
    typed: ["ShopSetupPages.tsx · form.fields.guidance"],
  },
  "domain/shop.py · shop name": {
    cap: "LABEL_MAX_LENGTH",
    typed: ["ShopsPage.tsx · name", "ShopSetupPages.tsx · identity.name"],
  },
  "domain/support_identity.py · support identity name": {
    cap: "LABEL_MAX_LENGTH",
    typed: [
      "SupportIdentitiesPage.tsx · name",
      "SupportIdentityEditorPage.tsx · content.role.name",
    ],
  },
  "domain/support_identity.py · support identity title": {
    cap: "LABEL_MAX_LENGTH",
    typed: [
      "SupportIdentitiesPage.tsx · title",
      "SupportIdentityEditorPage.tsx · content.role.title",
    ],
  },
  "domain/support_identity.py · support identity description": {
    cap: "TEXT_MAX_LENGTH",
    typed: [
      "SupportIdentitiesPage.tsx · remit",
      "SupportIdentityEditorPage.tsx · content.role.description",
    ],
  },
  "domain/support_identity.py · guidance note title": {
    cap: "LABEL_MAX_LENGTH",
    typed: ["SupportIdentityEditorPage.tsx · form.fields.title"],
  },
  "domain/support_identity.py · guidance note body": {
    cap: "TEXT_MAX_LENGTH",
    typed: ["SupportIdentityEditorPage.tsx · form.fields.body"],
  },
  "domain/support_identity.py · escalation target": {
    cap: "TEXT_MAX_LENGTH",
    typed: ["SupportIdentityEditorPage.tsx · content.escalation.escalate_to"],
  },
  "domain/support_identity.py · escalation condition": {
    cap: "CHIP_LABEL_MAX_LENGTH",
    typed: ["SupportIdentityEditorPage.tsx · ChipListField New condition"],
  },
  "domain/ticket.py · ticket message body": {
    cap: "TEXT_MAX_LENGTH",
    typed: ["TicketEditorPage.tsx · body"],
  },
  "domain/ticket.py · ticket subject": {
    cap: "LABEL_MAX_LENGTH",
    typed: ["TicketsPage.tsx · subject", "TicketEditorPage.tsx · content.subject"],
  },
};

/** The JSX opening of every `<tag`, up to the `>` or `/>` that closes it, braces balanced. */
function openings(source: string, tag: string): string[] {
  const found: string[] = [];
  for (const match of source.matchAll(new RegExp(`<${tag}\\b`, "g"))) {
    let depth = 0;
    let end = match.index;
    for (; end < source.length; end += 1) {
      const character = source[end];
      if (character === "{") depth += 1;
      else if (character === "}") depth -= 1;
      else if (character === ">" && depth === 0) break;
    }
    found.push(source.slice(match.index, end + 1));
  }
  return found;
}

/** The expression of `name={…}`, braces balanced and whitespace collapsed, or a literal's text. */
function attribute(opening: string, name: string): string | null {
  const literal = new RegExp(`\\s${name}="([^"]*)"`).exec(opening);
  if (literal) return literal[1];
  const start = new RegExp(`\\s${name}=\\{`).exec(opening);
  if (!start) return null;
  let depth = 0;
  let index = start.index + start[0].length - 1;
  const from = index + 1;
  for (; index < opening.length; index += 1) {
    if (opening[index] === "{") depth += 1;
    else if (opening[index] === "}") {
      depth -= 1;
      if (depth === 0) break;
    }
  }
  return opening.slice(from, index).replaceAll(/\s+/g, " ").trim();
}

/** Input types that take no free text: what they hold is a number, a time, a choice or a file. */
const NOT_TEXT = new Set([
  "checkbox",
  "radio",
  "number",
  "date",
  "datetime-local",
  "time",
  "file",
  "color",
  "range",
  "hidden",
]);

const controls = Object.entries(pages).flatMap(([path, source]) => {
  const file = path.split("/").at(-1) ?? path;
  const native = ["input", "textarea"].flatMap((tag) =>
    openings(source, tag)
      .filter((opening) => !NOT_TEXT.has(attribute(opening, "type") ?? ""))
      .filter((opening) => !/\sreadOnly[\s/>]/.test(opening))
      .map((opening) => ({ key: `${file} · ${attribute(opening, "value")}`, opening })),
  );
  const composed = ["ChipListField", "DerivedIdField"].flatMap((tag) =>
    openings(source, tag)
      .filter((opening) => !opening.startsWith(`<${tag}Props`))
      .map((opening) => ({ key: `${file} · ${tag} ${attribute(opening, "label")}`, opening })),
  );
  const seen = new Map<string, number>();
  return [...native, ...composed].map((control) => {
    const count = (seen.get(control.key) ?? 0) + 1;
    seen.set(control.key, count);
    return count === 1 ? control : { ...control, key: `${control.key} #${count}` };
  });
});

/** `require_label(…, "field name")` and its kin, wherever the Python calls one. */
const rules = Object.entries(python).flatMap(([path, source]) => {
  const module = path.split("/").slice(-2).join("/");
  return [...source.matchAll(/\b_?require_(label|text|email)\(\s*[\w.]+,\s*"([^"]+)"/g)].map(
    (match) => ({ key: `${module} · ${match[2]}`, kind: match[1] }),
  );
});

describe("a text the operator types", () => {
  it("reads every page and component and the lab's rules, and no test", () => {
    expect(Object.keys(pages)).toContain("../App.tsx");
    expect(Object.keys(pages).filter((path) => path.endsWith(".test.tsx"))).toEqual([]);
    expect(Object.keys(python).some((path) => path.endsWith("domain/shop.py"))).toBe(true);
    // A sweep that silently found nothing would pass on nothing.
    expect(controls.length).toBe(Object.keys(CONTROLS).length);
    expect(rules.length).toBeGreaterThan(80);
  });

  it("is a control the table names", () => {
    expect(controls.map((control) => control.key).sort()).toEqual(Object.keys(CONTROLS).sort());
  });

  it("stops at the cap the table gives it, and carries none it does not", () => {
    for (const { key, opening } of controls) {
      const expected = CONTROLS[key];
      const named = attribute(opening, "maxLength");
      expect(named, key).toBe(
        typeof expected === "string" ? expected : "forwards" in expected ? "maxLength" : null,
      );
    }
  });
});

describe("a rule that caps a text", () => {
  it("is every call the Python makes, whatever its arguments", () => {
    const calls = Object.values(python).reduce(
      (count, source) =>
        count + (source.match(/(?<!def )\b_?require_(label|text|email)\(/g)?.length ?? 0),
      0,
    );
    expect(rules.length).toBe(calls);
  });

  it("is in the table, once each", () => {
    expect([...new Set(rules.map((rule) => rule.key))].sort()).toEqual(Object.keys(RULES).sort());
  });

  it("is typed only through controls that stop at its cap", () => {
    const kinds = new Map(rules.map((rule) => [rule.key, rule.kind]));
    for (const [key, rule] of Object.entries(RULES)) {
      if ("notTyped" in rule) continue;
      expect(rule.typed.length, key).toBeGreaterThan(0);
      const kind = kinds.get(key);
      expect(CAPS[rule.cap], key).toBeLessThanOrEqual(
        kind === "text" ? TEXT_MAX_LENGTH : LABEL_MAX_LENGTH,
      );
      for (const control of rule.typed) {
        expect(CONTROLS[control], `${key} · ${control}`).toBe(rule.cap);
      }
    }
  });
});

describe("the caps", () => {
  it("are the backend's", () => {
    const constant = (source: string, name: string) =>
      Number(new RegExp(`^${name} = (\\d+)$`, "m").exec(source)?.[1]);
    expect(LABEL_MAX_LENGTH).toBe(constant(contentDomain, "MAX_LABEL_LENGTH"));
    expect(TEXT_MAX_LENGTH).toBe(constant(contentDomain, "MAX_TEXT_LENGTH"));
    expect(NOTE_MAX_LENGTH).toBe(constant(experimentDomain, "MAX_NOTE_LENGTH"));
    for (const name of [
      "CHIP_LABEL_MAX_LENGTH",
      "METHOD_LABEL_MAX_LENGTH",
      "EXPERIMENT_LABEL_MAX_LENGTH",
    ]) {
      expect(CAPS[name], name).toBe(LABEL_MAX_LENGTH);
    }
    expect(SLUG_MAX_LENGTH).toBe(constant(contentDomain, "MAX_SLUG_LENGTH"));
    expect(TICKET_TAG_MAX_LENGTH).toBe(SLUG_MAX_LENGTH);
    for (const [rule, cap] of [
      ["require_label", "MAX_LABEL_LENGTH"],
      ["require_email", "MAX_LABEL_LENGTH"],
      ["require_text", "MAX_TEXT_LENGTH"],
    ]) {
      const body = contentDomain.split(`def ${rule}(`)[1]?.split("\ndef ")[0] ?? "";
      expect(body, rule).toContain(`if len(value) > ${cap}:`);
    }
  });
});
