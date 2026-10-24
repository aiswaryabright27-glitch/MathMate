
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.jsx";
import PDFWriteMode from "./components/PDFWriteMode.jsx";

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <>
      <App />
      <PDFWriteMode />
    </>
  </StrictMode>
);
