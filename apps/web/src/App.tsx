import { useEffect, useState } from "react";
import { RECORDED_RUN_FILE } from "./data/evidence";
import { type Mode, useRun } from "./run";
import { AttackLab } from "./views/AttackLab";
import { Business } from "./views/Business";
import { Control } from "./views/Control";
import { MoneyRail } from "./views/MoneyRail";
import { ReplayBar } from "./views/ReplayBar";
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
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {
      // Private windows can refuse storage; the choice then lasts for this visit.
    }
  }, [theme]);

  const { record, view, replay } = run;
  const current = replay && view ? (view.trail[view.trail.length - 1] ?? null) : null;
  const seat = route === "supplier";

  return (
    <div className="app" data-route={route}>
      <header className="top">
        <a className="brand" href="#/">
          Surety
        </a>
        <p className="testnet">
          <span className="nav-full">XRPL Testnet. Test dollars with no value.</span>
          <span className="nav-short">Testnet, no real money</span>
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
            <button type="button" aria-pressed={mode === "replay"} onClick={() => setMode("replay")}>
              Recorded run
            </button>
            <button type="button" aria-pressed={mode === "live"} onClick={() => setMode("live")}>
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
        </div>
      </header>

      {mode === "replay" && !seat && route !== "attack" ? (
        <p className="source-banner">
          Replay of a real XRPL Testnet run, 9 Nov 2026. Every message, amount and transaction comes from <span className="mono">{RECORDED_RUN_FILE}</span>.
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

      {record && view && !seat && route !== "attack" ? <MoneyRail record={record} view={view} /> : null}

      <main>
        {route === "attack" ? (
          <AttackLab />
        ) : route === "supplier" ? (
          <Supplier record={record} view={view} token={token} mode={seatMode} setMode={setSeatMode} />
        ) : !record || !view ? (
          <Waiting>{mode === "live" ? "No sourcing to show yet. When the Lead opens one it appears here." : "Loading the recorded run."}</Waiting>
        ) : route === "control" ? (
          <Control record={record} view={view} replaying={mode === "replay"} />
        ) : (
          <Business record={record} view={view} replaying={mode === "replay"} />
        )}
      </main>

      {replay && route !== "attack" && !(seat && seatMode !== "replay") ? <ReplayBar replay={replay} current={current} /> : null}
    </div>
  );
}
