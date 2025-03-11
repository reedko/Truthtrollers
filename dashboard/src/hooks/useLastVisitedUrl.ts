import { useEffect } from "react";

const trackLastVisitedURL = () => {
  if (document.hidden) {
    const currentURL = window.location.href;

    // 🔍 Try to get the last visited URL
    const navEntries = window.performance.getEntriesByType(
      "navigation"
    ) as PerformanceNavigationTiming[];

    // 🛠 Get previous page URL using document.referrer (fallback)
    let lastURL = document.referrer;

    // 🛠 Attempt to get previous navigation source
    if (navEntries.length > 0) {
      const lastNav = navEntries[0];
      if (lastNav.type === "navigate" || lastNav.type === "reload") {
        lastURL = lastNav.name; // `name` stores the referring URL in some cases
      }
    }

    console.log(
      `👀 visibilitychange Event Fired: hidden (Leaving ${currentURL})`
    );
    console.log(`🛠 Detected last visited URL: ${lastURL}`);

    // ✅ Only store if it's an external site and not another dashboard page
    if (lastURL && !lastURL.includes("localhost:5173")) {
      console.log(`✅ Storing external URL: ${lastURL}`);
      localStorage.setItem("lastVisitedURL", lastURL);
    }
  }
};

export const useLastVisitedURL = () => {
  useEffect(() => {
    document.addEventListener("visibilitychange", trackLastVisitedURL);

    return () => {
      document.removeEventListener("visibilitychange", trackLastVisitedURL);
    };
  }, []);
};
