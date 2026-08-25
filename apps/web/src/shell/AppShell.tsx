import type { ShopSummarySchema } from "@agent-lab/contracts";
import {
  Boxes,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Clock,
  FileText,
  Home,
  MessageSquare,
  Play,
  Settings,
  Shapes,
  Tag,
  Target,
  UserCog,
  Users,
  Zap,
} from "lucide-react";
import { type ReactNode, useState } from "react";
import { NavLink, useNavigate } from "react-router-dom";

interface NavEntry {
  label: string;
  to?: string;
  icon: ReactNode;
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
        { label: "Home", to: base, icon: <Home size={15} />, exact: true },
        { label: "Products", to: `${base}/products`, icon: <Tag size={15} /> },
        { label: "Orders", to: `${base}/orders`, icon: <Boxes size={15} /> },
        { label: "Customers", to: `${base}/customers`, icon: <Users size={15} /> },
        { label: "Tickets", to: `${base}/tickets`, icon: <MessageSquare size={15} /> },
        {
          label: "Scenarios",
          icon: <ClipboardList size={15} />,
          milestone: "Milestone 2",
          children: [
            { label: "All scenarios", icon: <ClipboardList size={15} />, milestone: "Milestone 2" },
            {
              label: "Objective blocks",
              to: `${base}/objective-blocks`,
              icon: <Target size={15} />,
            },
            {
              label: "Mutation blocks",
              to: `${base}/mutation-blocks`,
              icon: <Zap size={15} />,
            },
          ],
        },
      ],
    },
    {
      title: "Shop setup",
      entries: [
        { label: "Policies & FAQ", to: `${base}/setup/policies`, icon: <FileText size={15} /> },
        {
          label: "Support guidelines",
          to: `${base}/setup/support`,
          icon: <ClipboardList size={15} />,
        },
        { label: "Tone of voice", to: `${base}/setup/tone`, icon: <Shapes size={15} /> },
        { label: "Settings", to: `${base}/setup/identity`, icon: <Settings size={15} /> },
      ],
    },
    {
      title: "Experiment lab · cross-shop",
      entries: [
        {
          label: "Support identities",
          to: `${base}/support-identities`,
          icon: <UserCog size={15} />,
        },
        {
          label: "Agent configurations",
          icon: <Shapes size={15} />,
          milestone: "Milestone 3",
        },
        { label: "Bench", icon: <Play size={15} />, milestone: "Milestone 4" },
        { label: "History", icon: <Clock size={15} />, milestone: "Milestone 5" },
      ],
    },
  ];
}

const entryClasses =
  "flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[13px] text-admin-ink-soft transition hover:bg-admin-border/50";

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
  const label = collapsed ? (
    <span className="sr-only">{entry.label}</span>
  ) : (
    <span>{entry.label}</span>
  );
  const layout = collapsed
    ? `${entryClasses} justify-center`
    : nested
      ? `${entryClasses} ml-3.5 border-l border-admin-border pl-3`
      : entryClasses;

  if (!entry.to) {
    return (
      <span
        className={`${layout} cursor-not-allowed opacity-55`}
        title={`Arrives with ${entry.milestone}`}
      >
        {entry.icon}
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
        isActive ? `${layout} bg-[#e8f0ed] font-semibold text-lab-ink` : `${layout} no-underline`
      }
    >
      {entry.icon}
      {label}
    </NavLink>
  );
}

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
  // control mean different things depending on where you happened to be standing.
  const [collapsed, setCollapsed] = useState(false);

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
        <span className="ml-auto rounded-full border border-white/25 px-2.5 py-1 text-[11px] font-semibold text-[#b9cdc5]">
          Synthetic sandbox
        </span>
      </header>

      <div className="flex min-h-0 flex-1">
        {currentShopId ? (
          <nav
            aria-label="Shop workspace"
            className={`flex flex-none flex-col border-r border-admin-border bg-admin-sidebar ${
              collapsed ? "w-[58px]" : "w-[226px]"
            }`}
          >
            {/* Only the sections scroll; the control below them is always on screen. */}
            <div className="grid flex-1 content-start gap-0.5 overflow-y-auto p-2.5">
              {studioSections(currentShopId).map((section) => (
                <div key={section.title ?? "primary"} className="grid gap-0.5">
                  {section.title && !collapsed ? (
                    <div className="px-2.5 pt-3 pb-1 text-[10.5px] font-bold tracking-wider text-admin-muted uppercase">
                      {section.title}
                    </div>
                  ) : null}
                  {section.title && collapsed ? (
                    <div className="mx-2 my-2 h-px bg-admin-border" />
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
            <div className="flex-none border-t border-admin-border p-2.5">
              <button
                type="button"
                className={`${entryClasses} w-full ${collapsed ? "justify-center" : ""}`}
                aria-expanded={!collapsed}
                aria-label={collapsed ? "Expand navigation" : "Collapse navigation"}
                onClick={() => setCollapsed(!collapsed)}
              >
                {collapsed ? <ChevronRight size={15} /> : <ChevronLeft size={15} />}
                {collapsed ? null : <span>Collapse</span>}
              </button>
            </div>
          </nav>
        ) : null}

        <main className="min-w-0 flex-1 overflow-y-auto px-6 py-5">{children}</main>
      </div>
    </div>
  );
}
