"""Everyday Surety journeys, driven by an AI browser agent against the PRACTICE backend only.

Each journey gives the agent one goal in plain words, as a new buyer would say it, and never names a
button. The agent finds its own way by reading the screen. Afterwards the purchase's own record is
checked, so the agent cannot simply claim it finished. A journey that fails, or needs far more
actions than it should, points at a design problem, not a test problem.

Synthetic data only. This refuses to run against anything but the practice backend on this machine
(scripts/practice-backend.ts): no ledger, no keys, no real suppliers.

Before running, in two terminals:

  PRACTICE_PORT=4227 PRACTICE_PACE_MS=250 pnpm practice
  SURETY_API_URL=http://127.0.0.1:4227 API_TOKEN_VIEW=<40 x V> pnpm --filter @surety/web exec vite --port 5199 --strictPort

The runner starts its own headless Chrome with an empty profile (never a person's own browser), and
starts it again if it stops. Set CHROME to the browser's path if it is not in the usual place.

Then, with JEV_HOME set to a jev-ultrafast checkout that has its own .venv and .env (the model keys
stay in that git-ignored .env and are never printed):

  "$JEV_HOME/.venv/Scripts/python" journeys/surety_journeys.py                 # every journey, 3 runs each
  "$JEV_HOME/.venv/Scripts/python" journeys/surety_journeys.py --runs 1 --only "Say yes to the deal"
  "$JEV_HOME/.venv/Scripts/python" journeys/surety_journeys.py --phone         # at phone size
"""

import argparse
import json
import os
import shutil
import statistics
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
from datetime import datetime
from pathlib import Path

WEB = os.environ.get("SURETY_WEB", "http://localhost:5199")
API = os.environ.get("SURETY_PRACTICE_API", "http://127.0.0.1:4227")
CONTROL = os.environ.get("SURETY_PRACTICE_CONTROL", "http://127.0.0.1:4228")
# The practice backend's fixed view token: synthetic, and good for nothing else.
VIEW = "V" * 40
SECONDS_ALLOWED = 150
RECORD = None  # set by --record: a screenshot of every step


def load_agent():
    """The agent library lives outside this repo. Its keys are read into this process and never shown."""
    home = os.environ.get("JEV_HOME")
    if not home or not (Path(home) / "jev_ultrafast").is_dir():
        raise SystemExit("Set JEV_HOME to a jev-ultrafast checkout (see the top of this file).")
    # The small model that writes what the agent types. Set here, ahead of the checkout's own .env,
    # because a model named there can be withdrawn by the provider (13 Nov: it answered 404).
    os.environ.setdefault("TEXT_MODEL", "openai/gpt-4o-mini")
    env = Path(home) / ".env"
    if env.is_file():
        for line in env.read_text(encoding="utf-8").splitlines():
            if "=" in line and not line.lstrip().startswith("#"):
                key, value = line.split("=", 1)
                os.environ.setdefault(key.strip(), value.strip())
    # The browser this run uses is the separate headless one, not a person's own.
    os.environ["BU_CDP_URL"] = CDP
    os.environ["BH_TELEMETRY"] = "0"
    os.environ["ANONYMIZED_TELEMETRY"] = "false"
    sys.path.insert(0, home)
    from jev_ultrafast import Agent

    return Agent


CDP = os.environ.get("SURETY_CDP_URL", "http://127.0.0.1:9333")
BROWSER = {"process": None, "profile": None}


def browser_up():
    try:
        with urllib.request.urlopen(f"{CDP}/json/version", timeout=2):
            return True
    except Exception:
        return False


def ensure_browser():
    """A headless Chrome of the runner's own, with an empty profile and no extensions. Started on first
    use and again whenever it has stopped, so one crash costs one run, not the rest of them."""
    if browser_up():
        return
    chrome = os.environ.get("CHROME") or next(
        (c for c in (r"C:\Program Files\Google\Chrome\Application\chrome.exe", shutil.which("chrome"), shutil.which("google-chrome"), shutil.which("chromium")) if c and Path(c).exists()),
        None,
    )
    if not chrome:
        raise SystemExit("Chrome was not found. Set CHROME to its path.")
    if BROWSER["profile"] is None:
        BROWSER["profile"] = tempfile.mkdtemp(prefix="surety-journeys-")
    port = CDP.rsplit(":", 1)[1]
    BROWSER["process"] = subprocess.Popen(
        [chrome, "--headless=new", f"--remote-debugging-port={port}", f"--user-data-dir={BROWSER['profile']}", "--disable-extensions", "--no-first-run", "--no-default-browser-check", "--window-size=1120,780", "about:blank"],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    for _ in range(60):
        if browser_up():
            return
        time.sleep(0.25)
    raise RuntimeError("the headless browser did not start")


def close_browser():
    if BROWSER["process"] is not None:
        BROWSER["process"].terminate()
    if BROWSER["profile"] is not None:
        shutil.rmtree(BROWSER["profile"], ignore_errors=True)


def http_json(method, url, body=None, token=None):
    headers = {"content-type": "application/json"}
    if token:
        headers["authorization"] = f"Bearer {token}"
    req = urllib.request.Request(url, method=method, data=json.dumps(body).encode() if body is not None else None, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            raw = r.read()
            return json.loads(raw) if raw else None
    except urllib.error.HTTPError as e:
        raise RuntimeError(f"{method} {url} -> {e.code} {e.read().decode()[:200]}") from None


def must_be_practice():
    for url in (API, CONTROL):
        if not url.startswith(("http://127.0.0.1:", "http://localhost:")):
            raise SystemExit("Practice backend on this machine only.")
    try:
        who = http_json("GET", f"{CONTROL}/whoami")
    except Exception:
        raise SystemExit("The practice backend is not running (see the top of this file).") from None
    if not who or who.get("practice") is not True or who.get("api") != API:
        raise SystemExit("That is not the practice backend. Refusing to run.")


api = lambda method, path, body=None: http_json(method, f"{API}{path}", body, VIEW)  # noqa: E731


def record():
    """The newest purchase's full record, or None when there is none."""
    listed = api("GET", "/sourcing")
    return api("GET", f"/sourcing/{listed[0]['id']}/record") if listed else None


def until(check, what, seconds=60):
    deadline = time.time() + seconds
    while time.time() < deadline:
        r = record()
        if r and check(r):
            return r
        time.sleep(0.3)
    raise RuntimeError(f"seed: {what} did not happen within {seconds} s")


BRIEF = {"quantity": 400, "targetUnitCents": 11_000, "maxUnitCents": 12_000, "priority": "balanced", "latestDeliveryDays": 30, "negotiationSeconds": 1800}
committed = lambda r: sum(1 for i in r["invites"] if i.get("quote"))  # noqa: E731


def reset():
    http_json("POST", f"{CONTROL}/reset", {})
    return {}


def seed_negotiating():
    """A purchase under way: both suppliers have answered and committed a price, and nothing is decided."""
    reset()
    api("POST", "/demo/start", BRIEF)
    r = until(lambda r: committed(r) == 2, "two committed quotes")
    return {"id": r["sourcing"]["id"]}


def seed_review():
    """The agent has recommended a deal and is waiting for the buyer's yes or no."""
    d = seed_negotiating()
    api("POST", f"/sourcing/{d['id']}/wrap-up", {})
    until(lambda r: (r.get("approval") or {}).get("state") == "waiting", "a recommendation")
    return d


def seed_draft():
    """Approve-first: the negotiator's first message is waiting for the buyer."""
    reset()
    api("POST", "/demo/start", {**BRIEF, "autonomy": "approve"})
    r = until(lambda r: len(r.get("drafts") or []) > 0, "a waiting message")
    return {"id": r["sourcing"]["id"]}


def by_id(d):
    return api("GET", f"/sourcing/{d['id']}/record")


JOURNEYS = [
    dict(
        name="Order solar panels",
        seed=reset,
        goal="You run a solar business and need 400 solar panels. You hope to pay about $110 each and never more than $120, and you need them within 30 days. "
        "Ask your purchasing agent to buy them, answer anything it asks, and get your team started.",
        ok=lambda s, d: (lambda r: r is not None and r["sourcing"]["brief"]["goods"]["quantity"] == 400 and r["sourcing"]["brief"]["goods"]["maxUnitCents"] == 12_000)(record()),
    ),
    dict(
        name="Order, knowing what matters",
        seed=reset,
        goal="You run a solar business and need 400 solar panels. You hope to pay about $110 each and never more than $120, and you need them within 30 days. "
        "Price and delivery speed matter equally to you, and you want firm negotiating. Ask your purchasing agent to buy them and get your team started.",
        ok=lambda s, d: (lambda r: r is not None and r["sourcing"]["brief"]["goods"]["quantity"] == 400 and r["sourcing"]["brief"]["goods"]["maxUnitCents"] == 12_000)(record()),
    ),
    dict(
        name="Say yes to the deal",
        seed=seed_review,
        goal="Your purchasing agent has brought you a deal it recommends. You are happy with it: say yes (confirm when asked).",
        ok=lambda s, d: (lambda r: (r.get("approval") or {}).get("state") == "approved" and r.get("job") is not None)(by_id(d)),
    ),
    dict(
        name="Say no to the deal",
        seed=seed_review,
        goal="Your purchasing agent has brought you a deal it recommends. You have changed your mind and do not want to buy: say no (confirm when asked).",
        # A no moves nothing: no payment was created and nothing was locked.
        ok=lambda s, d: (lambda r: (r.get("approval") or {}).get("state") == "declined" and r.get("job") is None and r.get("create") is None)(by_id(d)),
    ),
    dict(
        name="Ask for the best offer now",
        seed=seed_negotiating,
        goal="Your agents are still negotiating with suppliers and you cannot wait any longer. Tell them to stop and bring you what they have.",
        ok=lambda s, d: (by_id(d).get("controls") or {}).get("wrapUpAt") is not None,
    ),
    dict(
        name="Reword a message before it goes",
        seed=seed_draft,
        goal="Your negotiator has written a message to a supplier and it is waiting for you. Add a question about the warranty to it, then send it.",
        ok=lambda s, d: any(m["kind"] == "to_supplier" and m.get("buyerApproved") and "warranty" in m["body"].lower() for m in by_id(d)["messages"]),
    ),
    dict(
        name="Approve every message first",
        seed=seed_negotiating,
        goal="From now on you want to read every message before your negotiator sends it to a supplier. Change how your negotiator works so that happens.",
        ok=lambda s, d: (by_id(d).get("controls") or {}).get("autonomy") == "approve",
    ),
]


def run_once(Agent, j):
    started = time.perf_counter()
    state = None
    try:
        ensure_browser()
        data = j["seed"]()
        started = time.perf_counter()
        rec = RECORD / f"{j['name'].replace(' ', '-')}-{int(time.time())}" if RECORD else None
        with Agent(f"{WEB}/#/", [j["goal"]], record_dir=rec) as agent:
            for state in agent.run():
                if time.perf_counter() - started > SECONDS_ALLOWED:
                    break
        passed = bool(state) and bool(j["ok"](state, data))
    except Exception as e:  # a crash is a failed run, with the reason
        return {"passed": False, "actions": 0, "seconds": round(time.perf_counter() - started, 1), "end": f"error: {str(e)[:200]}", "path": []}
    hist = state["history"] if state else []
    return {
        "passed": passed,
        "actions": len(hist),
        "seconds": round(time.perf_counter() - started, 1),
        "end": state["page"]["url"] if state else "",
        "status": state["status"] if state else "",
        "path": [h.get("text") or h.get("action") for h in hist][-12:],
        # What the agent could see when it stopped: the clue to why it stopped there.
        "saw": [str(e.get("label", e))[:60] for e in (state.get("elements") or [])][:30] if state else [],
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--runs", type=int, default=3)
    ap.add_argument("--only")
    ap.add_argument("--record", action="store_true")
    ap.add_argument("--phone", action="store_true", help="browse at phone size (390 x 844)")
    args = ap.parse_args()
    must_be_practice()
    global RECORD
    if args.phone:
        os.environ["JEV_PHONE"] = "1"
    RECORD = Path(__file__).parent / "runs" / "steps" if args.record else None
    Agent = load_agent()
    size = "phone, 390 x 844" if args.phone else "laptop"
    rows = []
    lines = [f"# Surety journeys, {datetime.now():%Y-%m-%d %H:%M} ({size})", "", "Practice backend, synthetic data. The agent's choices come from a model, so pass rates can differ between runs.", "", "| Journey | Passed | Median actions | Median seconds |", "|---|---|---|---|"]
    for j in JOURNEYS:
        if args.only and j["name"] not in args.only.split(","):
            continue
        results = [run_once(Agent, j) for _ in range(args.runs)]
        errors = sum(1 for r in results if str(r["end"]).startswith("error:"))
        passed = sum(r["passed"] for r in results)
        med_a = statistics.median(r["actions"] for r in results)
        med_s = statistics.median(r["seconds"] for r in results)
        print(f"{j['name']:<34} {passed}/{args.runs}  {med_a:>4} actions  {med_s:>6} s", flush=True)
        # A run that crashed (the browser or the model was unreachable) says nothing about the screen.
        lines.append(f"| {j['name']} | {passed}/{args.runs}{f' ({errors} could not run)' if errors else ''} | {med_a} | {med_s} |")
        rows.append((j, results))
    lines += ["", "## Runs that didn't pass", ""]
    failed = False
    for j, results in rows:
        for i, r in enumerate(results):
            if not r["passed"]:
                failed = True
                lines.append(f"- **{j['name']}**, run {i + 1}: {r.get('status', '')} at {r['end']}; last steps: {', '.join(map(str, r['path']))}")
                if r.get("saw"):
                    lines.append(f"  - could see: {' | '.join(r['saw'])}")
    if not failed:
        lines.append("None.")
    out = Path(__file__).parent / "runs" / f"{datetime.now():%Y%m%d-%H%M}{'-phone' if args.phone else ''}.md"
    out.parent.mkdir(exist_ok=True)
    out.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"\nReport: {out}")
    close_browser()


if __name__ == "__main__":
    main()
