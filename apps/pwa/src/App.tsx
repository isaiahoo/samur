// SPDX-License-Identifier: AGPL-3.0-only
import { lazy, Suspense } from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { ErrorBoundary } from "./components/ErrorBoundary.js";
import { Layout } from "./components/Layout.js";
import { Spinner } from "./components/Spinner.js";

const LoginPage = lazy(() => import("./pages/LoginPage.js").then((m) => ({ default: m.LoginPage })));
const VkCallbackPage = lazy(() => import("./pages/VkCallbackPage.js").then((m) => ({ default: m.VkCallbackPage })));
const AdminPage = lazy(() => import("./pages/admin/AdminPage.js").then((m) => ({ default: m.AdminPage })));
const ProfilePage = lazy(() => import("./pages/ProfilePage.js").then((m) => ({ default: m.ProfilePage })));
const PrivacyPolicyPage = lazy(() => import("./pages/PrivacyPolicyPage.js").then((m) => ({ default: m.PrivacyPolicyPage })));

export function App() {
  return (
    <ErrorBoundary>
    <BrowserRouter>
      <Suspense fallback={<Spinner />}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/auth/vk/callback" element={<VkCallbackPage />} />
          <Route path="/admin" element={<AdminPage />} />
          <Route path="/profile/:id" element={<ProfilePage />} />
          <Route path="/privacy" element={<PrivacyPolicyPage />} />
          <Route path="*" element={<Layout />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
    </ErrorBoundary>
  );
}
