import { createBrowserRouter, RouterProvider } from "react-router-dom";
import { routeTree } from "./routeTree";

// A data router rather than `BrowserRouter`: `useBlocker`, which is how the workspace asks
// before unsaved work is thrown away, exists only on one (ADR 0051). The tree it is built from
// is the same tree, written the same way.
//
// Built once, at module scope, rather than inside the component: `createBrowserRouter` owns the
// history and the navigation state, so a router rebuilt on each render would throw both away —
// and under `StrictMode`'s double render there would be two of them before the first paint.
const router = createBrowserRouter(routeTree);

// Hand the superseded router back when this module is hot-replaced. `RouterProvider` re-subscribes
// to the new one, but the old one keeps its `popstate` and `pagehide` listeners until it is told
// to let go — and an edit to `routeTree.tsx` now hot-updates this module rather than reloading the
// page, so in development that happens often enough to be worth one line. Stripped from the build.
import.meta.hot?.dispose(() => router.dispose());

/**
 * The application as the browser mounts it.
 *
 * It is the data router and nothing else. The test entry builds its own memory data router over
 * the same `routeTree` (`src/test/app.tsx`) rather than coming through here, because a suite
 * needs to open at a chosen path and this one opens at the address bar — the tree is what the
 * two share, and the router is exactly what they must not (ADR 0051).
 */
export function App() {
  return <RouterProvider router={router} />;
}
