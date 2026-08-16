import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { App } from "./App";

describe("App", () => {
  it("explains that agent features are intentionally deferred", () => {
    render(<App />);

    expect(screen.getByRole("heading", { name: "Agent Framework Capability Lab" })).toBeVisible();
    expect(screen.getByText("Agent Pydantic AI")).toBeVisible();
    expect(screen.getByText("Délibérément reporté")).toBeVisible();
  });
});
