const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:5001";

export function buildAssetUrl(value?: string | null): string | undefined {
  if (!value) return undefined;
  if (/^https?:\/\//i.test(value)) return value;
  if (/^\/?assets\//i.test(value)) {
    const assetPath = value.replace(/^\/?assets\/+/i, "");
    return `${API_BASE_URL.replace(/\/+$/, "")}/api/assets/${assetPath}`;
  }
  return `${API_BASE_URL.replace(/\/+$/, "")}/${value.replace(/^\/+/, "")}`;
}
