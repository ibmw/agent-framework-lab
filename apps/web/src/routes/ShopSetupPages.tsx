import type {
  FaqEntrySchema,
  FulfilmentMethodSchema,
  PaymentMethodSchema,
  PolicySchema,
  ShopContentSchema,
  SupportGuidelineSchema,
  ToneOfVoiceSchema,
} from "@agent-lab/contracts";
import { type FormEvent, type ReactNode, useState } from "react";
import {
  Card,
  EntryCard,
  EntryId,
  EntryText,
  IssueList,
  PageHeader,
  VersionChips,
} from "../components/WorkspaceChrome";
import {
  accentButtonClasses,
  fieldControlClasses,
  fieldLabelClasses,
  subtleButtonClasses,
  textAreaClasses,
} from "../lib/ui";
import { useShopWorkspace } from "../shell/ShopWorkspace";

const POLICY_KINDS: PolicySchema["kind"][] = [
  "returns",
  "shipping",
  "cancellation",
  "privacy",
  "warranty",
  "terms",
];

const PAYMENT_KINDS: PaymentMethodSchema["kind"][] = [
  "card",
  "wallet",
  "bank_transfer",
  "gift_card",
];

const CHANNELS: ShopContentSchema["identity"]["channels"][number][] = ["chat", "email", "phone"];
const CURRENCIES: ShopContentSchema["identity"]["currencies"][number][] = ["EUR", "USD", "GBP"];

function SetupPage({ title, children }: { title: string; children: ReactNode }) {
  const { preview, save, saving, dirty, error } = useShopWorkspace();
  return (
    <>
      <PageHeader
        title={title}
        chips={<VersionChips preview={preview} />}
        actions={
          <button
            className={accentButtonClasses}
            type="button"
            onClick={() => void save()}
            disabled={!dirty || saving}
          >
            {saving ? "Saving…" : dirty ? "Save draft" : "Saved"}
          </button>
        }
      />
      {error ? (
        <p role="alert" className="mb-4 text-[13px] text-lab-error">
          {error}
        </p>
      ) : null}
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="grid gap-4">{children}</div>
        <Card title="Draft validation">
          <IssueList issues={preview?.issues ?? []} />
        </Card>
      </div>
    </>
  );
}

/**
 * The entry's name belongs in the accessible name, not in the visible label: a policy may be
 * titled a paragraph long, and a button that renders it stretches the row it sits on. Every
 * other editor in the workspace already names its Remove this way.
 */
function RemoveButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      className={subtleButtonClasses}
      type="button"
      aria-label={`Remove ${label}`}
      onClick={onClick}
    >
      Remove
    </button>
  );
}

/**
 * The authoring form sits below the saved entries it adds to. Now that an entry carries its
 * body, the rule is what tells an author where the saved configuration ends and the blank
 * form begins.
 */
const addFormClasses = "grid gap-2 border-t border-admin-border pt-3";

/** A muted classification chip — a policy's kind, a payment method's rail. */
function KindChip({ value }: { value: string }) {
  return (
    <span className="rounded bg-admin-canvas px-1.5 py-0.5 text-[11px] text-admin-muted">
      {value}
    </span>
  );
}

export function ShopIdentityPage() {
  const { content, edit } = useShopWorkspace();
  const identity = content.identity;

  // A shop must always sell in at least one currency and answer on at least one channel,
  // so the last checked box stays checked instead of failing at save.
  function toggle<T extends string>(list: T[], value: T): T[] {
    if (!list.includes(value)) {
      return [...list, value];
    }
    return list.length === 1 ? list : list.filter((entry) => entry !== value);
  }

  function isLastSelected<T extends string>(list: readonly T[], value: T): boolean {
    return list.length === 1 && list[0] === value;
  }

  return (
    <SetupPage title="Settings">
      <Card title="Shop identity">
        <label className={fieldLabelClasses}>
          Name
          <input
            className={fieldControlClasses}
            value={identity.name}
            onChange={(event) =>
              edit({ ...content, identity: { ...identity, name: event.target.value } })
            }
          />
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className={fieldLabelClasses}>
            Slug
            <input
              className={fieldControlClasses}
              value={identity.slug}
              onChange={(event) =>
                edit({ ...content, identity: { ...identity, slug: event.target.value } })
              }
            />
          </label>
          <label className={fieldLabelClasses}>
            Locale
            <input
              className={fieldControlClasses}
              value={identity.locale}
              onChange={(event) =>
                edit({ ...content, identity: { ...identity, locale: event.target.value } })
              }
            />
          </label>
        </div>
        <fieldset className="grid gap-1.5">
          <legend className="text-xs font-semibold text-admin-muted">Currencies</legend>
          <div className="flex flex-wrap gap-3 text-[13px]">
            {CURRENCIES.map((currency) => (
              <label key={currency} className="flex items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={identity.currencies.includes(currency)}
                  disabled={isLastSelected(identity.currencies, currency)}
                  onChange={() =>
                    edit({
                      ...content,
                      identity: {
                        ...identity,
                        currencies: toggle([...identity.currencies], currency),
                      },
                    })
                  }
                />
                {currency}
              </label>
            ))}
          </div>
        </fieldset>
        <fieldset className="grid gap-1.5">
          <legend className="text-xs font-semibold text-admin-muted">Support channels</legend>
          <div className="flex flex-wrap gap-3 text-[13px]">
            {CHANNELS.map((channel) => (
              <label key={channel} className="flex items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={identity.channels.includes(channel)}
                  disabled={isLastSelected(identity.channels, channel)}
                  onChange={() =>
                    edit({
                      ...content,
                      identity: { ...identity, channels: toggle([...identity.channels], channel) },
                    })
                  }
                />
                {channel}
              </label>
            ))}
          </div>
        </fieldset>
      </Card>

      <PaymentAndFulfilmentCards />
    </SetupPage>
  );
}

function PaymentAndFulfilmentCards() {
  const { content, edit } = useShopWorkspace();
  const [payment, setPayment] = useState<{
    id: string;
    name: string;
    kind: PaymentMethodSchema["kind"];
  }>({ id: "", name: "", kind: "card" });
  const [fulfilment, setFulfilment] = useState({ id: "", name: "", carrier: "", min: 1, max: 3 });

  function addPayment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const method: PaymentMethodSchema = { ...payment, enabled: true };
    edit({ ...content, payment_methods: [...content.payment_methods, method] });
    setPayment({ id: "", name: "", kind: "card" });
  }

  function addFulfilment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const method: FulfilmentMethodSchema = {
      id: fulfilment.id,
      name: fulfilment.name,
      carrier: fulfilment.carrier,
      min_transit_days: fulfilment.min,
      max_transit_days: fulfilment.max,
    };
    edit({ ...content, fulfilment_methods: [...content.fulfilment_methods, method] });
    setFulfilment({ id: "", name: "", carrier: "", min: 1, max: 3 });
  }

  return (
    <>
      <Card title="Payment methods">
        <ul className="grid gap-2 text-[13px]">
          {content.payment_methods.map((method) => (
            <EntryCard
              key={method.id}
              title={method.name}
              chips={
                <>
                  <KindChip value={method.kind} />
                  <EntryId value={method.id} />
                  <label className="flex items-center gap-1.5 text-[12px] text-admin-muted">
                    <input
                      type="checkbox"
                      checked={method.enabled}
                      onChange={() =>
                        edit({
                          ...content,
                          payment_methods: content.payment_methods.map((entry) =>
                            entry.id === method.id ? { ...entry, enabled: !entry.enabled } : entry,
                          ),
                        })
                      }
                    />
                    enabled
                  </label>
                </>
              }
              actions={
                <RemoveButton
                  label={method.name}
                  onClick={() =>
                    edit({
                      ...content,
                      payment_methods: content.payment_methods.filter(
                        (entry) => entry.id !== method.id,
                      ),
                    })
                  }
                />
              }
            />
          ))}
          {content.payment_methods.length === 0 ? (
            <li className="text-admin-muted">No payment method yet.</li>
          ) : null}
        </ul>
        <form className={`${addFormClasses} sm:grid-cols-4`} onSubmit={addPayment}>
          <label className={fieldLabelClasses}>
            ID
            <input
              className={fieldControlClasses}
              value={payment.id}
              required
              pattern="[a-z0-9]+(-[a-z0-9]+)*"
              onChange={(event) => setPayment({ ...payment, id: event.target.value })}
            />
          </label>
          <label className={fieldLabelClasses}>
            Name
            <input
              className={fieldControlClasses}
              value={payment.name}
              required
              onChange={(event) => setPayment({ ...payment, name: event.target.value })}
            />
          </label>
          <label className={fieldLabelClasses}>
            Kind
            <select
              className={fieldControlClasses}
              value={payment.kind}
              onChange={(event) =>
                setPayment({
                  ...payment,
                  kind: event.target.value as PaymentMethodSchema["kind"],
                })
              }
            >
              {PAYMENT_KINDS.map((kind) => (
                <option key={kind} value={kind}>
                  {kind}
                </option>
              ))}
            </select>
          </label>
          <button className={`${accentButtonClasses} self-end`} type="submit">
            Add payment method
          </button>
        </form>
      </Card>

      <Card title="Fulfilment methods">
        <ul className="grid gap-2 text-[13px]">
          {content.fulfilment_methods.map((method) => (
            <EntryCard
              key={method.id}
              title={method.name}
              chips={
                <>
                  <span className="text-[12px] text-admin-muted">
                    {method.carrier} · {method.min_transit_days}–{method.max_transit_days} days
                  </span>
                  <EntryId value={method.id} />
                </>
              }
              actions={
                <RemoveButton
                  label={method.name}
                  onClick={() =>
                    edit({
                      ...content,
                      fulfilment_methods: content.fulfilment_methods.filter(
                        (entry) => entry.id !== method.id,
                      ),
                    })
                  }
                />
              }
            />
          ))}
          {content.fulfilment_methods.length === 0 ? (
            <li className="text-admin-muted">No fulfilment method yet.</li>
          ) : null}
        </ul>
        <form className={`${addFormClasses} sm:grid-cols-5`} onSubmit={addFulfilment}>
          <label className={fieldLabelClasses}>
            ID
            <input
              className={fieldControlClasses}
              value={fulfilment.id}
              required
              pattern="[a-z0-9]+(-[a-z0-9]+)*"
              onChange={(event) => setFulfilment({ ...fulfilment, id: event.target.value })}
            />
          </label>
          <label className={fieldLabelClasses}>
            Name
            <input
              className={fieldControlClasses}
              value={fulfilment.name}
              required
              onChange={(event) => setFulfilment({ ...fulfilment, name: event.target.value })}
            />
          </label>
          <label className={fieldLabelClasses}>
            Carrier
            <input
              className={fieldControlClasses}
              value={fulfilment.carrier}
              required
              onChange={(event) => setFulfilment({ ...fulfilment, carrier: event.target.value })}
            />
          </label>
          <label className={fieldLabelClasses}>
            Min days
            <input
              type="number"
              min={0}
              className={fieldControlClasses}
              value={fulfilment.min}
              onChange={(event) =>
                setFulfilment({ ...fulfilment, min: Number(event.target.value) })
              }
            />
          </label>
          <label className={fieldLabelClasses}>
            Max days
            <input
              type="number"
              min={0}
              className={fieldControlClasses}
              value={fulfilment.max}
              onChange={(event) =>
                setFulfilment({ ...fulfilment, max: Number(event.target.value) })
              }
            />
          </label>
          <button className={`${accentButtonClasses} self-end`} type="submit">
            Add fulfilment method
          </button>
        </form>
      </Card>
    </>
  );
}

export function PoliciesAndFaqPage() {
  const { content, edit } = useShopWorkspace();
  const [policy, setPolicy] = useState({
    id: "",
    title: "",
    kind: "returns" as PolicySchema["kind"],
    body: "",
  });
  const [faq, setFaq] = useState({ id: "", question: "", answer: "" });

  function addPolicy(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    edit({ ...content, policies: [...content.policies, policy] });
    setPolicy({ id: "", title: "", kind: "returns", body: "" });
  }

  function addFaq(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const entry: FaqEntrySchema = faq;
    edit({ ...content, faq: [...content.faq, entry] });
    setFaq({ id: "", question: "", answer: "" });
  }

  return (
    <SetupPage title="Policies & FAQ">
      <Card title="Policies">
        <ul className="grid gap-2 text-[13px]">
          {content.policies.map((entry) => (
            <EntryCard
              key={entry.id}
              title={entry.title}
              chips={
                <>
                  <KindChip value={entry.kind} />
                  <EntryId value={entry.id} />
                </>
              }
              actions={
                <RemoveButton
                  label={entry.title}
                  onClick={() =>
                    edit({
                      ...content,
                      policies: content.policies.filter((item) => item.id !== entry.id),
                    })
                  }
                />
              }
            >
              <EntryText label="Body" value={entry.body} />
            </EntryCard>
          ))}
          {content.policies.length === 0 ? (
            <li className="text-admin-muted">No policy yet.</li>
          ) : null}
        </ul>
        <form className={addFormClasses} onSubmit={addPolicy}>
          <div className="grid gap-2 sm:grid-cols-3">
            <label className={fieldLabelClasses}>
              ID
              <input
                className={fieldControlClasses}
                value={policy.id}
                required
                pattern="[a-z0-9]+(-[a-z0-9]+)*"
                onChange={(event) => setPolicy({ ...policy, id: event.target.value })}
              />
            </label>
            <label className={fieldLabelClasses}>
              Title
              <input
                className={fieldControlClasses}
                value={policy.title}
                required
                onChange={(event) => setPolicy({ ...policy, title: event.target.value })}
              />
            </label>
            <label className={fieldLabelClasses}>
              Kind
              <select
                className={fieldControlClasses}
                value={policy.kind}
                onChange={(event) =>
                  setPolicy({ ...policy, kind: event.target.value as PolicySchema["kind"] })
                }
              >
                {POLICY_KINDS.map((kind) => (
                  <option key={kind} value={kind}>
                    {kind}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className={fieldLabelClasses}>
            Body
            <textarea
              className={textAreaClasses}
              value={policy.body}
              required
              onChange={(event) => setPolicy({ ...policy, body: event.target.value })}
            />
          </label>
          <button className={`${accentButtonClasses} justify-self-start`} type="submit">
            Add policy
          </button>
        </form>
      </Card>

      <Card title="FAQ">
        <ul className="grid gap-2 text-[13px]">
          {content.faq.map((entry) => (
            <EntryCard
              key={entry.id}
              title={entry.question}
              chips={<EntryId value={entry.id} />}
              actions={
                <RemoveButton
                  label={entry.question}
                  onClick={() =>
                    edit({ ...content, faq: content.faq.filter((item) => item.id !== entry.id) })
                  }
                />
              }
            >
              <EntryText label="Answer" value={entry.answer} />
            </EntryCard>
          ))}
          {content.faq.length === 0 ? (
            <li className="text-admin-muted">No FAQ entry yet.</li>
          ) : null}
        </ul>
        <form className={addFormClasses} onSubmit={addFaq}>
          <div className="grid gap-2 sm:grid-cols-2">
            <label className={fieldLabelClasses}>
              ID
              <input
                className={fieldControlClasses}
                value={faq.id}
                required
                pattern="[a-z0-9]+(-[a-z0-9]+)*"
                onChange={(event) => setFaq({ ...faq, id: event.target.value })}
              />
            </label>
            <label className={fieldLabelClasses}>
              Question
              <input
                className={fieldControlClasses}
                value={faq.question}
                required
                onChange={(event) => setFaq({ ...faq, question: event.target.value })}
              />
            </label>
          </div>
          <label className={fieldLabelClasses}>
            Answer
            <textarea
              className={textAreaClasses}
              value={faq.answer}
              required
              onChange={(event) => setFaq({ ...faq, answer: event.target.value })}
            />
          </label>
          <button className={`${accentButtonClasses} justify-self-start`} type="submit">
            Add FAQ entry
          </button>
        </form>
      </Card>
    </SetupPage>
  );
}

export function SupportGuidelinesPage() {
  const { content, edit } = useShopWorkspace();
  const [guideline, setGuideline] = useState({ id: "", title: "", body: "" });

  return (
    <SetupPage title="Support guidelines">
      <Card title="Guidelines">
        <ul className="grid gap-2 text-[13px]">
          {content.support_guidelines.map((entry) => (
            <EntryCard
              key={entry.id}
              title={entry.title}
              chips={<EntryId value={entry.id} />}
              actions={
                <RemoveButton
                  label={entry.title}
                  onClick={() =>
                    edit({
                      ...content,
                      support_guidelines: content.support_guidelines.filter(
                        (item) => item.id !== entry.id,
                      ),
                    })
                  }
                />
              }
            >
              <EntryText label="Body" value={entry.body} />
            </EntryCard>
          ))}
          {content.support_guidelines.length === 0 ? (
            <li className="text-admin-muted">No support guideline yet.</li>
          ) : null}
        </ul>
        <form
          className={addFormClasses}
          onSubmit={(event) => {
            event.preventDefault();
            const entry: SupportGuidelineSchema = guideline;
            edit({ ...content, support_guidelines: [...content.support_guidelines, entry] });
            setGuideline({ id: "", title: "", body: "" });
          }}
        >
          <div className="grid gap-2 sm:grid-cols-2">
            <label className={fieldLabelClasses}>
              ID
              <input
                className={fieldControlClasses}
                value={guideline.id}
                required
                pattern="[a-z0-9]+(-[a-z0-9]+)*"
                onChange={(event) => setGuideline({ ...guideline, id: event.target.value })}
              />
            </label>
            <label className={fieldLabelClasses}>
              Title
              <input
                className={fieldControlClasses}
                value={guideline.title}
                required
                onChange={(event) => setGuideline({ ...guideline, title: event.target.value })}
              />
            </label>
          </div>
          <label className={fieldLabelClasses}>
            Body
            <textarea
              className={textAreaClasses}
              value={guideline.body}
              required
              onChange={(event) => setGuideline({ ...guideline, body: event.target.value })}
            />
          </label>
          <button className={`${accentButtonClasses} justify-self-start`} type="submit">
            Add guideline
          </button>
        </form>
        <p className="text-xs text-admin-muted">
          Support identities keep role, permissions, and guidance; tone of voice is shop-level.
        </p>
      </Card>
    </SetupPage>
  );
}

export function ToneOfVoicePage() {
  const { content, edit } = useShopWorkspace();
  const [tone, setTone] = useState({ id: "", name: "", guidance: "" });

  function setDefault(id: string) {
    edit({
      ...content,
      tone_of_voice_guidelines: content.tone_of_voice_guidelines.map((entry) => ({
        ...entry,
        is_default: entry.id === id,
      })),
      default_tone_of_voice_id: id,
    });
  }

  return (
    <SetupPage title="Tone of voice">
      <Card title="Guidelines">
        <ul className="grid gap-2 text-[13px]">
          {content.tone_of_voice_guidelines.map((entry) => (
            <EntryCard
              key={entry.id}
              lead={
                <label className="flex items-center gap-1.5">
                  <input
                    type="radio"
                    name="default-tone"
                    checked={entry.is_default}
                    onChange={() => setDefault(entry.id)}
                  />
                  <span className="sr-only">Make {entry.name} the shop default</span>
                </label>
              }
              title={entry.name}
              chips={
                <>
                  <EntryId value={entry.id} />
                  {entry.is_default ? (
                    <span className="rounded-full bg-admin-published px-2 py-0.5 text-[11px] font-semibold text-admin-published-ink">
                      ● shop default
                    </span>
                  ) : null}
                </>
              }
              actions={
                <RemoveButton
                  label={entry.name}
                  onClick={() =>
                    edit({
                      ...content,
                      tone_of_voice_guidelines: content.tone_of_voice_guidelines.filter(
                        (item) => item.id !== entry.id,
                      ),
                    })
                  }
                />
              }
            >
              <EntryText label="Guidance" value={entry.guidance} />
            </EntryCard>
          ))}
          {content.tone_of_voice_guidelines.length === 0 ? (
            <li className="text-admin-muted">No tone-of-voice guideline yet.</li>
          ) : null}
        </ul>
        <form
          className={addFormClasses}
          onSubmit={(event) => {
            event.preventDefault();
            const entry: ToneOfVoiceSchema = {
              ...tone,
              is_default: content.tone_of_voice_guidelines.length === 0,
            };
            edit({
              ...content,
              tone_of_voice_guidelines: [...content.tone_of_voice_guidelines, entry],
            });
            setTone({ id: "", name: "", guidance: "" });
          }}
        >
          <div className="grid gap-2 sm:grid-cols-2">
            <label className={fieldLabelClasses}>
              ID
              <input
                className={fieldControlClasses}
                value={tone.id}
                required
                pattern="[a-z0-9]+(-[a-z0-9]+)*"
                onChange={(event) => setTone({ ...tone, id: event.target.value })}
              />
            </label>
            <label className={fieldLabelClasses}>
              Name
              <input
                className={fieldControlClasses}
                value={tone.name}
                required
                onChange={(event) => setTone({ ...tone, name: event.target.value })}
              />
            </label>
          </div>
          <label className={fieldLabelClasses}>
            Guidance
            <textarea
              className={textAreaClasses}
              value={tone.guidance}
              required
              onChange={(event) => setTone({ ...tone, guidance: event.target.value })}
            />
          </label>
          <button className={`${accentButtonClasses} justify-self-start`} type="submit">
            Add tone of voice
          </button>
        </form>
        <p className="text-xs text-admin-muted">
          Agent configurations resolve the shop default through{" "}
          <code>{"{{shop.tone_of_voice}}"}</code> or select a named override.
        </p>
      </Card>
    </SetupPage>
  );
}
