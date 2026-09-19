import type { ShopSummarySchema } from "@agent-lab/contracts";
import {
  Bot,
  Boxes,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Clock,
  FileText,
  Home,
  type LucideIcon,
  MessageSquare,
  Play,
  Scale,
  Settings,
  Shapes,
  Store,
  Tag,
  Target,
  UserCog,
  Users,
  Zap,
} from "lucide-react";
import { type ReactNode, useState } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { readNavigationCollapsed, writeNavigationCollapsed } from "../lib/preferences";
import { focusRingClasses } from "../lib/ui";

interface NavEntry {
  label: string;
  to?: string;
  /**
   * The glyph, not a rendered element: the rail draws it at 17px expanded and 19px collapsed
   * (handoff, *Navigation rail*), so the size belongs to the row and not to this table.
   */
  icon: LucideIcon;
  /**
   * Match the path exactly instead of by prefix. Only Home needs it: every other section
   * owns nested editor routes and must stay highlighted while one is open.
   */
  exact?: boolean;
  /** Sections whose slice has not landed yet stay visible but inert. */
  milestone?: string;
  /**
   * Nested entries, indented under their parent. Only Scenarios has them: the two block
   * libraries live under it because a scenario is what composes them, even though the
   * libraries themselves are shared across shops.
   */
  children?: NavEntry[];
}

interface NavSection {
  title?: string;
  entries: NavEntry[];
}

function studioSections(shopId: string): NavSection[] {
  const base = `/shops/${shopId}`;
  return [
    {
      entries: [
        { label: "Home", to: base, icon: Home, exact: true },
        { label: "Products", to: `${base}/products`, icon: Tag },
        { label: "Orders", to: `${base}/orders`, icon: Boxes },
        { label: "Customers", to: `${base}/customers`, icon: Users },
        { label: "Tickets", to: `${base}/tickets`, icon: MessageSquare },
        {
          label: "Scenarios",
          to: `${base}/scenarios`,
          icon: ClipboardList,
          children: [
            {
              label: "All scenarios",
              to: `${base}/scenarios`,
              icon: ClipboardList,
            },
            {
              label: "Objective blocks",
              to: `${base}/objective-blocks`,
              icon: Target,
            },
            {
              label: "Mutation blocks",
              to: `${base}/mutation-blocks`,
              icon: Zap,
            },
          ],
        },
      ],
    },
    {
      title: "Shop setup",
      entries: [
        { label: "Policies & FAQ", to: `${base}/setup/policies`, icon: FileText },
        {
          label: "Support guidelines",
          to: `${base}/setup/support`,
          icon: ClipboardList,
        },
        { label: "Tone of voice", to: `${base}/setup/tone`, icon: Shapes },
        { label: "Shop details", to: `${base}/setup/identity`, icon: Store },
      ],
    },
    {
      title: "Experiment lab · cross-shop",
      entries: [
        {
          label: "Support identities",
          to: `${base}/support-identities`,
          icon: UserCog,
        },
        {
          label: "Agent configurations",
          to: `${base}/agent-configurations`,
          icon: Bot,
        },
        { label: "Judges", to: `${base}/judges`, icon: Scale },
        { label: "Bench", to: `${base}/bench`, icon: Play },
        { label: "History", to: `${base}/history`, icon: Clock },
      ],
    },
  ];
}

/**
 * The rail's own colours, none of which the handoff's token table carries.
 *
 * The hover wash, the heading grey and the active row's ink have no row in that table, and
 * they are written here as literals for the reason `lib/ui.ts` gives for `#f1f2f3`: a colour
 * one file uses is not yet a token, and minting one for a single consumer is the other half
 * of the mistake. `admin-border`, `admin-muted`, `admin-ink` and `admin-ink-soft` *are* in
 * the table and are used as tokens below wherever the value matches.
 *
 * Shared by both states: the transition, the focus ring the prototype draws on every rail row,
 * and nothing that carries a measurement.
 */
const entryBaseClasses = `flex items-center transition ${focusRingClasses}`;

/**
 * Expanded: 8px/11px in a 7px radius, the glyph 10px from its label and drawn at 0.75 unless
 * this is the row you are standing on. `NavLink` marks that row `aria-current="page"`, so the
 * dimming is a selector rather than a second piece of state threaded down to the glyph.
 */
const expandedEntryClasses = `${entryBaseClasses} gap-2.5 rounded-[7px] px-[11px] py-2 text-[13px] [&:not([aria-current])>svg]:opacity-75`;

/** Collapsed: a centred glyph in a 36px row, which is what the 52px strip has room for. */
const collapsedEntryClasses = `${entryBaseClasses} h-9 justify-center rounded-lg text-[13px]`;

/**
 * The inactive ink is not one colour. Expanded, a row is a labelled line of text at `#42474c`;
 * collapsed, it is a glyph alone and the prototype lifts it to `#6d7175` at 650, which reads as
 * a strip of marks rather than a list with its words deleted. Both are tokens; the wash they
 * share is not.
 */
const inactiveExpandedClasses = "text-admin-ink-soft hover:bg-[#eceef0] hover:text-admin-ink";

const inactiveCollapsedClasses =
  "font-[650] text-admin-muted hover:bg-[#eceef0] hover:text-admin-ink";

/** Active row: `#e8f0ed` behind `#14352e` at 700, washing to `#ddeae5` under the pointer. */
const activeEntryClasses = "bg-[#e8f0ed] font-bold text-[#14352e] hover:bg-[#ddeae5]";

/**
 * The foot control. It is not an entry: the handoff gives it its own type — 12.5px at 650 in
 * `admin-muted`, above a 1px rule — and no wash under the pointer, only a darker ink.
 */
const expandedFootClasses = `flex w-full items-center gap-2 rounded-[7px] px-[11px] py-[9px] text-[12.5px] font-[650] transition ${focusRingClasses}`;

const collapsedFootClasses = `flex h-9 w-full items-center justify-center rounded-lg transition ${focusRingClasses}`;

const footInkClasses = "text-admin-muted hover:text-admin-ink";

function SidebarEntry({
  entry,
  collapsed,
  nested = false,
}: {
  entry: NavEntry;
  collapsed: boolean;
  /** Indent only while the rail is expanded; a collapsed rail has no room for a hierarchy. */
  nested?: boolean;
}) {
  const Icon = entry.icon;
  // The label is never dropped, only hidden: a destination the collapsed rail cannot name is a
  // destination a screen reader cannot reach, and `title` alone is not an accessible name.
  const label = collapsed ? (
    <span className="sr-only">{entry.label}</span>
  ) : (
    <span>{entry.label}</span>
  );
  // Hidden from assistive technology, as every other glyph in this workspace is: the row is
  // named by its label, and a drawing that announced itself would rename all fifteen.
  const glyph = (
    <Icon aria-hidden="true" className="flex-none" focusable="false" size={collapsed ? 19 : 17} />
  );
  const layout = collapsed
    ? collapsedEntryClasses
    : nested
      ? `${expandedEntryClasses} ml-3.5 border-l border-admin-border pl-3`
      : expandedEntryClasses;
  const inactive = collapsed ? inactiveCollapsedClasses : inactiveExpandedClasses;

  if (!entry.to) {
    return (
      <span
        className={`${layout} ${inactive} cursor-not-allowed opacity-55`}
        title={`Arrives with ${entry.milestone}`}
      >
        {glyph}
        {label}
        {collapsed ? null : (
          <span className="ml-auto text-[10px] font-semibold tracking-wide text-admin-muted uppercase">
            soon
          </span>
        )}
      </span>
    );
  }

  return (
    <NavLink
      to={entry.to}
      end={entry.exact ?? false}
      title={collapsed ? entry.label : undefined}
      className={({ isActive }) =>
        isActive
          ? `${layout} ${activeEntryClasses} no-underline`
          : `${layout} ${inactive} no-underline`
      }
    >
      {glyph}
      {label}
    </NavLink>
  );
}

/**
 * The lab's own surfaces, which are not a shop's. They sit in the header rather than in the
 * rail because the rail only exists inside a shop workspace, and the first thing a new
 * operator has to do is create the shop they do not have yet (ADR 0044).
 */
const labEntries = [{ label: "Settings", to: "/settings", icon: <Settings size={13} /> }] as const;

const headerLinkClasses =
  "flex items-center gap-1.5 rounded-full border border-white/25 px-2.5 py-1 text-[11px] font-semibold no-underline transition";

interface AppShellProps {
  shops: ShopSummarySchema[];
  currentShopId?: string;
  children: ReactNode;
}

export function AppShell({ shops, currentShopId, children }: AppShellProps) {
  const navigate = useNavigate();
  const current = shops.find((shop) => shop.shop_id === currentShopId);
  // One rail for every section, collapsed only when the author says so. Routes deliberately
  // do not override this: a navigation that folded the menu on its own would make the same
  // control mean different things depending on where you happened to be standing. What the
  // author says is now remembered between visits rather than reset by every reload.
  const [collapsed, setCollapsed] = useState(readNavigationCollapsed);

  function chooseCollapsed(next: boolean) {
    setCollapsed(next);
    writeNavigationCollapsed(next);
  }

  return (
    // The shell owns the viewport and the two panes scroll inside it. With the page doing the
    // scrolling instead, a tall section stretched the rail down the document and parked its
    // bottom control below the fold — the collapse control read as missing on exactly the
    // longest pages, which are the ones most in need of the room.
    <div className="flex h-screen flex-col overflow-hidden bg-admin-canvas text-admin-ink">
      <header className="flex h-13 flex-none items-center gap-3.5 bg-lab-ink px-4 text-lab-paper">
        <NavLink
          to="/shops"
          className="flex items-center gap-2 font-display text-[15px] font-bold text-white no-underline"
        >
          Agent Framework Lab
        </NavLink>
        {shops.length > 0 ? (
          <label className="flex items-center gap-2 text-xs">
            <span className="sr-only">Shop</span>
            <select
              aria-label="Shop"
              className="h-8 rounded-lg border border-white/20 bg-white/10 px-2.5 text-[12.5px] font-semibold text-white outline-none"
              value={current?.shop_id ?? ""}
              onChange={(event) => navigate(`/shops/${event.target.value}`)}
            >
              {!current && <option value="">Select a shop</option>}
              {shops.map((shop) => (
                <option key={shop.shop_id} value={shop.shop_id} className="text-admin-ink">
                  {shop.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <nav aria-label="Lab" className="ml-auto flex items-center gap-2">
          {labEntries.map((entry) => (
            <NavLink
              key={entry.label}
              to={entry.to}
              className={({ isActive }) =>
                isActive
                  ? `${headerLinkClasses} border-white/50 bg-white/15 text-white`
                  : `${headerLinkClasses} text-[#b9cdc5] hover:bg-white/10 hover:text-white`
              }
            >
              {entry.icon}
              {entry.label}
            </NavLink>
          ))}
        </nav>
      </header>

      <div className="flex min-h-0 flex-1">
        {currentShopId ? (
          <nav
            aria-label="Shop workspace"
            // 216px expanded, a 52px strip collapsed (handoff, *Navigation rail*). The strip's
            // 8px gutters leave exactly the 36px a centred 19px glyph is drawn in.
            className={`flex flex-none flex-col border-r border-admin-border bg-admin-sidebar ${
              collapsed ? "w-[52px]" : "w-[216px]"
            }`}
          >
            {/* Only the sections scroll; the control below them is always on screen. */}
            <div
              className={`grid flex-1 content-start gap-0.5 overflow-y-auto pt-3.5 pb-2.5 ${
                collapsed ? "px-2" : "px-2.5"
              }`}
            >
              {studioSections(currentShopId).map((section) => (
                <div key={section.title ?? "primary"} className="grid gap-0.5">
                  {section.title && !collapsed ? (
                    <div className="px-[11px] pt-[18px] pb-1.5 text-[10.5px] font-bold tracking-[0.07em] text-[#8c9196] uppercase">
                      {section.title}
                    </div>
                  ) : null}
                  {section.title && collapsed ? (
                    <div className="mx-2 mt-[13px] mb-[7px] h-px bg-admin-border" />
                  ) : null}
                  {section.entries.map((entry) => (
                    <div key={entry.label} className="grid gap-0.5">
                      <SidebarEntry entry={entry} collapsed={collapsed} />
                      {entry.children?.map((child) => (
                        <SidebarEntry
                          key={child.label}
                          entry={child}
                          collapsed={collapsed}
                          nested={!collapsed}
                        />
                      ))}
                    </div>
                  ))}
                </div>
              ))}
            </div>
            <div
              className={`flex-none border-t border-admin-border pt-3 pb-2.5 ${
                collapsed ? "px-2" : "px-2.5"
              }`}
            >
              <button
                type="button"
                className={
                  collapsed
                    ? `${collapsedFootClasses} ${footInkClasses}`
                    : `${expandedFootClasses} ${footInkClasses}`
                }
                aria-expanded={!collapsed}
                // Name, copy and tooltip are one string. Collapsed there is no visible text at
                // all, so the name is the only thing anyone has; expanded, a name that read
                // "Collapse navigation" under a face that read "Collapse menu" would leave a
                // voice-control reader saying the words on the button and missing it.
                aria-label={collapsed ? "Expand menu" : "Collapse menu"}
                title={collapsed ? "Expand menu" : "Collapse menu"}
                onClick={() => chooseCollapsed(!collapsed)}
              >
                {collapsed ? <ChevronRight size={15} /> : <ChevronLeft size={15} />}
                {collapsed ? null : <span>Collapse menu</span>}
              </button>
            </div>
          </nav>
        ) : null}

        <main className="min-w-0 flex-1 overflow-y-auto px-6 py-5">{children}</main>
      </div>
    </div>
  );
}
