// SPDX-License-Identifier: AGPL-3.0-only
import { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { login, register, telegramAuth } from "../services/api.js";
import { useAuthStore } from "../store/auth.js";
import { useUIStore } from "../store/ui.js";
import type { User } from "@samur/shared";

interface TelegramUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
  auth_date: number;
  hash: string;
}

const TG_BOT_NAME = "samurchs_bot";

export function LoginPage() {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState("resident");
  const [submitting, setSubmitting] = useState(false);
  const [tgLoading, setTgLoading] = useState(false);

  const setAuth = useAuthStore((s) => s.setAuth);
  const showToast = useUIStore((s) => s.showToast);
  const navigate = useNavigate();
  const tgContainerRef = useRef<HTMLDivElement>(null);

  const handleTelegramAuth = useCallback(
    async (tgUser: TelegramUser) => {
      setTgLoading(true);
      try {
        const res = await telegramAuth(tgUser);
        const data = res.data as { token: string; user: User };
        setAuth(data.token, data.user);
        showToast("Вход выполнен через Telegram", "success");
        navigate("/");
      } catch (err) {
        showToast(
          err instanceof Error ? err.message : "Ошибка входа через Telegram",
          "error",
        );
      } finally {
        setTgLoading(false);
      }
    },
    [setAuth, showToast, navigate],
  );

  // Load Telegram Login Widget
  useEffect(() => {
    // Expose callback globally for the widget
    (window as unknown as Record<string, unknown>).__onTelegramAuth = (
      user: TelegramUser,
    ) => {
      handleTelegramAuth(user);
    };

    const container = tgContainerRef.current;
    if (!container) return;

    // Clear previous widget
    container.innerHTML = "";

    const script = document.createElement("script");
    script.src = "https://telegram.org/js/telegram-widget.js?22";
    script.async = true;
    script.setAttribute("data-telegram-login", TG_BOT_NAME);
    script.setAttribute("data-size", "large");
    script.setAttribute("data-radius", "8");
    script.setAttribute("data-onauth", "__onTelegramAuth(user)");
    script.setAttribute("data-request-access", "write");
    container.appendChild(script);

    return () => {
      delete (window as unknown as Record<string, unknown>).__onTelegramAuth;
    };
  }, [handleTelegramAuth]);

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

        {/* Telegram Login */}
        <div className="social-login-section">
          <div
            ref={tgContainerRef}
            className="tg-login-container"
            style={{ minHeight: 40 }}
          />
          {tgLoading && (
            <p className="social-login-loading">Вход через Telegram...</p>
          )}
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
