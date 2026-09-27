import type { ShopListResponse } from "@agent-lab/contracts";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { SHOP_NAME_RULE } from "./lib/fieldRules";
import { cardTitleClasses } from "./lib/ui";
import { renderApp, wholeDescription } from "./test/app";
import { expectNotRefused, expectRefused } from "./test/refused";
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
  // The one card header on this page is drawn in open code, because the filter row has to sit
  // between the title and the table. A copy is a thing that drifts, so it is held to the
  // spelling `Card` uses rather than to a repeat of the numbers.
  it("titles itself the way every other card in the workspace does", async () => {
    renderShops();

    const title = await screen.findByRole("heading", { level: 2, name: "All shops" });

    for (const className of cardTitleClasses.split(" ")) {
      expect(title.className).toContain(className);
    }
    // Presence alone would pass a header that kept a sans size beside the shared one, which is
    // exactly how a copy half-reverts.
    expect(title.className).not.toMatch(/\btext-(xs|sm|base|lg|xl)\b/);
  });
});

describe("the shops index and its create page", () => {
  it("offers a New shop button rather than a form beside the table", async () => {
    renderShops();

    await screen.findByRole("heading", { level: 2, name: "All shops" });
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
        logo: { mark: "compass", background: "ochre" },
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

  it("draws each index row's badge: the mark in its derived colour, or the initials", async () => {
    server.use(http.get("*/api/v1/shops", () => HttpResponse.json(listed)));
    renderShops();
    await screen.findByRole("link", { name: "Northstar Outfitters" });

    const logod = rowOf("Northstar Outfitters").querySelector("[data-shop-badge]") as HTMLElement;
    expect(logod).toHaveAttribute("aria-hidden", "true");
    expect(logod.className).toContain("h-[30px]");
    // Ochre passes 3:1 with both; the lab draws the higher of the two, which is ink.
    expect(logod).toHaveStyle({ backgroundColor: "#a8802a", color: "#16332d" });
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
    expect(logo.getByRole("radio", { name: "None — initials" })).toBeChecked();
    expect(logo.getAllByRole("radio")).toHaveLength(29);

    await user.type(page.getByLabelText("Name"), "Harbour Lane Supply");
    // The preview is the initials of the name as typed.
    expect(logo.getByText("HL")).toHaveAttribute("aria-hidden", "true");
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
    await user.click(page.getByRole("button", { name: "Create shop" }));

    await waitFor(() => expect(created).not.toBeNull());
    expect(created?.logo).toEqual({ mark: "anchor", background: "clay" });
  });
});

describe("the logo card's background (ADR 0070)", () => {
  it("keeps the background chosen before None when a mark is chosen again", async () => {
    const user = userEvent.setup();
    renderNewShop();
    const page = await createShopPage();
    const logo = within(page.getByRole("region", { name: "Logo" }));

    await user.click(logo.getByRole("radio", { name: "Compass" }));
    expect(logo.getByRole("radio", { name: "Pine" })).toBeChecked();
    await user.click(logo.getByRole("radio", { name: "Indigo" }));
    await user.click(logo.getByRole("radio", { name: "None — initials" }));
    expect(logo.queryByRole("radio", { name: "Indigo" })).toBeNull();

    await user.click(logo.getByRole("radio", { name: "Anchor" }));
    expect(logo.getByRole("radio", { name: "Indigo" })).toBeChecked();
    expect(logo.getByRole("radio", { name: "Pine" })).not.toBeChecked();

    await user.type(page.getByLabelText("Name"), "Harbour Lane Supply");
    await user.click(page.getByRole("button", { name: "Create shop" }));
    await waitFor(() => expect(created).not.toBeNull());
    expect(created?.logo).toEqual({ mark: "anchor", background: "indigo" });
  });
});
