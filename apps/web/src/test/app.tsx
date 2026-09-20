import { render } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { routeTree } from "../App";

/**
 * The application at one path, on the data router it actually ships on.
 *
 * `useBlocker` — and so the whole unsaved-work guard — exists only on a data router, so a suite
 * that mounted the tree under `MemoryRouter` would be testing a router the application does not
 * use (ADR 0051). Written once here because every page suite renders the same way.
 */
export function renderApp(path: string) {
  const router = createMemoryRouter(routeTree, { initialEntries: [path] });
  return { ...render(<RouterProvider router={router} />), router };
}

/**
 * One rule, matched as the whole of a control's accessible description.
 *
 * `toHaveAccessibleDescription` with a string is an equality, and every `Field` keeps an
 * empty second line mounted beside its hint so a later preview can announce politely — which
 * puts one space on the end of the computed description. So a rule that is exactly a row's
 * whole description still fails a string comparison. This anchors it instead, which is the
 * same claim without the artefact: the description is this sentence and nothing else.
 *
 * It exists so that a create form and the editor row for the same field can be asserted to
 * read *one* sentence. A substring would pass while the two drifted apart, which is the
 * failure `lib/fieldRules.ts` was opened to prevent.
 */
export function wholeDescription(rule: string): RegExp {
  return new RegExp(`^${rule.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`);
}
