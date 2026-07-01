import { useEffect, useState } from "react";

//const BASE_URL = import.meta.env.VITE_API_BASE_URL || "https://localhost:5001";
const BASE_URL = process.env.REACT_APP_BASE_URL;
export const useLastVisitedURL = () => {
  const [lastVisitedURL, setLastVisitedURL] = useState("");

  const fetchLastVisitedURL = async () => {
    try {
      const response = await fetch(`${BASE_URL}/api/get-last-visited-url`);
      const data = await response.json();

      setLastVisitedURL(data.url || "");
    } catch (err) {
      console.error("⚠️ Fetch error:", err);
    }
  };

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (!document.hidden) {
        fetchLastVisitedURL();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

  return lastVisitedURL;
};
