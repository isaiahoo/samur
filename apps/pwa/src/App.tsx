// SPDX-License-Identifier: AGPL-3.0-only
import { lazy, Suspense } from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { Layout } from "./components/Layout.js";
import { Spinner } from "./components/Spinner.js";

const MapPage = lazy(() => import("./pages/MapPage.js").then((m) => ({ default: m.MapPage })));
const HelpPage = lazy(() => import("./pages/HelpPage.js").then((m) => ({ default: m.HelpPage })));
const AlertsPage = lazy(() => import("./pages/AlertsPage.js").then((m) => ({ default: m.AlertsPage })));
const InfoPage = lazy(() => import("./pages/InfoPage.js").then((m) => ({ default: m.InfoPage })));
const LoginPage = lazy(() => import("./pages/LoginPage.js").then((m) => ({ default: m.LoginPage })));
const AdminPage = lazy(() => import("./pages/admin/AdminPage.js").then((m) => ({ default: m.AdminPage })));

export function App() {
  return (
    <BrowserRouter>
      <Suspense fallback={<Spinner />}>
        <Routes>
          <Route element={<Layout />}>
            <Route path="/" element={<MapPage />} />
            <Route path="/help" element={<HelpPage />} />
            <Route path="/alerts" element={<AlertsPage />} />
            <Route path="/info" element={<InfoPage />} />
          </Route>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/admin" element={<AdminPage />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}
