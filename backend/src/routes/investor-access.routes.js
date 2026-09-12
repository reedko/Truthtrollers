// /backend/src/routes/investor-access.routes.js
// Recipient-facing routes for the invite-only investor portal.
// No email/password/account creation here — possessing a valid, unexpired,
// unrevoked invitation link is the entire access model.
import { Router } from "express";
import path from "path";
import { fileURLToPath } from "url";
import { generateToken, hashToken } from "../utils/investorTokens.js";
import { sendInvestorLinkOpenedEmail } from "../utils/emailService.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SESSION_COOKIE = "investor_session";

// PDFs live outside any nginx-servable static directory. They are only ever
// reached through the gated /docs/:filename route below, which resolves the
// filename against this fixed allowlist — never a raw filesystem path — so
// there's no path-traversal surface and no way to enumerate other files.
const PRIVATE_DOCS_DIR = path.join(__dirname, "../../private-docs");
const PDF_FILENAME_TO_SLUG = {
  "00_VeriStrata_START_HERE.pdf": "start-here",
  "01_VeriStrata_Business_Plan.pdf": "business-plan",
  "02_VeriStrata_Pitch_Deck.pdf": "pitch-deck",
  "03_VeriStrata_Product_Introduction.pdf": "product",
  "04_VeriStrata_Investor_Financial_Review.pdf": "financial-review",
  "05_VeriStrata_Cap_Table.pdf": "cap-table",
  "06_VeriStrata_Management_Prepared_Financial_Statements.pdf": "statements",
  "07_VeriStrata_SAFE_Agreement.pdf": "safe",
  "08_VeriStrata_Team_and_Advisors.pdf": "team",
};

// Given the original request URI (from nginx's X-Original-URI), decides
// whether this is a "real" page hit worth an analytics event, and if so,
// what kind and which document. Static assets (JS/CSS/images/fonts)
// intentionally produce no event. PDF downloads are logged separately by
// the /docs/:filename route itself, not sniffed from a header here.
function classifyHit(uri) {
  if (!uri) return null;
  const path = uri.split("?")[0];

  if (path === "/") return { eventType: "portal_opened", documentId: null };
  if (path === "/pitch") return { eventType: "document_opened", documentId: "pitch-deck" };

  const docMatch = path.match(/^\/document\/([a-z-]+)\/?$/);
  if (docMatch) return { eventType: "document_opened", documentId: docMatch[1] };

  return null;
}

// Shared by /api/investor-access/check and /docs/:filename so both enforce
// the exact same session+invitation validity rules.
async function resolveSession(query, sessionToken) {
  if (!sessionToken) return null;
  const sessionHash = hashToken(sessionToken);
  const rows = await query(
    `SELECT s.session_id, s.expires_at AS session_expires_at, s.revoked_at AS session_revoked_at,
            i.invitation_id, i.expires_at AS invitation_expires_at, i.revoked_at AS invitation_revoked_at
     FROM investor_access_sessions s
     JOIN investor_invitations i ON i.invitation_id = s.invitation_id
     WHERE s.session_token_hash = ?`,
    [sessionHash],
  );
  if (rows.length === 0) return null;
  const row = rows[0];
  const now = new Date();
  if (row.session_revoked_at || row.invitation_revoked_at) return null;
  if (new Date(row.session_expires_at) <= now) return null;
  if (new Date(row.invitation_expires_at) <= now) return null;
  return row;
}

function resolveClientIp(req) {
  const fwd = req.headers["x-forwarded-for"];
  const ip = fwd ? String(fwd).split(",")[0].trim() : req.socket.remoteAddress;
  return ip ? String(ip).slice(0, 64) : null;
}

// Best-effort, non-blocking city/region/country lookup for a coarse sense of
// where a session came from (e.g. "did the invited investor's usual city
// match, or did this look like it was forwarded to someone else"). Free
// tier, no key, and failures/timeouts just leave geo_area null — never
// blocks granting access.
async function lookupGeoArea(ip) {
  if (!ip || ip === "::1" || ip === "127.0.0.1" || ip.startsWith("192.168.") || ip.startsWith("10.")) return null;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);
    const res = await fetch(
      `http://ip-api.com/json/${encodeURIComponent(ip)}?fields=status,city,regionName,country`,
      { signal: controller.signal },
    );
    clearTimeout(timeout);
    const data = await res.json();
    if (data.status !== "success") return null;
    return [data.city, data.regionName, data.country].filter(Boolean).join(", ").slice(0, 255);
  } catch {
    return null;
  }
}

// Very small fixed-window limiter: a handful of investors, so this only
// needs to stop scripted token guessing, not survive real load.
const attemptsByIp = new Map();
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX = 20;
function rateLimited(ip) {
  const now = Date.now();
  const entry = attemptsByIp.get(ip) || { count: 0, windowStart: now };
  if (now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
    entry.count = 0;
    entry.windowStart = now;
  }
  entry.count += 1;
  attemptsByIp.set(ip, entry);
  return entry.count > RATE_LIMIT_MAX;
}

function sendInvitationConfirmation(res, token) {
  const action = `/access/${encodeURIComponent(token)}`;
  res.set({
    "Cache-Control": "private, no-store",
    "Content-Security-Policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "X-Robots-Tag": "noindex, nofollow, noarchive",
  });
  res.type("html").send(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>VeriStrata Investor Invitation</title>
  <style>
    :root { color-scheme: dark; }
    * { box-sizing: border-box; }
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 24px; color: #eafaff; font-family: Inter, ui-sans-serif, system-ui, sans-serif; background: radial-gradient(circle at 78% 12%, rgba(0, 162, 255, .22), transparent 34%), linear-gradient(145deg, #030811, #071828 58%, #06111d); }
    main { width: min(580px, 100%); padding: 42px; border: 1px solid rgba(113, 219, 255, .28); border-radius: 22px; background: linear-gradient(145deg, rgba(7, 22, 38, .94), rgba(4, 12, 23, .97)); box-shadow: 0 28px 90px rgba(0, 0, 0, .48), inset 0 1px rgba(255, 255, 255, .04); }
    header { display: flex; align-items: center; gap: 12px; margin-bottom: 34px; color: #71dbff; font: 700 12px ui-monospace, monospace; letter-spacing: .15em; }
    header img { width: 34px; height: 34px; object-fit: contain; }
    .eyebrow { margin: 0 0 12px; color: #56d5ff; font: 700 11px ui-monospace, monospace; letter-spacing: .16em; }
    h1 { margin: 0; font-size: clamp(32px, 7vw, 48px); line-height: 1.02; letter-spacing: -.045em; }
    .lede { margin: 20px 0 12px; color: #b9d1dc; font-size: 17px; line-height: 1.62; }
    .privacy { margin: 0 0 30px; color: #7896a5; font-size: 13px; line-height: 1.55; }
    button { width: 100%; min-height: 54px; border: 1px solid #71dbff; border-radius: 12px; color: #03101b; background: linear-gradient(135deg, #71dbff, #32baff); box-shadow: 0 0 28px rgba(50, 186, 255, .2); font: 800 12px ui-monospace, monospace; letter-spacing: .12em; cursor: pointer; }
    button:hover { filter: brightness(1.08); transform: translateY(-1px); }
    footer { margin-top: 22px; color: #5f7b89; font-size: 12px; line-height: 1.55; }
    @media (max-width: 520px) { main { padding: 30px 24px; } }
  </style>
</head>
<body>
  <main>
    <header><img src="/logo.png" alt=""> VERISTRATA · INVESTOR OS</header>
    <p class="eyebrow">PRIVATE INVESTOR INVITATION</p>
    <h1>Review the VeriStrata investor materials.</h1>
    <p class="lede">This private link was issued to share VeriStrata's investor information room. Continue to open the packet.</p>
    <p class="privacy">No password or payment information is requested.</p>
    <form method="post" action="${action}"><button type="submit">CONTINUE TO INVESTOR OS</button></form>
    <footer>If you were not expecting this invitation, close this page. Access through this link may be recorded for investor-relations follow-up.</footer>
  </main>
</body>
</html>`);
}

export default function ({ query, pool }) {
  const router = Router();

  /**
   * GET /access/:token
   * Validates the invitation and shows a branded confirmation page. Link
   * scanners can safely preview this GET without minting a session or
   * generating investor activity. Only the explicit POST below redeems it.
   */
  router.get("/access/:token", async (req, res) => {
    const ip = req.headers["x-forwarded-for"] || req.socket.remoteAddress || "unknown";
    if (rateLimited(String(ip).split(",")[0].trim())) {
      return res.status(429).send("Too many attempts. Please try again later.");
    }

    try {
      const { token } = req.params;
      const hash = hashToken(token);

      const rows = await query(
        `SELECT invitation_id, recipient_name, recipient_email, expires_at, revoked_at
         FROM investor_invitations
         WHERE token_hash = ?`,
        [hash],
      );

      if (rows.length === 0) {
        return res.redirect("/");
      }

      const invitation = rows[0];
      const now = new Date();
      if (invitation.revoked_at) {
        return res.redirect("/");
      }
      if (new Date(invitation.expires_at) <= now) {
        return res.redirect("/");
      }

      sendInvitationConfirmation(res, token);
    } catch (err) {
      console.error("❌ [Investor Access] GET /access/:token error:", err);
      res.redirect("/");
    }
  });

  /**
   * POST /access/:token
   * Redeems an invitation after the visitor explicitly confirms. Mints a
   * session, sets the cookie, and redirects to the clean portal URL.
   */
  router.post("/access/:token", async (req, res) => {
    const ip = req.headers["x-forwarded-for"] || req.socket.remoteAddress || "unknown";
    if (rateLimited(String(ip).split(",")[0].trim())) {
      return res.status(429).send("Too many attempts. Please try again later.");
    }

    try {
      const { token } = req.params;
      const hash = hashToken(token);
      const rows = await query(
        `SELECT invitation_id, recipient_name, recipient_email, expires_at, revoked_at
         FROM investor_invitations
         WHERE token_hash = ?`,
        [hash],
      );
      if (rows.length === 0) return res.redirect("/");

      const invitation = rows[0];
      await query(
        `INSERT INTO investor_access_events (invitation_id, event_type) VALUES (?, 'link_opened')`,
        [invitation.invitation_id],
      );

      const now = new Date();
      if (invitation.revoked_at) {
        await query(
          `INSERT INTO investor_access_events (invitation_id, event_type) VALUES (?, 'denied_revoked')`,
          [invitation.invitation_id],
        );
        return res.redirect("/");
      }
      if (new Date(invitation.expires_at) <= now) {
        await query(
          `INSERT INTO investor_access_events (invitation_id, event_type) VALUES (?, 'denied_expired')`,
          [invitation.invitation_id],
        );
        return res.redirect("/");
      }

      // Session never outlives the invitation.
      const sessionToken = generateToken();
      const sessionHash = hashToken(sessionToken);
      const clientIp = resolveClientIp(req);
      const sessionResult = await query(
        `INSERT INTO investor_access_sessions (invitation_id, session_token_hash, expires_at, ip_address)
         VALUES (?, ?, ?, ?)`,
        [invitation.invitation_id, sessionHash, invitation.expires_at, clientIp],
      );
      const sessionId = sessionResult.insertId;

      // Geo lookup is a network call — never block the redirect on it.
      lookupGeoArea(clientIp)
        .then((area) => {
          if (area) {
            return query(`UPDATE investor_access_sessions SET geo_area = ? WHERE session_id = ?`, [
              area,
              sessionId,
            ]);
          }
        })
        .catch((e) => console.error("investor geo lookup failed:", e.message));

      await query(
        `INSERT INTO investor_access_events (invitation_id, session_id, event_type) VALUES (?, ?, 'access_granted')`,
        [invitation.invitation_id, sessionId],
      );

      // Instant notification — never block the redirect on email delivery.
      sendInvestorLinkOpenedEmail(invitation, clientIp).catch((e) =>
        console.error("investor link-opened email failed:", e.message),
      );

      const maxAgeMs = Math.max(0, new Date(invitation.expires_at).getTime() - now.getTime());
      res.cookie(SESSION_COOKIE, sessionToken, {
        httpOnly: true,
        secure: true,
        sameSite: "lax",
        maxAge: maxAgeMs,
        path: "/",
      });
      res.redirect("/");
    } catch (err) {
      console.error("❌ [Investor Access] POST /access/:token error:", err);
      res.redirect("/");
    }
  });

  /**
   * GET /api/investor-access/check
   * Called by nginx (auth_request) for every request to the protected
   * portal. Also records a lightweight analytics event for real page and
   * document hits (nginx forwards the original URI via X-Original-URI).
   * Returns 200 for a valid, active session; 401 otherwise.
   */
  router.get("/api/investor-access/check", async (req, res) => {
    try {
      const row = await resolveSession(query, req.cookies?.[SESSION_COOKIE]);
      if (!row) return res.sendStatus(401);

      // Fire-and-forget bookkeeping; never block the auth decision on it.
      query(`UPDATE investor_access_sessions SET last_seen_at = NOW() WHERE session_id = ?`, [
        row.session_id,
      ]).catch((e) => console.error("investor session last_seen update failed:", e.message));

      const hit = classifyHit(req.headers["x-original-uri"]);
      if (hit) {
        query(
          `INSERT INTO investor_access_events (invitation_id, session_id, event_type, document_id) VALUES (?, ?, ?, ?)`,
          [row.invitation_id, row.session_id, hit.eventType, hit.documentId],
        ).catch((e) => console.error("investor access event insert failed:", e.message));
      }

      res.sendStatus(200);
    } catch (err) {
      console.error("❌ [Investor Access] check error:", err);
      res.sendStatus(401);
    }
  });

  /**
   * POST /api/investor-access/dwell
   * Body: { documentId: string, seconds: number }
   * Sent via navigator.sendBeacon when a reader leaves a /document/:slug
   * page, so the activity summary can report real read time. PDFs can't
   * report dwell time — they render outside our page once downloaded.
   */
  router.post("/api/investor-access/dwell", async (req, res) => {
    try {
      const row = await resolveSession(query, req.cookies?.[SESSION_COOKIE]);
      if (!row) return res.sendStatus(401);

      const documentId = typeof req.body?.documentId === "string" ? req.body.documentId.slice(0, 64) : null;
      const seconds = Math.max(0, Math.min(3600, Number(req.body?.seconds) || 0));
      if (!documentId || seconds < 1) return res.sendStatus(204);

      await query(
        `INSERT INTO investor_access_events (invitation_id, session_id, event_type, document_id, duration_seconds) VALUES (?, ?, 'document_dwell', ?, ?)`,
        [row.invitation_id, row.session_id, documentId, Math.round(seconds)],
      );
      res.sendStatus(204);
    } catch (err) {
      console.error("❌ [Investor Access] dwell error:", err);
      res.sendStatus(204);
    }
  });

  /**
   * GET /api/investor-access/whoami
   * Tells the frontend whether to show the "who's viewing this?" email
   * prompt: skipped once this browser has self-reported an email before
   * (a long-lived cookie), or once this specific session already has one.
   */
  router.get("/api/investor-access/whoami", async (req, res) => {
    try {
      const row = await resolveSession(query, req.cookies?.[SESSION_COOKIE]);
      if (!row) return res.sendStatus(401);
      if (req.cookies?.investor_identified) return res.json({ needsEmail: false });

      const sessions = await query(`SELECT visitor_email FROM investor_access_sessions WHERE session_id = ?`, [
        row.session_id,
      ]);
      const needsEmail = !sessions[0]?.visitor_email;
      res.json({ needsEmail });
    } catch (err) {
      console.error("❌ [Investor Access] whoami error:", err);
      res.json({ needsEmail: false });
    }
  });

  /**
   * POST /api/investor-access/identify
   * Body: { email: string }
   * Self-reported only — not verified against anything, just recorded so
   * Reed can tell whether activity plausibly matches the invited investor
   * or looks like the link was forwarded to someone else. Sets a long-lived
   * cookie so this browser isn't asked again on future visits/invitations.
   */
  router.post("/api/investor-access/identify", async (req, res) => {
    try {
      const row = await resolveSession(query, req.cookies?.[SESSION_COOKIE]);
      if (!row) return res.sendStatus(401);

      const email = typeof req.body?.email === "string" ? req.body.email.trim().slice(0, 255) : "";
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return res.status(400).json({ error: "Enter a valid email address." });
      }

      await query(`UPDATE investor_access_sessions SET visitor_email = ? WHERE session_id = ?`, [
        email,
        row.session_id,
      ]);
      res.cookie("investor_identified", "1", {
        httpOnly: true,
        secure: true,
        sameSite: "lax",
        maxAge: 365 * 24 * 60 * 60 * 1000,
        path: "/",
      });
      res.sendStatus(204);
    } catch (err) {
      console.error("❌ [Investor Access] identify error:", err);
      res.status(500).json({ error: "Something went wrong." });
    }
  });

  /**
   * POST /api/investor-access/skip
   * Dismisses the "who's viewing this?" prompt without an email. Sets the
   * same long-lived cookie as /identify so this browser isn't asked again.
   */
  router.post("/api/investor-access/skip", async (req, res) => {
    try {
      const row = await resolveSession(query, req.cookies?.[SESSION_COOKIE]);
      if (!row) return res.sendStatus(401);

      res.cookie("investor_identified", "1", {
        httpOnly: true,
        secure: true,
        sameSite: "lax",
        maxAge: 365 * 24 * 60 * 60 * 1000,
        path: "/",
      });
      res.sendStatus(204);
    } catch (err) {
      console.error("❌ [Investor Access] skip error:", err);
      res.status(500).json({ error: "Something went wrong." });
    }
  });

  /**
   * GET /docs/:filename
   * Serves packet PDFs from outside any static webroot. The filename must
   * match the fixed allowlist above — never a raw filesystem path — and a
   * valid investor session is required, same rules as everywhere else.
   */
  router.get("/docs/:filename", async (req, res) => {
    try {
      const slug = PDF_FILENAME_TO_SLUG[req.params.filename];
      if (!slug) return res.status(404).end();

      const row = await resolveSession(query, req.cookies?.[SESSION_COOKIE]);
      // "/" is itself behind the nginx auth_request gate, so an invalid
      // session lands on the same access-denied page as everything else
      // (the dedicated access-denied.html location is nginx-internal-only).
      if (!row) return res.redirect("/");

      query(`UPDATE investor_access_sessions SET last_seen_at = NOW() WHERE session_id = ?`, [
        row.session_id,
      ]).catch((e) => console.error("investor session last_seen update failed:", e.message));
      query(
        `INSERT INTO investor_access_events (invitation_id, session_id, event_type, document_id) VALUES (?, ?, 'document_downloaded', ?)`,
        [row.invitation_id, row.session_id, slug],
      ).catch((e) => console.error("investor access event insert failed:", e.message));

      res.sendFile(path.join(PRIVATE_DOCS_DIR, req.params.filename));
    } catch (err) {
      console.error("❌ [Investor Access] /docs/:filename error:", err);
      res.status(500).end();
    }
  });

  return router;
}
