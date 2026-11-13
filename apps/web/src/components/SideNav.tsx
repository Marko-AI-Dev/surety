import { CircleHelp, FileText, FlaskConical, History, Landmark, LayoutDashboard, type LucideIcon, MessageSquare, Moon, PlayCircle, ShieldCheck, ShoppingBag, SlidersHorizontal, Smartphone, Sun, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";

// The menu down the left side on a wide screen, for the buyer's screen and for the admin. Related
// items sit together under a label, and each has an icon so it can be found at a glance. On a narrow
// screen it is hidden and the bar across the top takes over.

export type SideSection = "buyer" | "admin";
// What the buyer's menu can ask the chat to open. The chat listens for it.
export type PanelName = "settings" | "limits" | "quick";
export const OPEN_PANEL = "surety:open-panel";
export const openPanel = (name: PanelName) => window.dispatchEvent(new CustomEvent<PanelName>(OPEN_PANEL, { detail: name }));

interface Item {
  label: string;
  icon: LucideIcon;
  href?: string;
  panel?: PanelName;
  // The admin tab this item is, to mark the current page.
  tab?: string;
}

const BUYER: { label: string; items: Item[] }[] = [
  {
    label: "Buying",
    items: [
      { label: "Your agent", icon: MessageSquare, href: "#/", tab: "desk" },
      { label: "My purchases", icon: ShoppingBag, href: "#/purchases", tab: "purchases" },
    ],
  },
  {
    label: "Control",
    items: [
      { label: "Negotiator settings", icon: SlidersHorizontal, panel: "settings" },
      { label: "Suppliers and limits", icon: ShieldCheck, panel: "limits" },
    ],
  },
  {
    label: "Admin",
    items: [
      { label: "Admin portal", icon: LayoutDashboard, href: "#/admin" },
      { label: "Escrow ledger", icon: Landmark, href: "#/admin/ledger" },
    ],
  },
];

const ADMIN: { label: string; items: Item[] }[] = [
  {
    label: "Records",
    items: [
      { label: "What happened", icon: FileText, href: "#/admin", tab: "log" },
      { label: "Escrow ledger", icon: Landmark, href: "#/admin/ledger", tab: "ledger" },
      { label: "Ask the records", icon: CircleHelp, href: "#/admin/ask", tab: "ask" },
    ],
  },
  { label: "Controls", items: [{ label: "Control room", icon: LayoutDashboard, href: "#/admin/control", tab: "control" }] },
  {
    label: "Testing",
    items: [
      { label: "Attack lab", icon: TriangleAlert, href: "#/admin/attacks", tab: "attacks" },
      { label: "Supplier seat", icon: Smartphone, href: "#/admin/seat", tab: "seat" },
      { label: "Recordings and display", icon: PlayCircle, href: "#/admin/display", tab: "display" },
      { label: "Classic view", icon: History, href: "#/admin/classic", tab: "classic" },
    ],
  },
];

const row = "flex min-h-11 w-full cursor-pointer items-center gap-2.5 rounded-xl border-0 bg-transparent px-3 text-left text-sm font-medium text-foreground no-underline hover:bg-background";

export function SideNav({ section, current, dark, onTheme, onHelp }: { section: SideSection; current: string; dark: boolean; onTheme: () => void; onHelp: () => void }) {
  const groups = section === "buyer" ? BUYER : ADMIN;
  return (
    <aside className="tw glass side-nav fixed top-4 bottom-4 left-4 z-20 hidden w-60 flex-col lg:flex gap-5 overflow-y-auto rounded-2xl p-3 text-foreground" aria-label={section === "buyer" ? "Menu" : "Admin menu"}>
      <a href="#/" className="flex items-baseline gap-2 px-3 pt-2 text-lg font-semibold tracking-tight text-foreground no-underline">
        Surety {section === "admin" ? <span className="text-xs font-normal text-muted-foreground">Admin</span> : null}
      </a>
      {groups.map((g) => (
        <div key={g.label} className="flex flex-col gap-1">
          <span className="px-3 pb-1 text-[0.6875rem] font-semibold tracking-wider text-muted-foreground uppercase">{g.label}</span>
          {g.items.map((item) => {
            const Icon = item.icon;
            const here = item.tab !== undefined && item.tab === current;
            const inner = (
              <>
                <Icon className="size-[1.125rem] shrink-0" aria-hidden="true" />
                {item.label}
              </>
            );
            return item.href ? (
              <a key={item.label} href={item.href} aria-current={here ? "page" : undefined} className={cn(row, here && "bg-primary text-primary-foreground hover:bg-primary")}>
                {inner}
              </a>
            ) : (
              <button key={item.label} type="button" className={row} onClick={() => item.panel && openPanel(item.panel)}>
                {inner}
              </button>
            );
          })}
        </div>
      ))}
      <span className="flex-1" />
      <div className="flex flex-col gap-1">
        {section === "admin" ? (
          <a href="#/" className={cn(row, "border border-solid border-border")}>
            <MessageSquare className="size-[1.125rem] shrink-0" aria-hidden="true" />
            Back to my purchase
          </a>
        ) : null}
        <button type="button" className={row} onClick={onHelp}>
          <FlaskConical className="size-[1.125rem] shrink-0" aria-hidden="true" />
          How it works
        </button>
        <button type="button" className={row} onClick={onTheme} aria-pressed={dark}>
          {dark ? <Sun className="size-[1.125rem] shrink-0" aria-hidden="true" /> : <Moon className="size-[1.125rem] shrink-0" aria-hidden="true" />}
          {dark ? "Light" : "Dark"}
        </button>
        <p className="m-0 rounded-xl border border-solid border-held/50 px-3 py-2 text-xs leading-snug text-held">Test network. No real money.</p>
      </div>
    </aside>
  );
}
