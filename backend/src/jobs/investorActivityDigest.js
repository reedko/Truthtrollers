// /backend/src/jobs/investorActivityDigest.js
// Periodically checks for investor-portal sessions that have gone quiet for
// IDLE_MINUTES and sends one summary email per idle batch, then marks those
// events summarized so they aren't reported twice.
import { sendInvestorActivitySummaryEmail } from "../utils/emailService.js";

const IDLE_MINUTES = 15;
const CHECK_INTERVAL_MS = 2 * 60 * 1000;

async function runOnce(query) {
  const idleSessions = await query(
    `SELECT session_id, invitation_id, MAX(created_at) AS last_event_at
     FROM investor_access_events
     WHERE summarized_at IS NULL AND session_id IS NOT NULL
     GROUP BY session_id, invitation_id
     HAVING last_event_at < DATE_SUB(NOW(), INTERVAL ? MINUTE)`,
    [IDLE_MINUTES],
  );

  for (const { session_id, invitation_id } of idleSessions) {
    try {
      const invitations = await query(
        `SELECT recipient_name, recipient_email FROM investor_invitations WHERE invitation_id = ?`,
        [invitation_id],
      );
      if (invitations.length === 0) continue;

      const events = await query(
        `SELECT event_id, event_type, document_id, duration_seconds, created_at
         FROM investor_access_events
         WHERE session_id = ? AND summarized_at IS NULL
         ORDER BY created_at ASC`,
        [session_id],
      );
      if (events.length === 0) continue;

      await sendInvestorActivitySummaryEmail(invitations[0], events);

      const eventIds = events.map((e) => e.event_id);
      await query(
        `UPDATE investor_access_events SET summarized_at = NOW() WHERE event_id IN (${eventIds.map(() => "?").join(",")})`,
        eventIds,
      );
    } catch (err) {
      console.error(`❌ [Investor Digest] Failed for session ${session_id}:`, err.message);
    }
  }
}

export function startInvestorActivityDigest({ query }) {
  setInterval(() => {
    runOnce(query).catch((err) => console.error("❌ [Investor Digest] run failed:", err.message));
  }, CHECK_INTERVAL_MS);
  console.log(`🕐 Investor activity digest job started (checks every ${CHECK_INTERVAL_MS / 60000} min, ${IDLE_MINUTES}-min idle threshold)`);
}
