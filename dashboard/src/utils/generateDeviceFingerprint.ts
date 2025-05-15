export function generateDeviceFingerprint(): string {
  const key = "tt_device_fp";

  const existing = localStorage.getItem(key);
  if (existing) return existing;

  const components = [
    navigator.userAgent,
    navigator.language,
    "1920x1080", // ✅ fixed value to match extension
    "24", // ✅ fixed color depth to match extension
    new Date().getTimezoneOffset(),
    "Africa/Nairobi", // Optional fallback
  ];

  const raw = components.join("|");
  const hash = btoa(raw);
  localStorage.setItem(key, hash);
  return hash;
}
