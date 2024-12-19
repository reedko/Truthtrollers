import React, { useEffect } from "react";

const HypothesisLoader = () => {
  useEffect(() => {
    const script = document.createElement("script");
    script.src = "https://hypothes.is/embed.js";
    script.async = true;
    document.body.appendChild(script);
    return () => {
      document.body.removeChild(script);
    };
  }, []);

  return null; // This component doesn't render anything visible
};

export default HypothesisLoader;
