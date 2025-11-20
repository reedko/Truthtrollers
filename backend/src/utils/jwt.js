// utils/jwt.js
import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret"; // set this securely in prod

export function decodeJwt(token) {
  try {
    return jwt.decode(token); // ✅ No signature verification
  } catch (err) {
    console.error("❌ Failed to decode JWT:", err.message);
    return null;
  }
}
