import type { Page } from "@playwright/test";

interface AXNode {
  nodeId: string;
  ignored?: boolean;
  role?: { value?: string };
  name?: { value?: string };
  childIds?: string[];
}

const CELL_ROLES = new Set(["cell", "gridcell", "rowheader", "columnheader"]);

/**
 * A table as the browser's own accessibility tree holds it — Chromium's, read over the DevTools
 * protocol rather than computed by Playwright from the markup — as the roles of each row's
 * cells, in order. `null` when no table of that name is in the tree.
 *
 * Playwright's role queries compute roles from the elements themselves, so they cannot see a
 * browser dropping a table's semantics because its parts were drawn `display: block`; this does.
 */
export async function accessibleTable(page: Page, name: string): Promise<string[][] | null> {
  const client = await page.context().newCDPSession(page);
  const { nodes } = (await client.send("Accessibility.getFullAXTree")) as { nodes: AXNode[] };
  await client.detach();
  const byId = new Map(nodes.map((node) => [node.nodeId, node]));
  const roleOf = (node: AXNode | undefined) => node?.role?.value ?? "";
  const table = nodes.find((node) => roleOf(node) === "table" && node.name?.value === name);
  if (table === undefined) {
    return null;
  }
  // Each descendant of `from` that `stop` accepts, without descending into it.
  const collect = (from: AXNode, stop: (node: AXNode) => boolean): AXNode[] =>
    (from.childIds ?? []).flatMap((id) => {
      const child = byId.get(id);
      if (child === undefined) return [];
      return stop(child) ? [child] : collect(child, stop);
    });
  return collect(table, (node) => roleOf(node) === "row").map((row) =>
    collect(row, (node) => CELL_ROLES.has(roleOf(node))).map(roleOf),
  );
}
