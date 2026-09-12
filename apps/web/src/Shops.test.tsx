import type { ShopListResponse } from "@agent-lab/contracts";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { setupServer } from "msw/node";
import { MemoryRouter } from "react-router-dom";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { App } from "./App";

const SHOP_ID = "9c8b7a6d-5e4f-4a3b-9c8d-7e6f5a4b3c2d";

const empty: ShopListResponse = { shops: [] };

let created: Record<string, unknown> | null = null;

const server = setupServer(
  http.get("*/api/v1/shops", () => HttpResponse.json(empty)),
  http.post("*/api/v1/shops", async ({ request }) => {
    created = (await request.json()) as Record<string, unknown>;
    return HttpResponse.json({ shop_id: SHOP_ID }, { status: 201 });
  }),
);

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => {
  server.resetHandlers();
  created = null;
  window.localStorage.clear();
});
afterAll(() => server.close());

function renderShops() {
  return render(
    <MemoryRouter initialEntries={["/shops"]}>
      <App />
    </MemoryRouter>,
  );
}

async function createShopCard() {
  const heading = await screen.findByRole("heading", { name: "Create a shop" });
  const card = heading.closest("div")?.parentElement;
  if (!card) throw new Error("the Create a shop card has no container");
  return within(card as HTMLElement);
}

describe("creating a shop from an example", () => {
  it("fills every field the form requires, so the example is publishable as typed", async () => {
    const user = userEvent.setup();
    renderShops();
    const card = await createShopCard();

    await user.click(card.getByRole("button", { name: "Use an example shop" }));

    expect(card.getByLabelText("Name")).toHaveValue("Harbour Lane Supply");
    expect(card.getByLabelText("Slug")).toHaveValue("harbour-lane-supply");
    expect(card.getByLabelText("Locale")).toHaveValue("en-GB");
    expect(card.getByLabelText("Currency")).toHaveValue("EUR");
  });

  it("creates nothing until the operator presses Create shop", async () => {
    const user = userEvent.setup();
    renderShops();
    const card = await createShopCard();

    await user.click(card.getByRole("button", { name: "Use an example shop" }));

    expect(created).toBeNull();
  });

  it("writes what the form holds rather than the example, and the slug follows a rename", async () => {
    const user = userEvent.setup();
    renderShops();
    const card = await createShopCard();

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
        currencies: ["EUR"],
        channels: ["chat"],
      },
    });
  });

  it("does not claim the identity the seed writes, which arrives with content behind it", async () => {
    const user = userEvent.setup();
    renderShops();
    const card = await createShopCard();

    await user.click(card.getByRole("button", { name: "Use an example shop" }));

    expect(card.getByLabelText("Slug")).not.toHaveValue("northstar-outfitters");
  });

  it("says the example is filled in rather than created", async () => {
    const user = userEvent.setup();
    renderShops();
    const card = await createShopCard();

    await user.click(card.getByRole("button", { name: "Use an example shop" }));

    expect(card.getByRole("status")).toHaveTextContent(
      /nothing is created until you press Create shop/i,
    );
  });
});

describe("the slug a name suggests", () => {
  it("writes itself as the name is typed", async () => {
    const user = userEvent.setup();
    renderShops();
    const card = await createShopCard();

    await user.type(card.getByLabelText("Name"), "Harbour Lane Supply");

    expect(card.getByLabelText("Slug")).toHaveValue("harbour-lane-supply");
  });

  it("stops following once the operator answers the slug themselves", async () => {
    const user = userEvent.setup();
    renderShops();
    const card = await createShopCard();

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
    renderShops();
    const card = await createShopCard();

    await user.type(card.getByLabelText("Name"), "Harbour");
    await user.type(card.getByLabelText("Slug"), "-post");
    await user.clear(card.getByLabelText("Slug"));
    await user.type(card.getByLabelText("Name"), " Lane");

    expect(card.getByLabelText("Slug")).toHaveValue("harbour-lane");
  });

  it("sends the derived slug, so a name alone is enough to create a shop", async () => {
    const user = userEvent.setup();
    renderShops();
    const card = await createShopCard();

    await user.type(card.getByLabelText("Name"), "Café Noël");
    await user.click(card.getByRole("button", { name: "Create shop" }));

    expect(created).toEqual({
      identity: {
        name: "Café Noël",
        slug: "cafe-noel",
        locale: "en-GB",
        currencies: ["EUR"],
        channels: ["chat"],
      },
    });
  });
});
