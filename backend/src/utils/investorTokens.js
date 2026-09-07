// /backend/src/utils/investorTokens.js
// Shared token generation/hashing for the investor portal (invitations and
// the sessions they mint). Raw tokens are never stored — only a deterministic
// HMAC-SHA256 hash, keyed by a dedicated secret so a DB leak alone can't be
// used to verify guesses without also having that secret.
import crypto from "crypto";

const PEPPER = process.env.INVESTOR_LINK_SECRET || process.env.JWT_SECRET;

export function generateToken() {
  // 24 random bytes = 192 bits of entropy, base64url-encoded (URL-safe, no padding).
  return crypto.randomBytes(24).toString("base64url");
}

export function hashToken(token) {
  return crypto.createHmac("sha256", PEPPER).update(token).digest("hex");
}

export function tokenPrefix(token) {
  return token.slice(0, 8);
}
