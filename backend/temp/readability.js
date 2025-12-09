import { Readability } from "@mozilla/readability";
import { JSDOM } from "jsdom";

export const extractReadableText = (
  html,
  url = "https://placeholder.local"
) => {
  try {
    const dom = new JSDOM(html, { url }); // Required for base href resolution
    const article = new Readability(dom.window.document).parse();
    return article?.textContent || null;
  } catch (err) {
    console.warn("⚠️ Readability server-side failed:", err);
    return null;
  }
};
