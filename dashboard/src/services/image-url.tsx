import React from "react";
import noImage from "../assets/no-image-placeholder.webp";
import "../components/Popup.css";

const resizeImage = (newHeight: number, imgSource: string) => {
  const img = new Image();
  img.src = imgSource;
  const absheight = img.height;
  const abswidth = img.width;

  const newWidth = Math.round((abswidth / absheight) * newHeight);
  return (
    <div>
      <img
        className="popup-image"
        src={chrome.runtime.getURL(imgSource)}
        style={{ width: `${newWidth}px`, height: `${newHeight}px` }}
      />
    </div>
  );
};

export default resizeImage;
