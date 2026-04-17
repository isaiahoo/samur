// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { vkExchange } from "../services/api.js";
import { useAuthStore } from "../store/auth.js";
import { useUIStore } from "../store/ui.js";
import type { User } from "@samur/shared";

export function VkCallbackPage() {
  const [searchParams] = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();
  const setAuth = useAuthStore((s) => s.setAuth);
  const showToast = useUIStore((s) => s.showToast);

  useEffect(() => {
    const code = searchParams.get("code");
    const state = searchParams.get("state");
    const deviceId = searchParams.get("device_id") ?? undefined;

    // Retrieve PKCE verifier and state from sessionStorage
    const storedState = sessionStorage.getItem("vk_state");
    const codeVerifier = sessionStorage.getItem("vk_code_verifier");
    const redirectUri = sessionStorage.getItem("vk_redirect_uri");

    // Clean up stored values
    sessionStorage.removeItem("vk_state");
    sessionStorage.removeItem("vk_code_verifier");
    sessionStorage.removeItem("vk_redirect_uri");

    if (!code) {
      const errDesc = searchParams.get("error_description") || searchParams.get("error");
      setError(errDesc || "VK не вернул код авторизации");
      return;
    }

    if (!codeVerifier || !redirectUri) {
      setError("Данные авторизации не найдены. Попробуйте войти снова.");
      return;
    }

    if (state && storedState && state !== storedState) {
      setError("Ошибка безопасности (state mismatch). Попробуйте снова.");
      return;
    }

    // Exchange code for JWT
    (async () => {
      try {
        const res = await vkExchange({ code, codeVerifier, redirectUri, deviceId });
        const data = res.data as { token: string; user: User };
        setAuth(data.token, data.user);
        showToast("Вход выполнен через VK", "success");
        navigate("/", { replace: true });
      } catch (err) {
        setError(err instanceof Error ? err.message : "Ошибка входа через VK");
      }
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (error) {
    return (
      <div className="login-page">
        <div className="login-card">
          <div className="login-header">
            <h2>Ошибка входа</h2>
          </div>
          <p className="vk-callback-error">{error}</p>
          <button className="btn btn-primary btn-lg" onClick={() => navigate("/login", { replace: true })}>
            Вернуться к входу
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-header">
          <h2>Кунак</h2>
        </div>
        <p className="vk-callback-loading">Вход через VK...</p>
      </div>
    </div>
  );
}
