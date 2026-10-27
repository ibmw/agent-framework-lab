import type { ShopListResponse } from "@agent-lab/contracts";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { SHOP_NAME_RULE } from "./lib/fieldRules";
import {
  COUNTING,
  DELETING_SHOP,
  PUBLISHED_SHOP_KEPT,
  SHOP_DELETE_KEEPS,
} from "./lib/shopDeletion";
import { cardTitleClasses } from "./lib/ui";
import { renderApp, wholeDescription } from "./test/app";
import { expectPublicationPill } from "./test/indexes";
import { expectNotRefused, expectRefused } from "./test/refused";
import { expectRunsOpenOnARow } from "./test/rows";
import { shellListings } from "./test/shell";

const SHOP_ID = "9c8b7a6d-5e4f-4a3b-9c8d-7e6f5a4b3c2d";

const empty: ShopListResponse = { shops: [] };

let created: Record<string, unknown> | null = null;

const server = setupServer(
  http.get("*/api/v1/shops", () => HttpResponse.json(empty)),
  http.post("*/api/v1/shops", async ({ request }) => {
    created = (await request.json()) as Record<string, unknown>;
    return HttpResponse.json({ shop_id: SHOP_ID }, { status: 201 });
  }),
  // The shop and lab shells read every listing their rail counts (ADR 0056). Last, so a
  // handler this suite declares for one of these routes still wins.
  ...shellListings(),
);

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => {
  server.resetHandlers();
  created = null;
  window.localStorage.clear();
});
afterAll(() => server.close());

function renderShops() {
  return renderApp("/shops");
}

function renderNewShop() {
  return renderApp("/shops/new");
}

function currencies(card: Scope) {
  return within(card.getByRole("group", { name: "Currencies" }));
}

/**
 * The whole create page, not a card inside it (PLAN-UX Slice 12).
 *
 * Creating a shop was a 380px side card on the index and is now `/shops/new`, whose sticky
 * header carries Create and Cancel while the form fills the 790px column beneath. Nothing
 * scopes the two together but the page, so the queries are the page's.
 */
type Scope = typeof screen;

async function createShopPage(): Promise<Scope> {
  await screen.findByRole("heading", { level: 1, name: "New shop" });
  return screen;
}

describe("the shops table", () => {
  // The card's title says what the list is — every shop in the lab — and it sits opposite the
  // search box on the card's header line.
  it("titles its card In this lab, opposite the search box, as every card is titled", async () => {
    renderShops();

    const box = await screen.findByRole("searchbox", { name: "Search shops" });
    const title = screen.getByRole("heading", { level: 2, name: "In this lab" });

    expect(title.parentElement).toContainElement(box);
    for (const className of cardTitleClasses.split(" ")) {
      expect(title.className).toContain(className);
    }
    // Presence alone would pass a header that kept a sans size beside the shared one, which is
    // exactly how a copy half-reverts.
    expect(title.className).not.toMatch(/\btext-(xs|sm|base|lg|xl)\b/);
  });
});

describe("a shop's publication on the index", () => {
  const listed: ShopListResponse = {
    shops: [
      {
        shop_id: SHOP_ID,
        name: "Northstar Outfitters",
        slug: "northstar",
        updated_at: "2026-08-23T12:05:00+00:00",
        latest_published_version: 3,
        published_version_count: 2,
        logo: null,
      },
      {
        shop_id: "1b2c3d4e-5f60-4718-9a0b-c1d2e3f4a5b6",
        name: "Harbour Lane Supply",
        slug: "harbour-lane-supply",
        updated_at: "2026-08-22T12:05:00+00:00",
        latest_published_version: null,
        published_version_count: 0,
        logo: null,
      },
    ],
  };

  it("is a pill: the version and how many there are, or Never published", async () => {
    server.use(http.get("*/api/v1/shops", () => HttpResponse.json(listed)));
    renderShops();

    const published = (await screen.findByRole("link", { name: "Northstar Outfitters" })).closest(
      "tr",
    ) as HTMLElement;
    const never = screen
      .getByRole("link", { name: "Harbour Lane Supply" })
      .closest("tr") as HTMLElement;
    expectPublicationPill(published, "v3 · 2 versions", "published");
    expectPublicationPill(never, "Never published", "never published");
    // The chip keeps the row's word and its own name, so neither is mistaken for the other.
    expect(screen.getByRole("button", { name: "Never published 1" })).toBeVisible();
  });
});

describe("the shops index and its create page", () => {
  it("offers a New shop button rather than a form beside the table", async () => {
    renderShops();

    await screen.findByRole("heading", { level: 2, name: "In this lab" });
    // The side card is gone: creating is a page (PLAN-UX Slice 12).
    expect(screen.queryByRole("heading", { name: "Create a shop" })).toBeNull();
    expect(screen.getByRole("link", { name: "New shop" })).toHaveAttribute("href", "/shops/new");
  });

  it("names All shops above it and becomes the shop's name as it is typed", async () => {
    const user = userEvent.setup();
    renderNewShop();
    const card = await createShopPage();

    const header = screen.getByRole("heading", { level: 1 }).closest("header");
    expect(header).not.toBeNull();
    expect(within(header as HTMLElement).getByRole("link", { name: "All shops" })).toHaveAttribute(
      "href",
      "/shops",
    );
    expect(within(header as HTMLElement).getByText(/creating a shop/)).toBeVisible();

    await user.type(card.getByLabelText("Name"), "Harbour Lane Supply");
    expect(screen.getByRole("heading", { level: 1, name: "Harbour Lane Supply" })).toBeVisible();
  });

  it("refuses Create until the shop is named, and says why on the control", async () => {
    const user = userEvent.setup();
    renderNewShop();
    const card = await createShopPage();

    const create = () => card.getByRole("button", { name: "Create shop" });
    expectRefused(create(), /needs a name/i);
    expect(create()).toHaveAccessibleDescription(/needs a name/i);
    expect(create()).toHaveAttribute("title", expect.stringMatching(/needs a name/i));

    await user.type(card.getByLabelText("Name"), "Harbour Lane Supply");
    expectNotRefused(create());
  });

  it("opens every card's run of rows on a row, so the first row draws no rule under the title", async () => {
    renderNewShop();
    await createShopPage();

    // Commerce opens on the locale, a self-labelling field that used to wrap its row in a box.
    const commerce = screen.getByRole("region", { name: "Commerce" });
    const [locale] = expectRunsOpenOnARow(commerce);
    expect(locale).toContainElement(within(commerce).getByLabelText("Locale"));
    for (const name of ["Identity", "Channels"]) {
      expectRunsOpenOnARow(screen.getByRole("region", { name }));
    }
  });

  it("lands in the new shop's workspace", async () => {
    const user = userEvent.setup();
    const { router } = renderNewShop();
    const card = await createShopPage();

    await user.type(card.getByLabelText("Name"), "Harbour Lane Supply");
    await user.click(card.getByRole("button", { name: "Create shop" }));

    await waitFor(() => expect(router.state.location.pathname).toBe(`/shops/${SHOP_ID}`));
  });

  it("returns to the index with nothing created when Cancel is pressed", async () => {
    const user = userEvent.setup();
    const { router } = renderNewShop();
    const card = await createShopPage();

    await user.type(card.getByLabelText("Name"), "Harbour Lane Supply");
    await user.click(card.getByRole("link", { name: "Cancel" }));

    // A half-typed create form is not an edit to something that exists (ADR 0051).
    await waitFor(() => expect(router.state.location.pathname).toBe("/shops"));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(created).toBeNull();
  });
});

describe("creating a shop from an example", () => {
  it("fills every field the form requires, so the example is publishable as typed", async () => {
    const user = userEvent.setup();
    renderNewShop();
    const card = await createShopPage();

    await user.click(card.getByRole("button", { name: "Use an example shop" }));

    expect(card.getByLabelText("Name")).toHaveValue("Harbour Lane Supply");
    expect(card.getByLabelText("Slug")).toHaveValue("harbour-lane-supply");
    expect(card.getByLabelText("Locale")).toHaveValue("en-GB");
    expect(currencies(card).getByRole("checkbox", { name: "GBP — Pound sterling" })).toBeChecked();
  });

  it("creates nothing until the operator presses Create shop", async () => {
    const user = userEvent.setup();
    renderNewShop();
    const card = await createShopPage();

    await user.click(card.getByRole("button", { name: "Use an example shop" }));

    expect(created).toBeNull();
  });

  it("writes what the form holds rather than the example, and the slug follows a rename", async () => {
    const user = userEvent.setup();
    renderNewShop();
    const card = await createShopPage();

    await user.click(card.getByRole("button", { name: "Use an example shop" }));
    await user.clear(card.getByLabelText("Name"));
    await user.type(card.getByLabelText("Name"), "Rivermouth Goods");
    await user.click(card.getByRole("button", { name: "Create shop" }));

    // The example answers the name, not the slug, so renaming it carries the slug along rather
    // than leaving a shop called one thing addressed as another.
    expect(created).toEqual({
      identity: {
        name: "Rivermouth Goods",
        slug: "rivermouth-goods",
        locale: "en-GB",
        currencies: ["GBP"],
        channels: ["chat"],
      },
    });
  });

  it("does not claim the identity the seed writes, which arrives with content behind it", async () => {
    const user = userEvent.setup();
    renderNewShop();
    const card = await createShopPage();

    await user.click(card.getByRole("button", { name: "Use an example shop" }));

    expect(card.getByLabelText("Slug")).not.toHaveValue("northstar-outfitters");
  });

  it("says the example is filled in rather than created", async () => {
    const user = userEvent.setup();
    renderNewShop();
    const card = await createShopPage();

    await user.click(card.getByRole("button", { name: "Use an example shop" }));

    expect(card.getByRole("status")).toHaveTextContent(
      /nothing is created until you press Create shop/i,
    );
  });
});

describe("the slug a name suggests", () => {
  it("writes itself as the name is typed", async () => {
    const user = userEvent.setup();
    renderNewShop();
    const card = await createShopPage();

    await user.type(card.getByLabelText("Name"), "Harbour Lane Supply");

    expect(card.getByLabelText("Slug")).toHaveValue("harbour-lane-supply");
  });

  it("stops following once the operator answers the slug themselves", async () => {
    const user = userEvent.setup();
    renderNewShop();
    const card = await createShopPage();

    await user.type(card.getByLabelText("Name"), "Harbour Lane");
    await user.clear(card.getByLabelText("Slug"));
    await user.type(card.getByLabelText("Slug"), "harbour");
    await user.type(card.getByLabelText("Name"), " Supply");

    // The deliberate answer stands; a suggestion that overwrote it would be worse than none.
    expect(card.getByLabelText("Slug")).toHaveValue("harbour");
    expect(card.getByLabelText("Name")).toHaveValue("Harbour Lane Supply");
  });

  it("follows the name again once the slug is emptied", async () => {
    const user = userEvent.setup();
    renderNewShop();
    const card = await createShopPage();

    await user.type(card.getByLabelText("Name"), "Harbour");
    await user.clear(card.getByLabelText("Slug"));
    await user.type(card.getByLabelText("Slug"), "harbour-post");
    await user.clear(card.getByLabelText("Slug"));

    expect(card.getByLabelText("Slug")).toHaveValue("");

    await user.type(card.getByLabelText("Name"), " Lane");

    expect(card.getByLabelText("Slug")).toHaveValue("harbour-lane");
  });

  it("offers a free slug and refuses one already used by another shop", async () => {
    server.use(
      http.get("*/api/v1/shops", () =>
        HttpResponse.json({
          shops: [
            {
              shop_id: SHOP_ID,
              name: "Harbour Lane Supply",
              slug: "harbour-lane-supply",
              updated_at: "2026-08-23T12:05:00+00:00",
              latest_published_version: null,
              published_version_count: 0,
              logo: null,
            },
          ],
        } satisfies ShopListResponse),
      ),
    );
    const user = userEvent.setup();
    renderNewShop();
    const card = await createShopPage();

    await user.type(card.getByLabelText("Name"), "Harbour Lane Supply");

    expect(card.getByLabelText("Slug")).toHaveValue("harbour-lane-supply-2");
    expect(card.getByLabelText("Slug")).toHaveAccessibleDescription(
      /harbour-lane-supply is already used by another shop/i,
    );

    await user.clear(card.getByLabelText("Slug"));
    await user.type(card.getByLabelText("Slug"), "harbour-lane-supply");
    expect(card.getByLabelText("Slug")).toBeInvalid();
    await user.click(card.getByRole("button", { name: "Create shop" }));
    expect(created).toBeNull();
  });

  it("sends the derived slug, so a name alone is enough to create a shop", async () => {
    const user = userEvent.setup();
    renderNewShop();
    const card = await createShopPage();

    await user.type(card.getByLabelText("Name"), "Café Noël");
    await user.click(card.getByRole("button", { name: "Create shop" }));

    expect(created).toEqual({
      identity: {
        name: "Café Noël",
        slug: "cafe-noel",
        locale: "en-GB",
        currencies: ["GBP"],
        channels: ["chat"],
      },
    });
  });
});

describe("the locale a shop is given", () => {
  it("suggests the locales the lab knows, keyed by the tag that gets written", async () => {
    renderNewShop();
    const card = await createShopPage();
    const field = card.getByLabelText("Locale");

    const suggestions = document.getElementById(field.getAttribute("list") ?? "");
    const french = suggestions?.querySelector<HTMLOptionElement>('option[value="fr-FR"]');

    // The tag is the value, so picking a suggestion writes `fr-FR` and not "French (France)".
    expect(french?.label).toBe("French (France)");
  });

  it("still accepts a locale the suggestions leave out, which the lab would have taken", async () => {
    const user = userEvent.setup();
    renderNewShop();
    const card = await createShopPage();

    await user.type(card.getByLabelText("Name"), "Reykjavik Supply");
    await user.clear(card.getByLabelText("Locale"));
    await user.type(card.getByLabelText("Locale"), "is-IS");
    await user.click(card.getByRole("button", { name: "Create shop" }));

    // The shortlist is a suggestion and not the permitted set: a form that refused what the API
    // accepts would be a second, stricter rule nobody wrote down.
    expect(created).toMatchObject({ identity: { locale: "is-IS" } });
  });
});

describe("the currencies a shop sells in", () => {
  it("ticks the currency the locale implies, as the locale is chosen", async () => {
    const user = userEvent.setup();
    renderNewShop();
    const card = await createShopPage();

    await user.clear(card.getByLabelText("Locale"));
    await user.type(card.getByLabelText("Locale"), "ja-JP");

    expect(currencies(card).getByRole("checkbox", { name: "JPY — Japanese yen" })).toBeChecked();
    expect(
      currencies(card).getByRole("checkbox", { name: "GBP — Pound sterling" }),
    ).not.toBeChecked();
  });

  it("stops following once the operator ticks a currency themselves", async () => {
    const user = userEvent.setup();
    renderNewShop();
    const card = await createShopPage();

    await user.click(currencies(card).getByRole("checkbox", { name: "USD — US dollar" }));
    await user.clear(card.getByLabelText("Locale"));
    await user.type(card.getByLabelText("Locale"), "ja-JP");

    // A shop priced for a market it does not speak the language of is a real thing to author,
    // so the deliberate answer stands rather than being corrected on the next keystroke.
    expect(currencies(card).getByRole("checkbox", { name: "USD — US dollar" })).toBeChecked();
    expect(
      currencies(card).getByRole("checkbox", { name: "JPY — Japanese yen" }),
    ).not.toBeChecked();
  });

  it("leaves the currency alone for a locale it has no currency for", async () => {
    const user = userEvent.setup();
    renderNewShop();
    const card = await createShopPage();

    await user.clear(card.getByLabelText("Locale"));
    await user.type(card.getByLabelText("Locale"), "is-IS");

    // Iceland prices in krona, which the lab cannot express. Proposing the nearest currency
    // would be inventing an answer; the standing one is at least one somebody can see.
    expect(currencies(card).getByRole("checkbox", { name: "GBP — Pound sterling" })).toBeChecked();
  });

  it("offers every currency the lab can express, named as well as coded", async () => {
    renderNewShop();
    const card = await createShopPage();

    const boxes = currencies(card).getAllByRole("checkbox");

    expect(boxes).toHaveLength(10);
    expect(boxes[0]).toHaveAccessibleName("USD — US dollar");
  });

  it("creates a shop selling in more than one, the first of them the default", async () => {
    const user = userEvent.setup();
    renderNewShop();
    const card = await createShopPage();

    await user.type(card.getByLabelText("Name"), "Zurich Supply");
    await user.clear(card.getByLabelText("Locale"));
    await user.type(card.getByLabelText("Locale"), "de-CH");
    await user.click(currencies(card).getByRole("checkbox", { name: "EUR — Euro" }));

    // Read before the create, because what the group says the default is has to be what the
    // request then carries first — the claim and the payload, on one shop, in one test.
    expect(card.getByRole("group", { name: "Currencies" })).toHaveAccessibleDescription(
      /default: CHF — Swiss franc/i,
    );

    await user.click(card.getByRole("button", { name: "Create shop" }));

    // The Swiss shop is authored in one pass: the second currency is not a trip to Shop
    // details, and the franc it was suggested stays first, so it is what variants default to.
    expect(created).toEqual({
      identity: {
        name: "Zurich Supply",
        slug: "zurich-supply",
        locale: "de-CH",
        currencies: ["CHF", "EUR"],
        channels: ["chat"],
      },
    });
  });

  it("holds the last currency ticked, so the shop is never created without one", async () => {
    const user = userEvent.setup();
    renderNewShop();
    const card = await createShopPage();

    const only = currencies(card).getByRole("checkbox", { name: "GBP — Pound sterling" });
    await user.click(only);

    expect(only).toBeChecked();
  });
});

describe("the channels a new shop answers on", () => {
  it("answers on chat unless chosen otherwise, and creates the shop on what is chosen", async () => {
    const user = userEvent.setup();
    renderNewShop();
    const card = await createShopPage();

    const channels = within(
      within(card.getByRole("region", { name: "Channels" })).getByRole("group", {
        name: "Answers on",
      }),
    );
    // The same chips as Shop details, the last one on held on, with the rule on the group.
    expect(channels.getByRole("checkbox", { name: "Chat" })).toBeChecked();
    expect(channels.getByRole("checkbox", { name: "Chat" })).toBeDisabled();
    expect(card.getByRole("group", { name: "Answers on" })).toHaveAccessibleDescription(
      /the last channel left on stays on/i,
    );

    await user.type(card.getByLabelText("Name"), "Harbour Lane Supply");
    await user.click(channels.getByRole("checkbox", { name: "Email" }));
    await user.click(channels.getByRole("checkbox", { name: "Chat" }));
    await user.click(card.getByRole("button", { name: "Create shop" }));

    await waitFor(() => expect(created).not.toBeNull());
    expect(created).toMatchObject({ identity: { channels: ["email"] } });
  });
});

describe("create-form guidance", () => {
  it("puts each field's hint in that control's accessible description", async () => {
    renderNewShop();
    const card = await createShopPage();

    // Exact: Shop details' own Name row reads the same export, and the pair is the point.
    expect(card.getByLabelText("Name")).toHaveAccessibleDescription(
      wholeDescription(SHOP_NAME_RULE),
    );
    expect(card.getByLabelText("Slug")).toHaveAccessibleDescription(
      /lowercase with hyphens.*follows the name until you edit it/i,
    );
    expect(card.getByLabelText("Locale")).toHaveAccessibleDescription(
      /pick a locale from the list/i,
    );
    expect(card.getByRole("group", { name: "Currencies" })).toHaveAccessibleDescription(
      /variants may only be priced in these; the first is the default/i,
    );
    // The locale tag read back as the place it names, so a mistyped-but-plausible tag shows.
    expect(card.getByLabelText("Locale")).toHaveAccessibleDescription(
      /english \(united kingdom\)/i,
    );
  });

  it("keeps a refused create on the page, with the reason under the button", async () => {
    server.use(
      http.post("*/api/v1/shops", () =>
        HttpResponse.json(
          { code: "conflict", message: "A shop with this slug already exists.", request_id: "r" },
          { status: 409 },
        ),
      ),
    );
    const user = userEvent.setup();
    const { router } = renderNewShop();
    const card = await createShopPage();

    await user.type(card.getByLabelText("Name"), "Harbour Lane Supply");
    await user.click(card.getByRole("button", { name: "Create shop" }));

    // The operator stays where they were, with everything they typed, and reads why beside
    // the control they pressed (PLAN-UX Slice 12).
    const refusal = await card.findByRole("alert");
    expect(refusal).toHaveTextContent(/slug already exists/i);
    expect(router.state.location.pathname).toBe("/shops/new");
    expect(card.getByLabelText("Name")).toHaveValue("Harbour Lane Supply");
    const create = card.getByRole("button", { name: "Create shop" });
    expect(create).toHaveAccessibleDescription(/slug already exists/i);
    expect(create.compareDocumentPosition(refusal) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

describe("the shop logo (ADR 0070)", () => {
  const listed: ShopListResponse = {
    shops: [
      {
        shop_id: SHOP_ID,
        name: "Northstar Outfitters",
        slug: "northstar",
        updated_at: "2026-08-23T12:05:00+00:00",
        latest_published_version: 1,
        published_version_count: 1,
        logo: { mark: "compass", background: "ochre", mark_colour: "white" },
      },
      {
        shop_id: "1b2c3d4e-5f60-4718-9a0b-c1d2e3f4a5b6",
        name: "Northstar Outfitters FR",
        slug: "northstar-fr",
        updated_at: "2026-08-22T12:05:00+00:00",
        latest_published_version: null,
        published_version_count: 0,
        logo: null,
      },
    ],
  };

  function rowOf(name: string): HTMLElement {
    const link = screen.getByRole("link", { name });
    return link.closest("tr") as HTMLElement;
  }

  it("draws each index row's badge: the mark in its chosen colour, or the initials", async () => {
    server.use(http.get("*/api/v1/shops", () => HttpResponse.json(listed)));
    renderShops();
    await screen.findByRole("link", { name: "Northstar Outfitters" });

    const logod = rowOf("Northstar Outfitters").querySelector("[data-shop-badge]") as HTMLElement;
    expect(logod).toHaveAttribute("aria-hidden", "true");
    expect(logod.className).toContain("h-[30px]");
    // Ochre passes 3:1 with both, and the operator chose white: the badge draws white.
    expect(logod).toHaveStyle({ backgroundColor: "#a8802a", color: "#ffffff" });
    expect(logod.querySelector("svg")).toHaveAttribute("data-mark", "compass");
    expect(logod).not.toHaveTextContent("NO");

    const initials = rowOf("Northstar Outfitters FR").querySelector(
      "[data-shop-badge]",
    ) as HTMLElement;
    expect(initials).toHaveAttribute("aria-hidden", "true");
    expect(initials).toHaveTextContent(/^NO$/);
    expect(initials.querySelector("svg")).toBeNull();
    expect(initials).toHaveStyle({ color: "#ffffff" });

    // The badge adds nothing to what the row's link is called.
    expect(screen.getByRole("link", { name: "Northstar Outfitters FR" })).toBeVisible();
  });

  it("opens the create page on no logo and creates without one", async () => {
    const user = userEvent.setup();
    renderNewShop();
    const page = await createShopPage();

    const logo = within(page.getByRole("region", { name: "Logo" }));
    expect(
      logo.getByRole("radio", { name: "Monogram — the first letters of the name" }),
    ).toBeChecked();
    // The monogram and 28 marks, eight backgrounds, two colours.
    expect(logo.getAllByRole("radio")).toHaveLength(29 + 8 + 2);
    expect(
      logo.getAllByRole("radio").filter((radio) => (radio as HTMLInputElement).checked),
    ).toHaveLength(1);

    await user.type(page.getByLabelText("Name"), "Harbour Lane Supply");
    // The preview is the initials of the name as typed, on the lab's own ground.
    const badge = page
      .getByRole("region", { name: "Logo" })
      .querySelector("[data-shop-badge]") as HTMLElement;
    expect(badge).toHaveTextContent(/^HL$/);
    expect(badge).toHaveAttribute("aria-hidden", "true");
    await user.click(page.getByRole("button", { name: "Create shop" }));

    await waitFor(() => expect(created).not.toBeNull());
    expect(created).not.toHaveProperty("logo");
  });

  it("keeps a shop without a logo without one when the monogram is chosen again", async () => {
    const user = userEvent.setup();
    renderNewShop();
    const page = await createShopPage();
    const logo = within(page.getByRole("region", { name: "Logo" }));
    const monogram = logo.getByRole("radio", { name: "Monogram — the first letters of the name" });

    await user.click(monogram);
    monogram.focus();
    await user.keyboard(" ");

    expect(monogram).toBeChecked();
    expect(
      logo.getAllByRole("radio").filter((radio) => (radio as HTMLInputElement).checked),
    ).toEqual([monogram]);
    await user.type(page.getByLabelText("Name"), "Harbour Lane Supply");
    await user.click(page.getByRole("button", { name: "Create shop" }));
    await waitFor(() => expect(created).not.toBeNull());
    expect(created).not.toHaveProperty("logo");
  });

  it("creates a shop without a logo when the one picked is cleared", async () => {
    const user = userEvent.setup();
    renderNewShop();
    const page = await createShopPage();
    const logo = within(page.getByRole("region", { name: "Logo" }));
    expect(logo.getByRole("button", { name: "Clear logo" })).toBeDisabled();

    await user.click(logo.getByRole("radio", { name: "Anchor" }));
    await user.click(logo.getByRole("button", { name: "Clear logo" }));

    expect(
      logo.getAllByRole("radio").filter((radio) => (radio as HTMLInputElement).checked),
    ).toEqual([logo.getByRole("radio", { name: "Monogram — the first letters of the name" })]);
    await user.type(page.getByLabelText("Name"), "Harbour Lane Supply");
    await user.click(page.getByRole("button", { name: "Create shop" }));
    await waitFor(() => expect(created).not.toBeNull());
    expect(created).not.toHaveProperty("logo");
  });

  it("creates a shop with the logo chosen on the page", async () => {
    const user = userEvent.setup();
    renderNewShop();
    const page = await createShopPage();

    await user.type(page.getByLabelText("Name"), "Harbour Lane Supply");
    const logo = within(page.getByRole("region", { name: "Logo" }));
    await user.click(logo.getByRole("radio", { name: "Anchor" }));
    await user.click(logo.getByRole("radio", { name: "Clay" }));
    await user.click(logo.getByRole("radio", { name: "Ink" }));
    // Ink on Clay is 2.96:1: said under Mark colour, and Create is not refused for it.
    expect(logo.getByRole("group", { name: "Mark color" })).toHaveAccessibleDescription(
      /Hard to read against that background\. Try the other one\./,
    );
    await user.click(page.getByRole("button", { name: "Create shop" }));

    await waitFor(() => expect(created).not.toBeNull());
    expect(created?.logo).toEqual({ mark: "anchor", background: "clay", mark_colour: "ink" });
  });
});

describe("the logo card's swatches (ADR 0070)", () => {
  it("offers the prototype's eight backgrounds and two mark colours, each named by its colour", async () => {
    renderNewShop();
    const page = await createShopPage();
    const logo = within(page.getByRole("region", { name: "Logo" }));

    const backgrounds = within(logo.getByRole("group", { name: "Background" }));
    expect(backgrounds.getAllByRole("radio").map((radio) => radio.closest("label")?.title)).toEqual(
      ["Clay", "Pine", "Indigo", "Plum", "Forest", "Ochre", "Brick", "Stone"],
    );
    expect(backgrounds.getByRole("radio", { name: "Brick" }).closest("label")).toHaveStyle({
      backgroundColor: "#9d3028",
    });
    const colours = within(logo.getByRole("group", { name: "Mark color" }));
    expect(colours.getByRole("radio", { name: "White" }).closest("label")).toHaveStyle({
      backgroundColor: "#ffffff",
    });
    expect(colours.getByRole("radio", { name: "Ink" }).closest("label")).toHaveStyle({
      backgroundColor: "#16332d",
    });
    expect(logo.getByRole("group", { name: "Mark color" })).toHaveAccessibleDescription(
      /^What the icon or the letters are drawn in\.\s*$/,
    );
  });

  it("moves between swatches with the arrow keys, one tab stop per group", async () => {
    const user = userEvent.setup();
    renderNewShop();
    const page = await createShopPage();
    const logo = within(page.getByRole("region", { name: "Logo" }));

    // A first background starts the logo in the colour that reads on it: ink on Ochre.
    await user.click(logo.getByRole("radio", { name: "Ochre" }));
    expect(logo.getByRole("radio", { name: "Ochre" })).toHaveFocus();
    expect(logo.getByRole("radio", { name: "Ink" })).toBeChecked();
    await user.keyboard("{ArrowRight}");
    expect(logo.getByRole("radio", { name: "Brick" })).toHaveFocus();
    expect(logo.getByRole("radio", { name: "Brick" })).toBeChecked();
    // The colour does not follow the background: ink on Brick is 1.87:1, and the group says so.
    const warning = "Hard to read against that background. Try the other one.";
    const line = logo.getByText(warning);
    expect(line).toBeVisible();
    // A warning, not a refusal: announced politely, never as an alert, and not in the red.
    expect(line).not.toHaveAttribute("role", "alert");
    expect(line).toHaveAttribute("aria-live", "polite");
    expect(line).toHaveClass("text-admin-draft-ink", "font-normal");
    expect(line).not.toHaveClass("text-lab-error");
    expect(line).not.toHaveClass("font-semibold");
    expect(logo.getByRole("radio", { name: "Ink" })).not.toHaveAttribute("aria-invalid");

    await user.tab();
    expect(logo.getByRole("radio", { name: "Ink" })).toHaveFocus();
    await user.keyboard("{ArrowLeft}");
    expect(logo.getByRole("radio", { name: "White" })).toHaveFocus();
    expect(logo.getByRole("radio", { name: "White" })).toBeChecked();
    expect(logo.queryByText(warning)).toBeNull();
  });
});

describe("deleting a shop that never published (ADR 0077)", () => {
  const NORTHSTAR = SHOP_ID;
  const HARBOUR = "1b2c3d4e-5f60-4718-9a0b-c1d2e3f4a5b6";
  const FJORD = "2c3d4e5f-6071-4829-8b1c-d2e3f4a5b6c7";
  const summary = (shop_id: string, name: string, published: number | null) => ({
    shop_id,
    name,
    slug: name.toLowerCase().replaceAll(" ", "-"),
    updated_at: "2026-10-02T12:05:00+00:00",
    latest_published_version: published,
    published_version_count: published ?? 0,
    logo: null,
  });

  let held: ShopListResponse["shops"] = [];
  let deletes: string[] = [];
  let reads: string[] = [];
  let shopReads = 0;

  function serveTheLab(
    refusal?: { status: number; code: string; message: string },
    options: {
      /** What the lab holds once it has refused, as a shop published or deleted elsewhere. */
      afterRefusal?: (shops: ShopListResponse["shops"]) => ShopListResponse["shops"];
      /** Holds every delete's answer until it settles. */
      gate?: Promise<void>;
    } = {},
  ) {
    held = [
      summary(NORTHSTAR, "Northstar Outfitters", 3),
      summary(HARBOUR, "Harbour Lane Supply", null),
      summary(FJORD, "Fjord Supply", null),
    ];
    deletes = [];
    reads = [];
    shopReads = 0;
    const rows = (count: number) => Array.from({ length: count }, (_, index) => ({ index }));
    server.use(
      http.get("*/api/v1/shops", () => {
        shopReads += 1;
        return HttpResponse.json({ shops: held });
      }),
      http.delete("*/api/v1/shops/:shopId", async ({ params }) => {
        deletes.push(String(params.shopId));
        await options.gate;
        if (refusal) {
          held = options.afterRefusal ? options.afterRefusal(held) : held;
          return HttpResponse.json(
            { code: refusal.code, message: refusal.message, request_id: "req-1" },
            { status: refusal.status },
          );
        }
        held = held.filter((shop) => shop.shop_id !== params.shopId);
        return new HttpResponse(null, { status: 204 });
      }),
      http.get("*/api/v1/shops/:shopId/draft", () => {
        reads.push("draft");
        return HttpResponse.json({ content: { products: rows(2) } });
      }),
      http.get("*/api/v1/shops/:shopId/orders", () => {
        reads.push("orders");
        return HttpResponse.json({ orders: rows(1) });
      }),
      http.get("*/api/v1/shops/:shopId/tickets", () => {
        reads.push("tickets");
        return HttpResponse.json({ tickets: [] });
      }),
      http.get("*/api/v1/shops/:shopId/scenarios", () => {
        reads.push("scenarios");
        return HttpResponse.json({ scenarios: rows(1) });
      }),
      http.get("*/api/v1/shops/:shopId/media", () => {
        reads.push("media");
        return HttpResponse.json({ media: rows(3) });
      }),
    );
  }

  const trash = (name: string) => screen.findByRole("button", { name: `Delete ${name}` });

  it("holds a published shop's trash and says why, and offers the others", async () => {
    serveTheLab();
    renderShops();

    const kept = await trash("Northstar Outfitters");
    expect(kept).toBeDisabled();
    expect(kept).toHaveAttribute("title", PUBLISHED_SHOP_KEPT);
    expect(kept).toHaveAccessibleDescription(PUBLISHED_SHOP_KEPT);
    expect(screen.getByText(PUBLISHED_SHOP_KEPT)).toBeVisible();
    for (const name of ["Harbour Lane Supply", "Fjord Supply"]) {
      const offered = screen.getByRole("button", { name: `Delete ${name}` });
      expect(offered).toBeEnabled();
      expect(offered).toHaveAttribute("title", `Delete ${name}`);
    }
    // Nothing is counted until a confirm asks: no row reads what its shop holds.
    expect(reads).toEqual([]);
  });

  it("asks in the warm red, counting what goes once when it opens", async () => {
    serveTheLab();
    // The draft answers only once the confirm has been seen waiting for it.
    let answer: () => void = () => undefined;
    const answered = new Promise<void>((resolve) => {
      answer = resolve;
    });
    server.use(
      http.get("*/api/v1/shops/:shopId/draft", async () => {
        reads.push("draft");
        await answered;
        return HttpResponse.json({ content: { products: [{}, {}] } });
      }),
    );
    const user = userEvent.setup();
    renderShops();

    await user.click(await trash("Harbour Lane Supply"));

    const confirm = screen.getByRole("group", {
      name: "Delete Harbour Lane Supply and everything it holds?",
    });
    expect(confirm).toHaveFocus();
    const press = within(confirm).getByRole("button", { name: "Delete it" });
    expect(press).toBeDisabled();
    expect(press).toHaveAccessibleDescription(COUNTING);
    expect(press.className).toContain("bg-lab-error");
    expect(within(confirm).getByRole("status")).toHaveTextContent(COUNTING);
    answer();
    await within(confirm).findByText(
      "It holds 2 products, 1 order, no ticket, 1 scenario and 3 images, and all of it goes with the shop.",
    );
    expect(confirm).toHaveAccessibleDescription(expect.stringContaining(SHOP_DELETE_KEEPS));
    expect(press).toBeEnabled();
    expect([...reads].sort()).toEqual(["draft", "media", "orders", "scenarios", "tickets"]);

    await user.click(within(confirm).getByRole("button", { name: "Keep it" }));

    expect(deletes).toEqual([]);
    expect(screen.getByRole("button", { name: "Delete Harbour Lane Supply" })).toHaveFocus();
  });

  it("deletes on the second press, takes the row away and leaves focus on the notice", async () => {
    serveTheLab();
    const user = userEvent.setup();
    renderShops();
    await user.click(await trash("Harbour Lane Supply"));
    const confirm = screen.getByRole("group", {
      name: "Delete Harbour Lane Supply and everything it holds?",
    });
    const press = within(confirm).getByRole("button", { name: "Delete it" });
    await waitFor(() => expect(press).toBeEnabled());
    const listingsBefore = shopReads;

    await user.click(press);

    const notice = await screen.findByText("Deleted Harbour Lane Supply and everything it held.");
    await waitFor(() => expect(notice).toHaveFocus());
    expect(deletes).toEqual([HARBOUR]);
    expect(screen.queryByRole("link", { name: "Harbour Lane Supply" })).toBeNull();
    expect(screen.getByRole("link", { name: "Fjord Supply" })).toBeVisible();
    await waitFor(() => expect(shopReads).toBe(listingsBefore + 1));
  });

  it("deletes on one press when the preference has removed the second", async () => {
    serveTheLab();
    window.localStorage.setItem("agent-lab.confirm-before-delete", "false");
    const user = userEvent.setup();
    renderShops();

    await user.click(await trash("Fjord Supply"));

    await screen.findByText("Deleted Fjord Supply and everything it held.");
    expect(deletes).toEqual([FJORD]);
    expect(reads).toEqual([]);
    expect(screen.queryByRole("link", { name: "Fjord Supply" })).toBeNull();
  });

  it("says the lab's refusal and keeps the row", async () => {
    const message = `shop ${HARBOUR} is kept because it has published 1 version: its versions are what experiments are explained by`;
    serveTheLab(
      { status: 409, code: "shop_published", message },
      {
        afterRefusal: (shops) =>
          shops.map((shop) =>
            shop.shop_id === HARBOUR
              ? { ...shop, latest_published_version: 1, published_version_count: 1 }
              : shop,
          ),
      },
    );
    window.localStorage.setItem("agent-lab.confirm-before-delete", "false");
    const user = userEvent.setup();
    renderShops();

    await user.click(await trash("Harbour Lane Supply"));

    expect(await screen.findByRole("alert")).toHaveTextContent(message);
    expect(screen.getByRole("link", { name: "Harbour Lane Supply" })).toBeVisible();
    expect(screen.queryByText(/everything it held/)).toBeNull();
    // Published since the listing was read: its trash is held now, so the alert takes focus.
    await waitFor(() => expect(screen.getByRole("alert")).toHaveFocus());
    expect(screen.getByRole("button", { name: "Delete Harbour Lane Supply" })).toBeDisabled();
  });

  it("hands focus to the alert when the shop was deleted elsewhere", async () => {
    const message = `shop ${HARBOUR} has no draft`;
    serveTheLab(
      { status: 404, code: "shop_not_found", message },
      { afterRefusal: (shops) => shops.filter((shop) => shop.shop_id !== HARBOUR) },
    );
    const user = userEvent.setup();
    renderShops();
    await user.click(await trash("Harbour Lane Supply"));
    const confirm = screen.getByRole("group", {
      name: "Delete Harbour Lane Supply and everything it holds?",
    });
    const press = within(confirm).getByRole("button", { name: "Delete it" });
    await waitFor(() => expect(press).toBeEnabled());

    await user.click(press);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(message);
    await waitFor(() =>
      expect(screen.queryByRole("link", { name: "Harbour Lane Supply" })).toBeNull(),
    );
    await waitFor(() => expect(alert).toHaveFocus());
  });

  it("returns focus to the trash when the refusal leaves it free", async () => {
    serveTheLab({ status: 500, code: "internal_error", message: "The lab failed." });
    window.localStorage.setItem("agent-lab.confirm-before-delete", "false");
    const user = userEvent.setup();
    renderShops();

    await user.click(await trash("Harbour Lane Supply"));

    expect(await screen.findByRole("alert")).toHaveTextContent("The lab failed.");
    const again = screen.getByRole("button", { name: "Delete Harbour Lane Supply" });
    await waitFor(() => expect(again).toHaveFocus());
    expect(again).toBeEnabled();
  });

  it("says a count it could not read, and still deletes", async () => {
    serveTheLab();
    server.use(
      http.get("*/api/v1/shops/:shopId/tickets", () =>
        HttpResponse.json(
          { code: "internal_error", message: "The tickets could not be read.", request_id: "r" },
          { status: 500 },
        ),
      ),
    );
    const user = userEvent.setup();
    renderShops();
    await user.click(await trash("Harbour Lane Supply"));
    const confirm = screen.getByRole("group", {
      name: "Delete Harbour Lane Supply and everything it holds?",
    });

    await within(confirm).findByText(
      "What it holds could not be counted: The tickets could not be read.",
    );
    const press = within(confirm).getByRole("button", { name: "Delete it" });
    expect(press).toBeEnabled();
    await user.click(press);

    await screen.findByText("Deleted Harbour Lane Supply and everything it held.");
    expect(deletes).toEqual([HARBOUR]);
  });

  it("holds the row's trash while its delete is in flight, and sends one delete at a time", async () => {
    let settle: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      settle = resolve;
    });
    serveTheLab(undefined, { gate });
    window.localStorage.setItem("agent-lab.confirm-before-delete", "false");
    const user = userEvent.setup();
    renderShops();

    await user.click(await trash("Harbour Lane Supply"));

    const inFlight = screen.getByRole("button", { name: "Delete Harbour Lane Supply" });
    await waitFor(() => expect(inFlight).toBeDisabled());
    expect(inFlight).toHaveAttribute("title", DELETING_SHOP);
    // Another shop's trash, pressed while the first delete has not answered, sends nothing.
    await user.click(screen.getByRole("button", { name: "Delete Fjord Supply" }));
    expect(deletes).toEqual([HARBOUR]);

    settle();

    await screen.findByText("Deleted Harbour Lane Supply and everything it held.");
    expect(deletes).toEqual([HARBOUR]);
    expect(screen.getByRole("link", { name: "Fjord Supply" })).toBeVisible();
  });
});

describe("the switcher after a shop is deleted (ADR 0077)", () => {
  const HARBOUR = "1b2c3d4e-5f60-4718-9a0b-c1d2e3f4a5b6";
  const FJORD = "2c3d4e5f-6071-4829-8b1c-d2e3f4a5b6c7";
  const LAST_VISITED = "agent-lab.last-visited-shop";
  let held: ShopListResponse["shops"] = [];

  function serveTwoShops() {
    held = [
      {
        shop_id: HARBOUR,
        name: "Harbour Lane Supply",
        slug: "harbour-lane-supply",
        updated_at: "2026-10-02T12:05:00+00:00",
        latest_published_version: null,
        published_version_count: 0,
        logo: null,
      },
      {
        shop_id: FJORD,
        name: "Fjord Supply",
        slug: "fjord-supply",
        updated_at: "2026-10-02T12:04:00+00:00",
        latest_published_version: null,
        published_version_count: 0,
        logo: null,
      },
    ];
    window.localStorage.setItem("agent-lab.confirm-before-delete", "false");
    server.use(
      http.get("*/api/v1/shops", () => HttpResponse.json({ shops: held })),
      http.delete("*/api/v1/shops/:shopId", ({ params }) => {
        held = held.filter((shop) => shop.shop_id !== params.shopId);
        return new HttpResponse(null, { status: 204 });
      }),
    );
  }

  it("lists only the shops that remain, and forgets the remembered shop it named", async () => {
    serveTwoShops();
    window.localStorage.setItem(LAST_VISITED, HARBOUR);
    const user = userEvent.setup();
    const { router } = renderShops();

    await user.click(await screen.findByRole("button", { name: "Delete Harbour Lane Supply" }));
    await screen.findByText("Deleted Harbour Lane Supply and everything it held.");

    expect(window.localStorage.getItem(LAST_VISITED)).toBeNull();
    await router.navigate("/lab/judges");
    await user.click(await screen.findByRole("button", { name: /^Switch shop/ }));
    const menu = screen.getByRole("menu", { name: "Shops" });
    expect(within(menu).queryByRole("menuitem", { name: /Harbour Lane Supply/ })).toBeNull();
    expect(within(menu).getByRole("menuitem", { name: /Fjord Supply/ })).toBeVisible();
  });

  it("keeps the remembered shop when another one is deleted", async () => {
    serveTwoShops();
    window.localStorage.setItem(LAST_VISITED, FJORD);
    const user = userEvent.setup();
    renderShops();

    await user.click(await screen.findByRole("button", { name: "Delete Harbour Lane Supply" }));
    await screen.findByText("Deleted Harbour Lane Supply and everything it held.");

    expect(window.localStorage.getItem(LAST_VISITED)).toBe(FJORD);
  });
});
