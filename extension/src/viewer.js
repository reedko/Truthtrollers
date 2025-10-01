// src/viewer.js
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
  const BACKEND_BASE = "http://localhost:3000";
  const proxied = `${BACKEND_BASE}/api/proxy-pdf?url=${encodeURIComponent(
    src
  )}`;

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
})();
