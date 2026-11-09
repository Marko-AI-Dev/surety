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
const ROUTES: { id: Route; hash: string; label: string }[] = [
  { id: "buy", hash: "#/", label: "Buy" },
  { id: "control", hash: "#/control", label: "Control room" },
  { id: "attack", hash: "#/attack", label: "Attack lab" },
  { id: "supplier", hash: "#/supplier", label: "Supplier seat" },
];

function parseHash(hash: string): { route: Route; token: string | null } {
  const [path = "", query = ""] = hash.replace(/^#/, "").split("?");
  const route = ROUTES.find((r) => r.hash === `#${path}`)?.id ?? "buy";
  return { route, token: new URLSearchParams(query).get("t") };
}

type Theme = "system" | "light" | "dark";

export function App() {
  const [{ route }, setLocation] = useState(() => parseHash(location.hash));
  // The supplier token arrives after the # and is kept in memory only. It is removed from the address
  // bar at once, so it is not left in history, and it is never written to storage.
  const [token, setToken] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>("replay");
  const [theme, setTheme] = useState<Theme>("system");
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
    if (theme === "system") delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = theme;
  }, [theme]);

  const { record, view, replay } = run;
  const current = replay && view ? (view.trail[view.trail.length - 1] ?? null) : null;
  const seatUrl = `${location.origin}${location.pathname}#/supplier`;
  const seat = route === "supplier";

  return (
    <div className="app" data-route={route}>
      <header className="top">
        <a className="brand" href="#/">
          Surety
        </a>
        <p className="testnet">XRPL Testnet. Test dollars with no value.</p>
        <nav aria-label="Views">
          {ROUTES.map((r) => (
            <a key={r.id} href={r.hash} aria-current={route === r.id ? "page" : undefined}>
              {r.label}
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
            onClick={() => setTheme((t) => (t === "light" ? "dark" : t === "dark" ? "system" : "light"))}
            aria-label={`Theme: ${theme}. Change theme`}
          >
            {theme === "system" ? "Theme: auto" : theme === "light" ? "Theme: light" : "Theme: dark"}
          </button>
        </div>
      </header>

      {mode === "replay" && !seat && route !== "attack" ? (
        <p className="source-banner">
          Replaying a real testnet run from 9 Nov 2026, 18:50 to 18:56 UTC. Every message, score, amount and transaction is from{" "}
          <span className="mono">{RECORDED_RUN_FILE}</span>. Nothing on this page is live.
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
          <Control record={record} view={view} replaying={mode === "replay"} seatUrl={seatUrl} />
        ) : (
          <Business record={record} view={view} replaying={mode === "replay"} />
        )}
      </main>

      {replay && route !== "attack" && !(seat && seatMode !== "replay") ? <ReplayBar replay={replay} current={current} /> : null}
    </div>
  );
}
