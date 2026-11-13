import { useEffect, useState } from "react";
import { dealStages } from "./data/buyer";
import { RECORDINGS, recordingOf } from "./data/evidence";
import { GLOSSARY, HOW_IT_WORKS, statusLine } from "./data/plain";
import { type Mode, useRun } from "./run";
import { ADMIN_TABS, AdminNav, type AdminTab, AskAdmin, Display } from "./views/Admin";
import { AttackLab } from "./views/AttackLab";
import { Stages } from "./views/Business";
import { Control } from "./views/Control";
import { SideNav } from "./components/SideNav";
import { Audit } from "./views/Audit";
import { Chat } from "./views/Chat";
import { HowSurety } from "./views/HowSurety";
import { Ledger } from "./views/Ledger";
import { Purchases } from "./views/Purchases";
import { Desk } from "./views/Desk";
import { Inspector } from "./views/Inspector";
import { MoneyRail } from "./views/MoneyRail";
import { ReplayBar } from "./views/ReplayBar";
import { Detail, useFlat } from "./views/Spatial";
import { type SeatMode, Supplier } from "./views/Supplier";
import { More, Waiting } from "./views/bits";

// Two places, and two phone pages. "My purchase" is the whole product for the buyer. "Admin" holds the
// log, the assistant and the technical views. The supplier's and the inspector's phone pages keep
// their own links and are not in the menu.
type Route = "desk" | "admin" | "supplier" | "inspector";
interface Place {
  route: Route;
  tab: AdminTab;
  token: string | null;
  // The buyer's side has two pages: the chat and the list of purchases.
  page: "chat" | "purchases";
  // An earlier purchase to show in the chat; null shows the newest.
  purchase: string | null;
}
const PURCHASE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Older links (#/control, #/attack) still land in the right admin tab.
const OLD: Record<string, AdminTab> = { "/control": "control", "/attack": "attacks" };

export function parseHash(hash: string): Place {
  const [path = "", query = ""] = hash.replace(/^#/, "").split("?");
  const params = new URLSearchParams(query);
  const token = params.get("t");
  const base = { tab: "log" as AdminTab, page: "chat" as const, purchase: null };
  if (path === "/supplier") return { ...base, route: "supplier", token };
  if (path === "/inspector") return { ...base, route: "inspector", token };
  const old = OLD[path];
  if (old) return { ...base, route: "admin", tab: old, token: null };
  const tab = ADMIN_TABS.find((t) => t.hash === `#${path}`);
  if (tab) return { ...base, route: "admin", tab: tab.id, token: null };
  if (path === "/purchases") return { ...base, route: "desk", page: "purchases", token: null };
  const p = params.get("p");
  return { ...base, route: "desk", token: null, purchase: p && PURCHASE_ID.test(p) ? p : null };
}

// The page's own query: ?mode=recorded opens on the recorded run; ?sim=6 feeds a recorded run through
// the live path at six times speed, for testing without a backend.
function startup(): { mode: Mode; sim: number | null } {
  const q = new URLSearchParams(location.search);
  const sim = q.has("sim") ? Math.min(60, Math.max(1, Number(q.get("sim")) || 6)) : null;
  return { mode: q.get("mode") === "recorded" ? "replay" : "live", sim };
}

// Light is the default whatever the device prefers; dark is a choice, remembered on this device.
type Theme = "light" | "dark";
const THEME_KEY = "surety.theme";
function storedTheme(): Theme {
  try {
    return localStorage.getItem(THEME_KEY) === "dark" ? "dark" : "light";
  } catch {
    return "light";
  }
}

export function App() {
  const [{ route, tab, page, purchase }, setPlace] = useState(() => parseHash(location.hash));
  // A supplier's or the inspector's token arrives after the # and is kept in memory only. It is removed
  // from the address bar at once, so it is not left in history, and it is never written to storage.
  const [supplierToken, setSupplierToken] = useState<string | null>(null);
  const [inspectorToken, setInspectorToken] = useState<string | null>(null);
  const [boot] = useState(startup);
  const [mode, setMode] = useState<Mode>(boot.mode);
  // True once a person has picked a mode: after that the app never switches by itself.
  const [chose, setChose] = useState(boot.mode === "replay");
  const [fellBack, setFellBack] = useState(false);
  const [theme, setTheme] = useState<Theme>(storedTheme);
  const [seatMode, setSeatMode] = useState<SeatMode>("practice");
  // Flat: every pane on the page at once. The default; the control room's 3D arc is a choice.
  const [userFlat, setUserFlat] = useState(true);
  const [help, setHelp] = useState(false);
  const [recording, setRecording] = useState("paid");
  const flatWhy = useFlat(userFlat);
  const flat = flatWhy !== null;
  const run = useRun(mode, boot.sim, recording, purchase);
  const tape = recordingOf(recording);

  useEffect(() => {
    const read = () => {
      const next = parseHash(location.hash);
      if (next.token && next.route === "supplier") {
        setSupplierToken(next.token);
        setSeatMode("live");
      }
      if (next.token && next.route === "inspector") setInspectorToken(next.token);
      if (next.token) history.replaceState(null, "", `${location.pathname}${location.search}#/${next.route}`);
      setPlace((cur) => {
        if (cur.route !== next.route || cur.tab !== next.tab || cur.page !== next.page) scrollTo(0, 0);
        return { ...next, token: null };
      });
    };
    read();
    addEventListener("hashchange", read);
    return () => removeEventListener("hashchange", read);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.dataset.flat = String(flat);
    // Solid panels only for the reduced-motion setting; the flat layout keeps its glass.
    document.documentElement.dataset.solid = String(flatWhy === "motion");
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {
      // Private windows can refuse storage; the choice then lasts for this visit.
    }
  }, [theme, flat, flatWhy]);

  // With no backend to talk to (a static copy of the site, or the API not started), show the recorded
  // run and say so. Only before a person has chosen, and only if live never connected.
  const liveDown = mode === "live" && run.live?.status === "error" && !run.live.everConnected;
  useEffect(() => {
    if (liveDown && !chose) {
      setMode("replay");
      setFellBack(true);
    }
  }, [liveDown, chose]);

  const pick = (m: Mode) => {
    setChose(true);
    setFellBack(false);
    setMode(m);
  };

  const { record, view, replay } = run;
  const current = replay && view ? (view.trail[view.trail.length - 1] ?? null) : null;
  const phonePage = route === "supplier" || route === "inspector";
  const simulated = mode === "live" && run.live?.simulated === true;
  const liveOk = mode === "live" && run.live?.status === "ok" && !simulated;
  const status = record && view ? statusLine(record, view) : null;
  const control = route === "admin" && tab === "control";
  // Where a recording plays, it can be scrubbed.
  const scrub = replay && (route === "desk" || (route === "admin" && (tab === "log" || tab === "control")));

  return (
    <div className="app" data-route={route === "admin" && tab === "attacks" ? "attack" : route} data-shell={phonePage ? undefined : "side"}>
      {phonePage ? null : <SideNav section={route === "admin" ? "admin" : "buyer"} current={route === "admin" ? tab : page === "purchases" ? "purchases" : "desk"} dark={theme === "dark"} onTheme={() => setTheme((t) => (t === "light" ? "dark" : "light"))} onHelp={() => setHelp(true)} />}
      <header className="top glass">
        <a className="brand" href="#/">
          Surety
        </a>
        <p className="testnet">
          <span className="nav-full">Test network. No real money.</span>
          <span className="nav-short">Test, no real money</span>
        </p>
        {phonePage ? null : (
          <nav aria-label="Views">
            <a href="#/" aria-current={route === "desk" ? "page" : undefined}>
              My purchase
            </a>
            <a href="#/admin" aria-current={route === "admin" ? "page" : undefined}>
              Admin
            </a>
          </nav>
        )}
        <div className="top-tools">
          <button type="button" className="btn" onClick={() => setHelp(true)}>
            How it works
          </button>
          <button type="button" className="btn" onClick={() => setTheme((t) => (t === "light" ? "dark" : "light"))} aria-pressed={theme === "dark"}>
            Dark
          </button>
        </div>
      </header>

      {/* Say so whenever this is not the live purchase. Live itself needs no label. */}
      {phonePage || (route === "admin" && tab === "attacks") ? null : mode === "replay" ? (
        <p className="source-banner" data-tone="plain">
          <span className="badge" data-kind="recorded">
            Recorded
          </span>
          <span title={`Every message, amount and transaction comes from ${tape.file}`}>
            {fellBack ? "The live backend is not reachable, so this is a recording of " : "This is a recording of "}a real test purchase made by AI agents on {tape.date}. You can watch it, not change it.
          </span>
        </p>
      ) : simulated ? (
        <p className="source-banner" data-tone="plain">
          <span className="badge" data-kind="simulated">
            Simulated feed
          </span>
          <span>A recorded run played through the live screen for testing. This is not live.</span>
        </p>
      ) : run.live?.status === "error" ? (
        <p className="source-banner" data-tone="stop">
          <span>
            {run.live.everConnected ? "Lost the connection to the Surety backend. Showing the last state it sent. " : "Cannot reach the Surety backend. "}
            {run.live.message}
          </span>
        </p>
      ) : null}

      {route === "admin" ? <AdminNav tab={tab} /> : null}

      {control && record && view && status ? (
        <section className="dealbar glass" aria-label="Where the money is, and where the deal stands">
          <p className="now" data-tone={status.tone} aria-live="polite">
            <strong>{status.now}</strong> <span>{status.detail}</span>
          </p>
          <MoneyRail record={record} view={view} />
          <Stages stages={dealStages(record, view)} />
        </section>
      ) : null}

      <main>
        {route === "supplier" ? (
          <Supplier record={mode === "replay" ? record : null} view={mode === "replay" ? view : null} token={supplierToken} mode={seatMode} setMode={setSeatMode} />
        ) : route === "inspector" ? (
          <Inspector token={inspectorToken} />
        ) : route === "desk" && page === "purchases" ? (
          <Purchases purchases={run.purchases} showing={purchase} live={liveOk} recording={recording} onRecording={setRecording} />
        ) : route === "desk" ? (
          mode === "live" && run.live?.status === "connecting" && !record ? (
            <Waiting>{simulated ? "The simulated purchase is about to open." : "Connecting to the Surety backend."}</Waiting>
          ) : (
            <Chat record={record} view={view} canAct={liveOk} now={liveOk || !view || !Number.isFinite(view.t) ? Date.now() : view.t} earlier={liveOk && record !== null && run.purchases[0] !== undefined && run.purchases[0].id !== record.sourcing.id} />
          )
        ) : tab === "how" ? (
          <HowSurety />
        ) : tab === "ledger" ? (
          <Ledger purchases={run.purchases} live={liveOk} />
        ) : tab === "classic" ? (
          <Desk record={record} view={view} canAct={liveOk} now={liveOk || !view || !Number.isFinite(view.t) ? Date.now() : view.t} />
        ) : tab === "attacks" ? (
          <AttackLab />
        ) : tab === "seat" ? (
          <Supplier record={mode === "replay" ? record : null} view={mode === "replay" ? view : null} token={supplierToken} mode={seatMode} setMode={setSeatMode} />
        ) : tab === "ask" ? (
          <AskAdmin canAsk={liveOk} />
        ) : tab === "display" ? (
          <Display>
            <div className="display-row">
              <div className="seg" role="group" aria-label="Data source">
                <button type="button" aria-pressed={mode === "live"} onClick={() => pick("live")} title="Watch a purchase as it happens. Needs the Surety backend running">
                  Live
                </button>
                <button type="button" aria-pressed={mode === "replay"} onClick={() => pick("replay")} title="Play back a recorded test purchase">
                  Recorded
                </button>
              </div>
              <label className="field">
                <span>Which recording</span>
                <select value={recording} onChange={(e) => setRecording(e.target.value)}>
                  {RECORDINGS.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.label} ({r.date})
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                className="btn flat-btn"
                onClick={() => setUserFlat((v) => !v)}
                aria-pressed={!flat}
                disabled={flatWhy === "motion" || flatWhy === "narrow"}
                title="The control room's panels on a 3D arc instead of flat on the page"
              >
                3D control room
              </button>
            </div>
          </Display>
        ) : tab === "control" ? (
          record && view ? (
            <Control record={record} view={view} replaying={mode === "replay"} flat={flat} />
          ) : (
            <Waiting>No purchase on record yet.</Waiting>
          )
        ) : (
          <Audit record={record} view={view} />
        )}
      </main>

      {scrub && replay ? <ReplayBar replay={replay} current={current} /> : null}
      {replay && (route === "supplier" || (route === "admin" && tab === "seat")) && seatMode === "replay" ? <ReplayBar replay={replay} current={current} /> : null}

      {help ? (
        <Detail title="How Surety works" onClose={() => setHelp(false)}>
          <ol className="how">
            {HOW_IT_WORKS.map((h) => (
              <li key={h.title}>
                <strong>{h.title}.</strong> {h.text}
              </li>
            ))}
          </ol>
          <More label="Words you will see">
            <dl className="glossary">
              {Object.values(GLOSSARY).map((g) => (
                <div key={g.name}>
                  <dt>{g.name}</dt>
                  <dd>{g.means}</dd>
                </div>
              ))}
            </dl>
          </More>
        </Detail>
      ) : null}
    </div>
  );
}
