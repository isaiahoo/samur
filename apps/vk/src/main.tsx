// SPDX-License-Identifier: AGPL-3.0-only
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { AdaptivityProvider, ConfigProvider } from "@vkontakte/vkui";
import "@vkontakte/vkui/dist/vkui.css";
import App from "./App";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ConfigProvider>
      <AdaptivityProvider>
        <App />
      </AdaptivityProvider>
    </ConfigProvider>
  </StrictMode>,
);
