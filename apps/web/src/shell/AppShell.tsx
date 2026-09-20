import type { ShopSummarySchema } from "@agent-lab/contracts";
import {
  Bot,
  Boxes,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Clock,
  FileText,
  FlaskConical,
  Home,
  type LucideIcon,
  MessageSquare,
  Play,
  Scale,
  Shapes,
  SlidersHorizontal,
  Store,
  Tag,
  Target,
  UserCog,
  Users,
  X,
  Zap,
} from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { TourLaunch } from "../components/TourLaunch";
import {
  readNavigationCollapsed,
  readSettingsReturn,
  writeNavigationCollapsed,
  writeSettingsReturn,
} from "../lib/preferences";
import {
  activeModeTabClasses,
  focusRingClasses,
  inactiveModeTabClasses,
  topBarControlClasses,
  topBarControlLitClasses,
  topBarInsetFocusRingClasses,
} from "../lib/ui";
import { ShopSwitcher } from "./ShopSwitcher";

interface NavEntry {
  label: string;
  to?: string;
  /**
   * The glyph, not a rendered element: the rail draws it at 17px expanded and 19px collapsed
   * (handoff, *Navigation rail*), so the size belongs to the row and not to this table.
   */
  icon: LucideIcon;
  /**
   * Match the path exactly instead of by prefix. Only Overview and the bench need it: every
   * other section owns nested editor routes and must stay highlighted while one is open, and
   * the bench's own nest is `/lab/bench/:shopId/:experimentId`, which is a live run rather
   * than the composition screen the entry points at.
   */
  exact?: boolean;
  /** Sections whose slice has not landed yet stay visible but inert. */
  milestone?: string;
}

interface NavSection {
  title?: string;
  entries: NavEntry[];
}

/**
 * The shop's rail, from the prototype at `Workspace.dc.html` :4753.
 *
 * Ten entries and one heading. The cross-shop section this rail used to end in is the lab's
 * rail now (ADR 0054) — a section that had to announce that its contents were not what the
 * rail was about was a section in the wrong rail. The two block libraries went with it, out of
 * the Scenarios nest they sat in, so nothing here nests any more.
 *
 * *Support identities* is the one entry that leaves shop scope. There is one library and the
 * prototype draws it on both rails, so both rails point at the one address and following this
 * entry changes mode.
 */
function shopSections(shopId: string): NavSection[] {
  const base = `/shops/${shopId}`;
  return [
    {
      entries: [
        { label: "Overview", to: base, icon: Home, exact: true },
        { label: "Products", to: `${base}/products`, icon: Tag },
        { label: "Orders", to: `${base}/orders`, icon: Boxes },
        { label: "Customers", to: `${base}/customers`, icon: Users },
        { label: "Tickets", to: `${base}/tickets`, icon: MessageSquare },
        { label: "Scenarios", to: `${base}/scenarios`, icon: ClipboardList },
      ],
    },
    {
      title: "Shop setup",
      entries: [
        { label: "Policies & FAQ", to: `${base}/setup/policies`, icon: FileText },
        { label: "Support identities", to: "/lab/support-identities", icon: UserCog },
        { label: "Tone of voice", to: `${base}/setup/tone`, icon: Shapes },
        { label: "Shop details", to: `${base}/setup/identity`, icon: Store },
      ],
    },
  ];
}

/**
 * The lab's rail, from the prototype at `Workspace.dc.html` :4822.
 *
 * Bench and History, and then everything shared by every shop in this lab under *Library*.
 * None of it takes a shop, which is why none of these paths carries one (ADR 0054).
 */
function labSections(): NavSection[] {
  return [
    {
      entries: [
        { label: "Bench", to: "/lab/bench", icon: Play, exact: true },
        { label: "History", to: "/lab/history", icon: Clock },
      ],
    },
    {
      title: "Library",
      entries: [
        { label: "Agent configurations", to: "/lab/agent-configurations", icon: Bot },
        { label: "Judges", to: "/lab/judges", icon: Scale },
        { label: "Support identities", to: "/lab/support-identities", icon: UserCog },
        { label: "Objective blocks", to: "/lab/objective-blocks", icon: Target },
        { label: "Mutation blocks", to: "/lab/mutation-blocks", icon: Zap },
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

function SidebarEntry({ entry, collapsed }: { entry: NavEntry; collapsed: boolean }) {
  const Icon = entry.icon;
  // The label is never dropped, only hidden: a destination the collapsed rail cannot name is a
  // destination a screen reader cannot reach, and `title` alone is not an accessible name.
  const label = collapsed ? (
    <span className="sr-only">{entry.label}</span>
  ) : (
    <span>{entry.label}</span>
  );
  // Hidden from assistive technology, as every other glyph in this workspace is: the row is
  // named by its label, and a drawing that announced itself would rename every row.
  const glyph = (
    <Icon aria-hidden="true" className="flex-none" focusable="false" size={collapsed ? 19 : 17} />
  );
  const layout = collapsed ? collapsedEntryClasses : expandedEntryClasses;
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
 * Which of the two modes is being drawn, or neither (ADR 0054).
 *
 * `undefined` is the frameless case — the shops index, Settings and the glossary — and it is a
 * different answer from "the lab, with no current shop": the first draws no rail and no mode
 * tabs, the second draws the lab's rail and says on the surface that it has no shop.
 */
export type WorkspaceMode = "shop" | "lab";

interface AppShellProps {
  shops: ShopSummarySchema[];
  currentShopId?: string;
  mode?: WorkspaceMode;
  /**
   * What choosing a shop in the switcher means here. In shop mode it navigates, which is the
   * default; the lab passes its own, because there is nowhere in the lab to navigate a shop to
   * and what the choice actually changes is which shop the lab composes for.
   */
  onShopChange?: (shopId: string) => void;
  children: ReactNode;
}

export function AppShell({ shops, currentShopId, mode, onShopChange, children }: AppShellProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const current = shops.find((shop) => shop.shop_id === currentShopId) ?? null;
  const sections =
    mode === "lab" ? labSections() : currentShopId ? shopSections(currentShopId) : null;
  // One rail for every section, collapsed only when the author says so. Routes deliberately
  // do not override this: a navigation that folded the menu on its own would make the same
  // control mean different things depending on where you happened to be standing. What the
  // author says is now remembered between visits rather than reset by every reload.
  const [collapsed, setCollapsed] = useState(readNavigationCollapsed);

  function chooseCollapsed(next: boolean) {
    setCollapsed(next);
    writeNavigationCollapsed(next);
  }

  // What the Settings toggle returns to: the last location that was not Settings, recorded on
  // every navigation so that a reload of the settings page — the one case `history.back()`
  // cannot answer — still knows what was underneath (ADR 0055). Path, query and fragment
  // together, because history's narrowing lives in the URL (ADR 0033).
  const atSettings = location.pathname === "/settings";
  const here = `${location.pathname}${location.search}${location.hash}`;
  useEffect(() => {
    if (!atSettings) {
      writeSettingsReturn(here);
    }
  }, [atSettings, here]);

  // The identity at the left of the bar is one or the other, never both: the prototype draws
  // the title on the shops index and the switcher everywhere else, and the README is silent on
  // where the title goes when the switcher is there (Authority rule 2). The one case the
  // prototype has not got is a lab with no shops at all, where there is no switcher to draw.
  const switcher = mode !== undefined && shops.length > 0;

  return (
    // The shell owns the viewport and the two panes scroll inside it. With the page doing the
    // scrolling instead, a tall section stretched the rail down the document and parked its
    // bottom control below the fold — the collapse control read as missing on exactly the
    // longest pages, which are the ones most in need of the room.
    <div className="flex h-screen flex-col overflow-hidden bg-admin-canvas text-admin-ink">
      {/* 56px on the bar's own ground, which is the README's height and the README's colour
          (ADR 0055). `items-stretch`, because the mode tabs carry their underline along the
          bar's bottom edge rather than under their own words. */}
      <header className="relative z-20 flex h-14 flex-none items-stretch bg-lab-bar pr-[18px] text-lab-paper">
        {switcher ? (
          <ShopSwitcher
            shops={shops}
            current={current}
            // In shop mode the choice navigates; the lab passes its own, because there is
            // nowhere in the lab to navigate a shop to (ADR 0054).
            onChoose={(shopId) =>
              onShopChange ? onShopChange(shopId) : navigate(`/shops/${shopId}`)
            }
          />
        ) : (
          <NavLink
            to="/shops"
            title="All shops"
            className={`flex items-center pr-5 pl-[18px] font-display text-[15px] font-bold tracking-[-0.01em] text-white no-underline transition hover:text-lab-bar-soft ${topBarInsetFocusRingClasses}`}
          >
            Agent Framework Lab
          </NavLink>
        )}

        {mode ? (
          <nav aria-label="Workspace mode" className="flex items-stretch gap-[26px] px-6">
            {(
              [
                // With no current shop, *Shop fixture* can only offer the index — there is no
                // shop to return to, and a tab that went nowhere would be worse than one that
                // says pick.
                ["Shop fixture", current ? `/shops/${current.shop_id}` : "/shops", Store, "shop"],
                ["Experiment lab", "/lab/bench", FlaskConical, "lab"],
              ] as const
            ).map(([label, to, Glyph, forMode]) => (
              <NavLink
                key={label}
                to={to}
                aria-current={mode === forMode ? "page" : undefined}
                className={mode === forMode ? activeModeTabClasses : inactiveModeTabClasses}
              >
                <Glyph
                  size={17}
                  aria-hidden="true"
                  focusable="false"
                  className={mode === forMode ? "opacity-95" : "opacity-80"}
                />
                {label}
              </NavLink>
            ))}
          </nav>
        ) : null}

        {/* The prototype separates the two by 14px and 4px (`Workspace.dc.html` :88, :94). */}
        <div className="ml-auto flex items-center gap-[18px]">
          {/* One mount for the whole application. Which tour it offers — and whether there is
              one to offer at all — it reads from the route (ADR 0055). */}
          <TourLaunch />
          {atSettings ? (
            <button
              type="button"
              title="Back to workspace"
              // The visible word first, so a reader saying what is on the button still reaches
              // it, and the consequence the close glyph draws after it.
              aria-label="Settings, back to workspace"
              className={topBarControlLitClasses}
              onClick={() => navigate(readSettingsReturn() ?? "/shops")}
            >
              <SlidersHorizontal size={17} aria-hidden="true" focusable="false" />
              Settings
              <X size={13} aria-hidden="true" focusable="false" className="opacity-70" />
            </button>
          ) : (
            <NavLink to="/settings" title="Workspace settings" className={topBarControlClasses}>
              <SlidersHorizontal size={17} aria-hidden="true" focusable="false" />
              Settings
            </NavLink>
          )}
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {sections ? (
          <nav
            aria-label={mode === "lab" ? "Experiment lab workspace" : "Shop workspace"}
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
              {sections.map((section) => (
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
                    <SidebarEntry key={entry.label} entry={entry} collapsed={collapsed} />
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
