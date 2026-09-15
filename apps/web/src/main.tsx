import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router-dom";
import { routeTree } from "./App";
import "./styles.css";

const root = document.getElementById("root");

if (!root) {
  throw new Error("Missing root element");
}

// A data router rather than `BrowserRouter`: `useBlocker`, which is how the workspace asks
// before unsaved work is thrown away, exists only on one (ADR 0051). The tree it is built from
// is the same tree, written the same way.
const router = createBrowserRouter(routeTree);

createRoot(root).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
