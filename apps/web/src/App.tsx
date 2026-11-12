import { useEffect, useState } from "react";
import { RECORDED_RUN_FILE } from "./data/evidence";
import { GLOSSARY, HOW_IT_WORKS, statusLine } from "./data/plain";
import { type Mode, useRun } from "./run";
import { dealStages } from "./data/buyer";
import { AttackLab } from "./views/AttackLab";
import { Business, Stages } from "./views/Business";
import { Control } from "./views/Control";
import { MoneyRail } from "./views/MoneyRail";
import { ReplayBar } from "./views/ReplayBar";
import { Detail, useFlat } from "./views/Spatial";
import { More } from "./views/bits";
import { type SeatMode, Supplier } from "./views/Supplier";
import { Waiting } from "./views/bits";

type Route = "buy" | "control" | "attack" | "supplier";
// `short` is the label on a phone, where the four tabs share one row and never scroll.
const ROUTES: { id: Route; hash: string; label: string; short: string }[] = [
  { id: "buy", hash: "#/", label: "Buy", short: "Buy" },
  { id: "control", hash: "#/control", label: "Control room", short: "Control" },
  { id: "attack", hash: "#/attack", label: "Attack lab", short: "Attacks" },
  { id: "supplier", hash: "#/supplier", label: "Supplier seat", short: "Supplier" },
];

function parseHash(hash: string): { route: Route; token: string | null } {
  const [path = "", query = ""] = hash.replace(/^#/, "").split("?");
  const route = ROUTES.find((r) => r.hash === `#${path}`)?.id ?? "buy";
  return { route, token: new URLSearchParams(query).get("t") };
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
  // The supplier token arrives after the # and is kept in memory only. It is removed from the address
  // bar at once, so it is not left in history, and it is never written to storage.
  const [token, setToken] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>("replay");
  const [theme, setTheme] = useState<Theme>(storedTheme);
  const [seatMode, setSeatMode] = useState<SeatMode>("replay");
  // Flat: no depth, no tilt, solid panels. On for reduced motion and narrow screens, or by the button.
  const [userFlat, setUserFlat] = useState(false);
  const [help, setHelp] = useState(false);
  const flatWhy = useFlat(userFlat);
  const flat = flatWhy !== null;
  const run = useRun(mode);

  useEffect(() => {
    const read = () => {
      const next = parseHash(location.hash);
      if (next.token) {
        setToken(next.token);
        setSeatMode("live");
        history.replaceState(null, "", `${location.pathname}${location.search}#/supplier`);
      }
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
    // Solid panels when flat was asked for (by the button or by the reduced-motion setting); a narrow
    // screen is flat in layout only and keeps its glass.
    document.documentElement.dataset.solid = String(flatWhy === "user" || flatWhy === "motion");
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {
      // Private windows can refuse storage; the choice then lasts for this visit.
    }
  }, [theme, flat, flatWhy]);

  const { record, view, replay } = run;
  const current = replay && view ? (view.trail[view.trail.length - 1] ?? null) : null;
  const seat = route === "supplier";

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
          {ROUTES.map((r) => (
            <a key={r.id} href={r.hash} aria-current={route === r.id ? "page" : undefined}>
              <span className="nav-full">{r.label}</span>
              <span className="nav-short">{r.short}</span>
            </a>
          ))}
        </nav>
        <div className="top-tools">
          <div className="seg" role="group" aria-label="Data source">
            <button type="button" aria-pressed={mode === "replay"} onClick={() => setMode("replay")} title="Play back the recorded test purchase">
              Recording
            </button>
            <button type="button" aria-pressed={mode === "live"} onClick={() => setMode("live")} title="Watch a purchase as it happens. Needs the Surety backend running">
              Live
            </button>
          </div>
          <button
            type="button"
            className="btn"
            onClick={() => setTheme((t) => (t === "light" ? "dark" : "light"))}
            aria-pressed={theme === "dark"}
          >
            Dark
          </button>
          <button type="button" className="btn flat-btn" onClick={() => setUserFlat((v) => !v)} aria-pressed={flatWhy === "user" || flatWhy === "motion"} disabled={flatWhy === "motion"} title={flatWhy === "motion" ? "On because this device asks for reduced motion" : "Turn off the 3D layout and the glass"}>
            Flat
          </button>
        </div>
      </header>

      {mode === "replay" && !seat && route !== "attack" ? (
        <p className="source-banner">
          <span title={`Every message, amount and transaction comes from ${RECORDED_RUN_FILE}`}>
            You are watching a recording of a real test purchase made by AI agents on 9 Nov 2026. No real money is involved.
          </span>{" "}
          <button type="button" className="link-btn" onClick={() => setHelp(true)}>
            How it works
          </button>
        </p>
      ) : null}
      {mode === "live" && run.live ? (
        <p className="source-banner" data-tone={run.live.status === "error" ? "stop" : "plain"}>
          {run.live.status === "error"
            ? `Live mode cannot reach the Surety API: ${run.live.message} Start the API and run the dev server with API_TOKEN_VIEW set, or switch to the recorded run.`
            : run.live.status === "connecting"
              ? "Connecting to the Surety API."
              : (run.live.message ?? `Live: sourcing ${record?.sourcing.ref ?? ""}, refreshed every 2 seconds.`)}
        </p>
      ) : null}

      {record && view && !seat && route !== "attack" ? (
        <section className="dealbar glass" aria-label="Where the money is, and where the deal stands">
          {(() => {
            const s = statusLine(record, view);
            return (
              <p className="now" data-tone={s.tone} aria-live="polite">
                <strong>{s.now}</strong> <span>{s.detail}</span>
              </p>
            );
          })()}
          <MoneyRail record={record} view={view} />
          <Stages stages={dealStages(record, view)} />
        </section>
      ) : null}

      <main>
        {route === "attack" ? (
          <AttackLab />
        ) : route === "supplier" ? (
          <Supplier record={record} view={view} token={token} mode={seatMode} setMode={setSeatMode} />
        ) : !record || !view ? (
          <Waiting>{mode === "live" ? "No sourcing to show yet. When the Lead opens one it appears here." : "Loading the recorded run."}</Waiting>
        ) : route === "control" ? (
          <Control record={record} view={view} replaying={mode === "replay"} flat={flat} />
        ) : (
          <Business record={record} view={view} replaying={mode === "replay"} flat={flat} />
        )}
      </main>

      {replay && route !== "attack" && !(seat && seatMode !== "replay") ? <ReplayBar replay={replay} current={current} /> : null}

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
