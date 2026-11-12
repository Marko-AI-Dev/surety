import { useEffect, useState } from "react";
import { dealStages } from "./data/buyer";
import { RECORDINGS, recordingOf } from "./data/evidence";
import { headline } from "./data/livescreen";
import { GLOSSARY, HOW_IT_WORKS, liveLine, statusLine } from "./data/plain";
import { type Mode, useRun } from "./run";
import { AttackLab } from "./views/AttackLab";
import { Business, LedgerLinks, Numbers, Stages } from "./views/Business";
import { Control } from "./views/Control";
import { Inspector } from "./views/Inspector";
import { MoneyRail } from "./views/MoneyRail";
import { ReplayBar } from "./views/ReplayBar";
import { Detail, useFlat } from "./views/Spatial";
import { Start } from "./views/Start";
import { type SeatMode, Supplier } from "./views/Supplier";
import { More, Waiting } from "./views/bits";

type Route = "buy" | "control" | "attack" | "supplier" | "inspector";
// `short` is the label on a phone, where the tabs share one row and never scroll. The inspector's
// page is reached by its own link, not from the bar.
const ROUTES: { id: Route; hash: string; label: string; short: string; nav: boolean }[] = [
  { id: "buy", hash: "#/", label: "Purchase", short: "Purchase", nav: true },
  { id: "control", hash: "#/control", label: "Control room", short: "Control", nav: true },
  { id: "attack", hash: "#/attack", label: "Attack lab", short: "Attacks", nav: true },
  { id: "supplier", hash: "#/supplier", label: "Supplier seat", short: "Supplier", nav: true },
  { id: "inspector", hash: "#/inspector", label: "Inspector", short: "Inspector", nav: false },
];

function parseHash(hash: string): { route: Route; token: string | null } {
  const [path = "", query = ""] = hash.replace(/^#/, "").split("?");
  const route = ROUTES.find((r) => r.hash === `#${path}`)?.id ?? "buy";
  return { route, token: new URLSearchParams(query).get("t") };
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
  const [{ route }, setLocation] = useState(() => parseHash(location.hash));
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
  // Flat: no depth and no tilt, every pane on the page at once. It is the default, because the arc
  // clips its side panes on a 1440 px screen; the button turns the 3D layout on.
  const [userFlat, setUserFlat] = useState(true);
  const [help, setHelp] = useState(false);
  const [recording, setRecording] = useState("paid");
  const flatWhy = useFlat(userFlat);
  const flat = flatWhy !== null;
  const run = useRun(mode, boot.sim, recording);
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
      setLocation((cur) => {
        if (cur.route !== next.route) scrollTo(0, 0);
        return { route: next.route, token: null };
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
  const board = route === "buy" || route === "control";
  const simulated = mode === "live" && run.live?.simulated === true;
  const status = record && view ? statusLine(record, view) : null;

  return (
    <div className="app" data-route={route}>
      <header className="top glass">
        <a className="brand" href="#/">
          Surety
        </a>
        <p className="testnet">
          <span className="nav-full">Test network. No real money.</span>
          <span className="nav-short">Test, no real money</span>
        </p>
        <nav aria-label="Views">
          {ROUTES.filter((r) => r.nav).map((r) => (
            <a key={r.id} href={r.hash} aria-current={route === r.id ? "page" : undefined}>
              <span className="nav-full">{r.label}</span>
              <span className="nav-short">{r.short}</span>
            </a>
          ))}
        </nav>
        <div className="top-tools">
          <div className="seg" role="group" aria-label="Data source">
            <button type="button" aria-pressed={mode === "live"} onClick={() => pick("live")} title="Watch a purchase as it happens. Needs the Surety backend running">
              Live
            </button>
            <button type="button" aria-pressed={mode === "replay"} onClick={() => pick("replay")} title="Play back a recorded test purchase">
              Recorded
            </button>
          </div>
          <button type="button" className="btn" onClick={() => setTheme((t) => (t === "light" ? "dark" : "light"))} aria-pressed={theme === "dark"}>
            Dark
          </button>
          <button
            type="button"
            className="btn flat-btn"
            onClick={() => setUserFlat((v) => !v)}
            aria-pressed={flatWhy === "user" || flatWhy === "motion"}
            disabled={flatWhy === "motion"}
            title={flatWhy === "motion" ? "On because this device asks for reduced motion" : "Flat shows every panel at once. Turn it off for the 3D layout"}
          >
            Flat
          </button>
        </div>
      </header>

      {/* What you are looking at. A recording and a simulated feed are always badged; live never is. */}
      {!phonePage && route !== "attack" ? (
        <p className="source-banner" data-tone={mode === "live" && run.live?.status === "error" ? "stop" : "plain"}>
          {mode === "replay" ? (
            <>
              <span className="badge" data-kind="recorded">
                Recorded
              </span>
              <span title={`Every message, amount and transaction comes from ${tape.file}`}>
                {fellBack ? "The live backend is not reachable, so this is a recording of " : "This is a recording of "}a real test purchase made by AI agents on {tape.date}.
              </span>{" "}
              <label className="tape-pick">
                <span className="visually-hidden">Which recording</span>
                <select value={recording} onChange={(e) => setRecording(e.target.value)}>
                  {RECORDINGS.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.label}
                    </option>
                  ))}
                </select>
              </label>
            </>
          ) : simulated ? (
            <>
              <span className="badge" data-kind="simulated">
                Simulated feed
              </span>
              <span>A recorded run played through the live screen for testing. This is not live.</span>
            </>
          ) : run.live?.status === "error" ? (
            <span>
              {run.live.everConnected ? "Lost the connection to the Surety backend. Showing the last state it sent. " : "Cannot reach the Surety backend. "}
              {run.live.message}
            </span>
          ) : (
            <>
              <span className="badge" data-kind="live">
                Live
              </span>
              <span>{run.live?.status === "connecting" ? "Connecting to the Surety backend." : liveLine(view)}</span>
            </>
          )}{" "}
          <button type="button" className="link-btn" onClick={() => setHelp(true)}>
            How it works
          </button>
        </p>
      ) : null}

      {record && view && status && board ? (
        <section className="dealbar glass" aria-label="Where the money is, and where the deal stands">
          <p className="now" data-tone={status.tone} aria-live="polite">
            <strong>{status.now}</strong> <span>{status.detail}</span>
          </p>
          {route === "buy" ? (
            <>
              <Numbers h={headline(record, view)} />
              <LedgerLinks record={record} view={view} />
              <Stages stages={dealStages(record, view)} thin />
            </>
          ) : (
            <>
              <MoneyRail record={record} view={view} />
              <Stages stages={dealStages(record, view)} />
            </>
          )}
        </section>
      ) : null}

      <main>
        {route === "attack" ? (
          <AttackLab />
        ) : route === "supplier" ? (
          <Supplier record={mode === "replay" ? record : null} view={mode === "replay" ? view : null} token={supplierToken} mode={seatMode} setMode={setSeatMode} />
        ) : route === "inspector" ? (
          <Inspector token={inspectorToken} />
        ) : !record || !view ? (
          mode === "live" && run.live?.status === "ok" && !simulated ? (
            <Start waiting="No purchase is running." />
          ) : (
            <Waiting>{mode === "live" ? (simulated ? "The simulated purchase is about to open." : "Connecting to the Surety backend.") : "Loading the recorded run."}</Waiting>
          )
        ) : route === "control" ? (
          <Control record={record} view={view} replaying={mode === "replay"} flat={flat} />
        ) : (
          <Business record={record} view={view} replaying={mode === "replay"} flat={flat} />
        )}
      </main>

      {replay && board ? <ReplayBar replay={replay} current={current} /> : null}
      {replay && route === "supplier" && seatMode === "replay" ? <ReplayBar replay={replay} current={current} /> : null}

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
