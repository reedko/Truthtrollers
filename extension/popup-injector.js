(function () {
  // Only inject once
  if (document.getElementById("tt-popup-image")) return;

  // Create overlay
  const overlay = document.createElement("div");
  overlay.id = "tt-popup-image";
  overlay.style.position = "fixed";
  overlay.style.top = "14px";
  overlay.style.right = "14px";
  overlay.style.zIndex = "2147483647";
  overlay.style.pointerEvents = "none";
  overlay.style.opacity = "0"; // <-- Start fully transparent!
  overlay.style.transition = "opacity 1.8s";
  overlay.style.background = "transparent";
  overlay.style.width = "200px";
  overlay.style.height = "280px";

  // Add the image
  const img = document.createElement("img");
  img.src = browser.runtime.getURL("assets/popup.png");
  img.alt = "Popup";
  img.style.width = "100%";
  img.style.height = "100%";
  img.style.objectFit = "contain";
  img.style.display = "block";
  img.style.borderRadius = "18px";
  img.style.boxShadow = "0 2px 12px 2px rgba(0,0,0,0.16)";
  overlay.appendChild(img);

  // Add to page after load, then fade in
  window.addEventListener("load", () => {
    document.body.appendChild(overlay);
    // Wait for next tick so browser registers initial opacity
    setTimeout(() => {
      overlay.style.opacity = "0.77";
    }, 50); // 50ms is usually enough, you can tweak it
  });
})();
