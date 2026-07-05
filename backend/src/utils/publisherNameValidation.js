const TRACKING_OR_CODE_NAME_RE = /(?:\b(?:params|searchparams|urlparams|queryparams)\s*\.\s*(?:utm_[a-z]+|get|set|append|delete)\b|\butm_(?:source|medium|campaign|term|content|id)\b|\b(?:fbclid|gclid|msclkid)\b|(?:^|\s)(?:const|let|var)\s+[a-z_$][\w$]*\s*=)/i;

export function cleanSourceEntityName(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .replace(/[®™]/g, "")
    .replace(/^\s*[:：\-–—|]\s*/, "")
    .replace(/\s*[•,:：\-–—|]\s*$/, "")
    .trim();
}

export function isTrackingOrCodePublisherName(value) {
  const name = cleanSourceEntityName(value);
  return Boolean(name && TRACKING_OR_CODE_NAME_RE.test(name));
}

export function isUsableSourceEntityName(value) {
  const name = cleanSourceEntityName(value);
  return Boolean(name && name.length >= 3 && name.length <= 255 && !isTrackingOrCodePublisherName(name));
}
