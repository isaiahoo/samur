// SPDX-License-Identifier: AGPL-3.0-only
import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { login, register, telegramInit, telegramCheck } from "../services/api.js";
import { useAuthStore } from "../store/auth.js";
import { useUIStore } from "../store/ui.js";
import type { User } from "@samur/shared";

const TG_BOT_NAME = "samurchs_bot";
const VK_APP_ID = "54531890";
const VK_REDIRECT_URI = `${window.location.origin}/auth/vk/callback`;

/**
 * Generate PKCE code_verifier (43-128 chars, URL-safe base64)
 */
function generateCodeVerifier(): string {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return btoa(String.fromCharCode(...array))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/**
 * SHA-256 hash → base64url for PKCE code_challenge
 */
async function generateCodeChallenge(verifier: string): Promise<string> {
  const data = new TextEncoder().encode(verifier);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export function LoginPage() {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState("resident");
  const [submitting, setSubmitting] = useState(false);
  const [tgLoading, setTgLoading] = useState(false);
  const [tgPolling, setTgPolling] = useState(false);

  const setAuth = useAuthStore((s) => s.setAuth);
  const showToast = useUIStore((s) => s.showToast);
  const navigate = useNavigate();
  const tgPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Clean up polling on unmount
  useEffect(() => {
    return () => {
      if (tgPollRef.current) clearInterval(tgPollRef.current);
    };
  }, []);

  const handleTelegramLogin = async () => {
    setTgLoading(true);
    try {
      const res = await telegramInit();
      const { token } = res.data as { token: string };

      // Open Telegram app via tg:// protocol (bypasses t.me domain block in Russia)
      window.location.href = `tg://resolve?domain=${TG_BOT_NAME}&start=login_${token}`;

      // Start polling for auth completion
      setTgPolling(true);
      let attempts = 0;
      const maxAttempts = 60; // ~2 minutes at 2s intervals

      tgPollRef.current = setInterval(async () => {
        attempts++;
        if (attempts > maxAttempts) {
          clearInterval(tgPollRef.current!);
          tgPollRef.current = null;
          setTgPolling(false);
          setTgLoading(false);
          showToast("Время ожидания истекло. Попробуйте снова.", "error");
          return;
        }

        try {
          const check = await telegramCheck(token);
          const data = check.data as { status: string; token?: string; user?: User };
          if (data.status === "ok" && data.token && data.user) {
            clearInterval(tgPollRef.current!);
            tgPollRef.current = null;
            setTgPolling(false);
            setAuth(data.token, data.user);
            showToast("Вход выполнен через Telegram", "success");
            navigate("/");
          }
        } catch {
          // Token expired or error — stop polling
          clearInterval(tgPollRef.current!);
          tgPollRef.current = null;
          setTgPolling(false);
          setTgLoading(false);
        }
      }, 2000);
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Ошибка", "error");
      setTgLoading(false);
    }
  };

  const handleVkLogin = async () => {
    const codeVerifier = generateCodeVerifier();
    const codeChallenge = await generateCodeChallenge(codeVerifier);
    const state = crypto.randomUUID();

    // Store PKCE values for the callback page
    sessionStorage.setItem("vk_code_verifier", codeVerifier);
    sessionStorage.setItem("vk_state", state);
    sessionStorage.setItem("vk_redirect_uri", VK_REDIRECT_URI);

    const params = new URLSearchParams({
      response_type: "code",
      client_id: VK_APP_ID,
      redirect_uri: VK_REDIRECT_URI,
      scope: "phone vkid.personal_info",
      state,
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
    });

    window.location.href = `https://id.vk.com/authorize?${params.toString()}`;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      let res;
      if (mode === "login") {
        res = await login(phone, password);
      } else {
        res = await register(name, phone, password, role);
      }
      const data = res.data as { token: string; user: User };
      setAuth(data.token, data.user);
      showToast("Вход выполнен", "success");
      navigate("/");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Ошибка входа", "error");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-header">
          <h2>Самур</h2>
          <p className="login-subtitle">Координация помощи</p>
        </div>

        {/* Social Login */}
        <div className="social-login-section">
          <button
            className="btn-vk-login"
            onClick={handleVkLogin}
            disabled={submitting || tgLoading}
            type="button"
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12.785 16.241s.288-.032.436-.194c.136-.148.132-.427.132-.427s-.02-1.304.576-1.496c.588-.19 1.344 1.26 2.144 1.818.605.422 1.066.33 1.066.33l2.137-.03s1.117-.07.588-.964c-.043-.073-.308-.661-1.588-1.87-1.34-1.264-1.16-1.059.453-3.246.983-1.332 1.376-2.145 1.253-2.493-.117-.332-.84-.244-.84-.244l-2.406.015s-.178-.025-.31.056c-.13.079-.212.263-.212.263s-.382 1.03-.89 1.907c-1.07 1.85-1.499 1.948-1.674 1.834-.407-.267-.305-1.075-.305-1.648 0-1.79.267-2.536-.52-2.73-.262-.064-.454-.107-1.123-.114-.858-.009-1.585.003-1.996.208-.274.136-.485.44-.356.457.159.022.519.099.71.363.246.342.237 1.11.237 1.11s.142 2.11-.33 2.371c-.324.18-.768-.187-1.722-1.865-.489-.859-.858-1.81-.858-1.81s-.071-.178-.198-.273c-.154-.115-.369-.152-.369-.152l-2.286.015s-.343.01-.47.163c-.112.136-.009.418-.009.418s1.795 4.258 3.829 6.403c1.865 1.967 3.984 1.837 3.984 1.837h.96z" />
            </svg>
            Войти через VK
          </button>

          <button
            className="btn-tg-login"
            onClick={handleTelegramLogin}
            disabled={submitting || tgLoading}
            type="button"
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
              <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.479.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/>
            </svg>
            {tgPolling ? "Ожидание подтверждения..." : "Войти через Telegram"}
          </button>
        </div>

        <div className="login-divider">
          <span>или</span>
        </div>

        {/* Phone + Password */}
        <form onSubmit={handleSubmit}>
          {mode === "register" && (
            <div className="form-group">
              <label htmlFor="login-name">Имя</label>
              <input
                id="login-name"
                className="form-input"
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
          )}

          <div className="form-group">
            <label htmlFor="login-phone">Телефон</label>
            <input
              id="login-phone"
              className="form-input"
              type="tel"
              required
              placeholder="+79001234567"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
          </div>

          <div className="form-group">
            <label htmlFor="login-pass">Пароль</label>
            <input
              id="login-pass"
              className="form-input"
              type="password"
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>

          {mode === "register" && (
            <div className="form-group">
              <label htmlFor="login-role">Роль</label>
              <select
                id="login-role"
                className="form-input"
                value={role}
                onChange={(e) => setRole(e.target.value)}
              >
                <option value="resident">Житель</option>
                <option value="volunteer">Волонтёр</option>
              </select>
            </div>
          )}

          <button
            className="btn btn-primary btn-lg"
            type="submit"
            disabled={submitting || tgLoading}
          >
            {submitting
              ? "Загрузка..."
              : mode === "login"
                ? "Войти"
                : "Зарегистрироваться"}
          </button>
        </form>

        <p className="login-switch">
          {mode === "login" ? (
            <>
              Нет аккаунта?{" "}
              <button className="btn-link" onClick={() => setMode("register")}>
                Регистрация
              </button>
            </>
          ) : (
            <>
              Есть аккаунт?{" "}
              <button className="btn-link" onClick={() => setMode("login")}>
                Войти
              </button>
            </>
          )}
        </p>
      </div>
    </div>
  );
}
