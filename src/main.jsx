import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import "./styles.css";

createRoot(document.getElementById("root")).render(
  <React.StrictMode><App /></React.StrictMode>
);

// Register the PWA worker so Chrome can offer Yaza AI as an installable app.
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(error => {
      console.error("Yaza AI service worker registration failed:", error);
    });
  });
}