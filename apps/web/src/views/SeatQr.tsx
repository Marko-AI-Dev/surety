import { useMemo, useState } from "react";
import { QR_MAX_BYTES, qrMatrix, qrPath } from "../data/qr";
import { Waiting } from "./bits";

// A phone link as a QR code: the supplier seat for a judge, or the inspector's page. A phone cannot
// open "localhost", so the address is editable: put in this machine's network address, or the hosted
// one. With a token, the link opens the live page as that person; the token rides after the # of the
// address, so it is never sent in a request line or kept in a server log. It is held in this field
// only, never stored. The code is drawn here by src/data/qr.ts; nothing goes to a QR service.
// Always dark on white, whatever the theme.
export function phoneLink(base: string, page: "supplier" | "inspector", token: string): string {
  const origin = base.trim().replace(/#.*$/, "");
  const t = token.trim();
  return `${origin}#/${page}${t ? `?t=${encodeURIComponent(t)}` : ""}`;
}

export function SeatQr({ page, tokenLabel, tokenHelp }: { page: "supplier" | "inspector"; tokenLabel?: string; tokenHelp?: string }) {
  const [base, setBase] = useState(() => `${location.origin}${location.pathname}`);
  const [token, setToken] = useState("");
  const url = phoneLink(base, page, token);
  const local = /\/\/(localhost|127\.0\.0\.1|\[::1\])([:/]|$)/.test(url);
  const code = useMemo(() => {
    if (new TextEncoder().encode(url).length > QR_MAX_BYTES) return null;
    return qrPath(qrMatrix(url));
  }, [url]);
  // The token is a secret: the link is shown without it. The QR code carries it.
  const shown = phoneLink(base, page, "") + (token.trim() ? "?t=(token)" : "");
  return (
    <div className="seat-qr">
      {code ? (
        <svg className="qr" viewBox={`0 0 ${code.size} ${code.size}`} role="img" aria-label={`QR code for ${shown}`} shapeRendering="crispEdges">
          <rect width={code.size} height={code.size} fill="#ffffff" />
          <path d={code.d} fill="#000000" />
        </svg>
      ) : (
        <Waiting>That address and token are too long for the QR code. Use a shorter address.</Waiting>
      )}
      <div className="seat-qr-side">
        <label className="field">
          <span>Address phones should open</span>
          <input type="url" value={base} onChange={(e) => setBase(e.target.value)} spellCheck={false} autoCapitalize="off" />
        </label>
        {tokenLabel ? (
          <label className="field">
            <span>{tokenLabel}</span>
            <input type="password" value={token} onChange={(e) => setToken(e.target.value)} autoComplete="off" spellCheck={false} />
          </label>
        ) : null}
        <p className="fine">{token.trim() ? tokenHelp : page === "supplier" ? "The code opens practice mode, which needs no backend." : "Paste the inspector's token to make the link."}</p>
        <p className="seat-url mono">{shown}</p>
        {local ? (
          <p className="fine" data-tone="held">
            A phone cannot reach "localhost". Replace it with this machine's network address (start the app with <code>pnpm web --host</code>) or the hosted
            address.
          </p>
        ) : null}
      </div>
    </div>
  );
}
