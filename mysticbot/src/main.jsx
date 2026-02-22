import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.jsx";

// Вызываем expand() до рендера React, чтобы Telegram WebApp сразу
// открылся на полный экран — иначе первый кадр рендерится на чёрном фоне
// компактного режима (пользователь видит чёрный экран на старте).
if (window.Telegram?.WebApp) {
  window.Telegram.WebApp.ready();
  window.Telegram.WebApp.expand();
}

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <App />
  </StrictMode>
);
