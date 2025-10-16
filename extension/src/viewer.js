// src/viewer.js
import browser from "webextension-polyfill";
(async () => {
  const src = new URLSearchParams(location.search).get("src");
  if (!src) return;
  try {
    await browser.runtime.sendMessage({
      action: "setViewedUrlFromViewer",
      url: src,
    });
  } catch (e) {
    console.warn("Failed to setViewedUrlFromViewer:", e);
  }
  // your backend that proxies PDFs
  const BASE_URL = process.env.REACT_APP_BASE_URL;

  const proxied = `${BASE_URL}/api/proxy-pdf?url=${encodeURIComponent(src)}`;

  try {
    const resp = await fetch(proxied, { redirect: "follow" });
    if (!resp.ok) throw new Error(`proxy failed ${resp.status}`);

    const buf = await resp.arrayBuffer();
    if (!buf.byteLength) throw new Error("empty PDF");

    const blobUrl = URL.createObjectURL(
      new Blob([buf], { type: "application/pdf" })
    );
    document.getElementById("pdf").src = blobUrl;
  } catch (e) {
    console.error("PDF load error:", e);
    document.getElementById("wrap").textContent =
      "Failed to display PDF (see console).";
  }
  let reloadTimer = null;
  browser.runtime.onMessage.addListener((msg) => {
    if (msg?.action !== "taskcard:update") return;

    const { status } = msg.payload || {};
    console.log("🔄 taskcard:update →", msg.payload);

    // Debounced reload to avoid double refreshes
    if (status === "complete") {
      clearTimeout(reloadTimer);
      reloadTimer = setTimeout(() => {
        // Reload the extension page so popup.js re-runs and re-queries DB
        location.reload();
      }, 150);
    }
  });
})();
