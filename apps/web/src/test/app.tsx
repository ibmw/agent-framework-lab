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
