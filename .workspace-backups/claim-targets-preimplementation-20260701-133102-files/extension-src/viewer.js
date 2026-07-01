// src/viewer.js
import browser from "webextension-polyfill";

(async () => {
  const src = new URLSearchParams(location.search).get("src");
  if (!src) return;

  let reloadTimer = null;
  const statusElement = document.getElementById("scrape-status");

  const setStatus = (status, error = null) => {
    const popupRoot = document.getElementById("tt-popup-host");
    if (status === "running") {
      if (popupRoot) popupRoot.style.display = "none";
      if (statusElement) {
        statusElement.textContent = "TruthTrollers evaluation running…";
        statusElement.style.display = "block";
      }
      return;
    }
    if (status === "failed") {
      if (statusElement) {
        statusElement.textContent = error
          ? `TruthTrollers evaluation failed: ${error}`
          : "TruthTrollers evaluation failed";
        statusElement.style.display = "block";
      }
      return;
    }
    if (status === "analysis-complete") {
      if (statusElement) {
        statusElement.textContent = "TruthTrollers analysis finished";
        statusElement.style.display = "block";
        setTimeout(() => { statusElement.style.display = "none"; }, 4000);
      }
      return;
    }
    if (statusElement) statusElement.style.display = "none";
  };

  // Install the receiver before the viewer sends its startup URL message.
  // The background may immediately publish CURRENT_URL_UPDATED in response.
  browser.runtime.onMessage.addListener((msg) => {
    if (msg?.action !== "taskcard:update") return;

    const { status } = msg.payload || {};
    console.log("🔄 taskcard:update →", msg.payload);
    setStatus(status, msg.payload?.error || null);

    if (status === "complete") {
      clearTimeout(reloadTimer);
      reloadTimer = setTimeout(() => {
        location.reload();
      }, 150);
    }
  });

  try {
    await browser.runtime.sendMessage({
      action: "setViewedUrlFromViewer",
      url: src,
    });
  } catch (e) {
    console.warn("Failed to setViewedUrlFromViewer:", e);
  }

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

  try {
    const stored = await browser.storage.local.get("scrapeStatuses");
    const current = stored.scrapeStatuses?.[src];
    if (current?.status) setStatus(current.status, current.error);
  } catch (error) {
    console.warn("Failed to load scrape status:", error);
  }
})();
