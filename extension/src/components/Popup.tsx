import "./Popup.css";
import { ChakraProvider } from "@chakra-ui/react";
import React from "react";
import TaskCard from "./TaskCard";
import ReactDOM from "react-dom/client";

const Popup: React.FC = () => {
  // Directly access the state from Zustand store

  return (
    <ChakraProvider>
      <div>
        <TaskCard />
      </div>
    </ChakraProvider>
  );
};

const popupRoot = document.getElementById("popup-root");
if (popupRoot) {
  popupRoot.style.position = "fixed";
  popupRoot.style.top = "0";
  popupRoot.style.right = "0";
  popupRoot.style.zIndex = "9999";
  console.log("Found popup-root, rendering Popup component...");
  const root = ReactDOM.createRoot(popupRoot);

  root.render(<Popup />);
} else {
  console.error("popup-root not found, cannot render Popup");
}

export default Popup;
