import type { ShopSummarySchema } from "@agent-lab/contracts";
import { ArrowLeft, Check, ChevronsUpDown } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { focusRingClasses, topBarFocusRingClasses } from "../lib/ui";

/**
 * The shop the operator is standing in, and the way to another one.
 *
 * A button opening a `menu`, not a `<select>` (ADR 0055). The panel holds three kinds of row —
 * the current shop with a check, the other shops with a badge and a version, and an *All shops*
 * row that is not a shop at all — and a select can hold the third only as an option whose choice
 * navigates, which is an option that lies about what it is. It also cannot carry the badge, and
 * a select styled until it could would be the new UI dependency the plan refuses.
 *
 * What choosing a shop *means* is ADR 0054's and is not this component's: in shop mode it
 * navigates to that shop, in lab mode it sets the lab's current shop and stays put. This takes
 * the decision as a callback and knows neither.
 */

/** The badge until Slice 28 gives a shop a logo: the first letters of its first two words. */
function shopInitials(name: string): string {
  return name
    .split(" ")
    .slice(0, 2)
    .map((word) => word.charAt(0))
    .join("")
    .toUpperCase();
}

/** What a shop is at, for the reader choosing between them: its latest published version. */
function versionLabel(shop: ShopSummarySchema): string {
  return shop.latest_published_version === null ? "Draft" : `v${shop.latest_published_version}`;
}

/**
 * The initials block, on `lab-ink` in both places it is drawn — 30px in the bar, 26px in the
 * panel. Hidden from a reader: the shop's name is beside it in both, and a badge that announced
 * itself would say the name twice, once spelled out and once as two letters.
 */
function ShopBadge({ name, size }: { name: string; size: 30 | 26 }) {
  const metrics =
    size === 30
      ? "h-[30px] w-[30px] rounded-lg text-[11.5px]"
      : "h-[26px] w-[26px] rounded-[7px] text-[10.5px]";
  return (
    <span
      aria-hidden="true"
      className={`flex flex-none items-center justify-center bg-lab-ink font-bold tracking-[0.02em] text-white ${metrics}`}
    >
      {shopInitials(name)}
    </span>
  );
}

const rowBaseClasses = `flex w-full items-center gap-2.5 rounded-[9px] px-3 py-[9px] text-left text-sm ${focusRingClasses}`;

interface ShopSwitcherProps {
  shops: ShopSummarySchema[];
  current: ShopSummarySchema | null;
  /** What choosing a shop does here. The lab passes its own; shop mode navigates. */
  onChoose: (shopId: string) => void;
}

export function ShopSwitcher({ shops, current, onChoose }: ShopSwitcherProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const panelId = useId();
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const wrapper = useRef<HTMLDivElement | null>(null);
  const button = useRef<HTMLButtonElement | null>(null);
  const items = useRef<(HTMLButtonElement | null)[]>([]);

  // Every row, in the order the panel draws them, so the roving focus below counts one list
  // rather than a list of shops and a special case after it.
  const rowCount = shops.length + 1;

  const close = useCallback((restoreFocus: boolean) => {
    setOpen(false);
    if (restoreFocus) {
      button.current?.focus();
    }
  }, []);

  // A navigation dismisses it — including the navigation that choosing a shop causes in shop
  // mode, so nothing has to remember to close it on the way out.
  const here = `${location.pathname}${location.search}`;
  // biome-ignore lint/correctness/useExhaustiveDependencies: the location is the trigger
  useEffect(() => setOpen(false), [here]);

  // A press outside it dismisses it, without taking focus anywhere the reader did not aim.
  useEffect(() => {
    if (!open) {
      return;
    }
    function onPointerDown(event: MouseEvent) {
      if (!wrapper.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open]);

  // Roving focus: exactly one row is in the tab order and the arrows move it, so a reader
  // arrives on the shop they are in rather than at the top of a list they have to count down.
  useEffect(() => {
    if (open) {
      items.current[activeIndex]?.focus();
    }
  }, [open, activeIndex]);

  function openPanel() {
    const currentIndex = shops.findIndex((shop) => shop.shop_id === current?.shop_id);
    setActiveIndex(currentIndex < 0 ? 0 : currentIndex);
    setOpen(true);
  }

  function onKeyDown(event: React.KeyboardEvent) {
    if (event.key === "Escape") {
      event.preventDefault();
      close(true);
      return;
    }
    if (event.key === "Tab") {
      // Tab leaves the panel, and it leaves it the way `Escape` does: closed, with the keyboard
      // back on the button. The default is prevented rather than allowed to run on, because
      // the panel is rendered immediately after the button — so "the next element in the tab
      // sequence" is a row of the panel that this very press is unmounting, and where a
      // browser resumes from a removed node is its own business: some keep a starting point at
      // the node's old position, others fall back to the top of the document. Returning to the
      // button costs a forward Tab one extra press and answers the question here rather than
      // per engine. Shift+Tab is unaffected: the button is where it was going anyway.
      event.preventDefault();
      close(true);
      return;
    }
    const move = { ArrowDown: 1, ArrowUp: -1 }[event.key];
    if (move !== undefined) {
      event.preventDefault();
      setActiveIndex((index) => (index + move + rowCount) % rowCount);
      return;
    }
    if (event.key === "Home") {
      event.preventDefault();
      setActiveIndex(0);
    }
    if (event.key === "End") {
      event.preventDefault();
      setActiveIndex(rowCount - 1);
    }
  }

  function choose(shop: ShopSummarySchema) {
    close(false);
    if (shop.shop_id !== current?.shop_id) {
      onChoose(shop.shop_id);
    }
  }

  const name = current?.name ?? "Select a shop";

  return (
    <div
      ref={wrapper}
      className="relative flex items-center border-r border-white/[0.14] py-2 pr-4 pl-3.5"
    >
      <button
        ref={button}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        // The verb first, because a button named only after the shop says what it is showing
        // rather than what pressing it does; the shop last, because that is the fact a reader
        // arriving in the bar wants from it.
        aria-label={current ? `Switch shop, current: ${current.name}` : "Switch shop"}
        title="Switch shop"
        // The button is on the bar and the rows below are on the panel's white, so the two
        // take different rings: pine is invisible on the forest ground (ADR 0055).
        className={`flex items-center gap-[11px] rounded-[9px] py-[5px] pr-[9px] pl-[5px] transition hover:bg-white/[0.08] ${topBarFocusRingClasses}`}
        onClick={() => (open ? close(false) : openPanel())}
        // Enter and Space arrive as a click; the down arrow is the menu-button convention and
        // is the one key the button has to answer itself.
        onKeyDown={(event) => {
          if (!open && event.key === "ArrowDown") {
            event.preventDefault();
            openPanel();
          }
        }}
      >
        {current ? <ShopBadge name={current.name} size={30} /> : null}
        <span className="font-display text-base font-bold tracking-[-0.01em] whitespace-nowrap text-white">
          {name}
        </span>
        <ChevronsUpDown
          aria-hidden="true"
          focusable="false"
          size={14}
          className="ml-0.5 flex-none text-lab-bar-soft"
        />
      </button>

      {open ? (
        <div
          id={panelId}
          role="menu"
          aria-label="Shops"
          aria-orientation="vertical"
          onKeyDown={onKeyDown}
          className="absolute top-[52px] left-3.5 z-10 w-[300px] rounded-[13px] border border-admin-border bg-white p-[7px] text-[#16332d] shadow-[0_14px_34px_rgb(12_30_25_/_22%)]"
        >
          <div className="px-3 pt-[11px] pb-[7px] text-[10.5px] font-bold tracking-[0.09em] text-admin-muted uppercase">
            Current shop
          </div>
          {shops.map((shop, index) => {
            const isCurrent = shop.shop_id === current?.shop_id;
            return (
              <button
                key={shop.shop_id}
                ref={(node) => {
                  items.current[index] = node;
                }}
                type="button"
                role="menuitem"
                tabIndex={activeIndex === index ? 0 : -1}
                aria-current={isCurrent ? "true" : undefined}
                className={
                  isCurrent
                    ? `${rowBaseClasses} font-[650]`
                    : `${rowBaseClasses} text-admin-ink-soft hover:bg-[#f4f6f7]`
                }
                onClick={() => choose(shop)}
                onFocus={() => setActiveIndex(index)}
              >
                <ShopBadge name={shop.name} size={26} />
                <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">
                  {shop.name}
                </span>
                {isCurrent ? (
                  <>
                    {/* The word carries it; the check is the second signal, never the only one. */}
                    <span className="sr-only">, current shop</span>
                    <Check
                      aria-hidden="true"
                      focusable="false"
                      size={15}
                      className="ml-auto flex-none"
                    />
                  </>
                ) : (
                  <span className="ml-auto flex-none text-[11.5px] font-[650] whitespace-nowrap text-admin-muted">
                    {versionLabel(shop)}
                  </span>
                )}
              </button>
            );
          })}
          <div className="mx-1.5 my-1.5 h-px bg-[#eceef0]" />
          <button
            ref={(node) => {
              items.current[shops.length] = node;
            }}
            type="button"
            role="menuitem"
            tabIndex={activeIndex === shops.length ? 0 : -1}
            className={`${rowBaseClasses} bg-[#eaf3ee] py-2.5 font-[650] text-[#1d5b43] hover:bg-[#e0eee7]`}
            onClick={() => {
              close(false);
              navigate("/shops");
            }}
            onFocus={() => setActiveIndex(shops.length)}
          >
            <ArrowLeft aria-hidden="true" focusable="false" size={16} className="flex-none" />
            All shops
          </button>
        </div>
      ) : null}
    </div>
  );
}
