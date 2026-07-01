export function generateDeviceFingerprint(): string {
  /*   const key = "tt_device_fp";

  const existing = localStorage.getItem(key);
  if (existing) return existing; */
  // Normalize userAgent: only keep browser family (Chrome/Firefox/Safari/Edge)
  let browser = "Unknown";
  const ua = navigator.userAgent;

  if (ua.includes("Chrome")) browser = "Chrome";
  else if (ua.includes("Firefox")) browser = "Firefox";
  else if (ua.includes("Safari")) browser = "Safari";
  else if (ua.includes("Edg")) browser = "Edge";

  const components = [
    browser, // Now version-agnostic!
    navigator.platform || "", // Platform, e.g. "MacIntel"
    navigator.language,
    "1920x1080", // Fixed for your app
    "24", // Fixed for your app
    new Date().getTimezoneOffset(),
    "Africa/Nairobi",
  ];

  const raw = components.join("|");
  return btoa(raw);
}
