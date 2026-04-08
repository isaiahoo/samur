// SPDX-License-Identifier: AGPL-3.0-only
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { login, register } from "../services/api.js";
import { useAuthStore } from "../store/auth.js";
import { useUIStore } from "../store/ui.js";
import type { User } from "@samur/shared";

export function LoginPage() {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState("resident");
  const [submitting, setSubmitting] = useState(false);

  const setAuth = useAuthStore((s) => s.setAuth);
  const showToast = useUIStore((s) => s.showToast);
  const navigate = useNavigate();

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
        <h2>{mode === "login" ? "Вход" : "Регистрация"}</h2>

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
              <select id="login-role" className="form-input" value={role} onChange={(e) => setRole(e.target.value)}>
                <option value="resident">Житель</option>
                <option value="volunteer">Волонтёр</option>
              </select>
            </div>
          )}

          <button className="btn btn-primary btn-lg" type="submit" disabled={submitting}>
            {submitting ? "Загрузка..." : mode === "login" ? "Войти" : "Зарегистрироваться"}
          </button>
        </form>

        <p className="login-switch">
          {mode === "login" ? (
            <>Нет аккаунта?{" "}<button className="btn-link" onClick={() => setMode("register")}>Регистрация</button></>
          ) : (
            <>Есть аккаунт?{" "}<button className="btn-link" onClick={() => setMode("login")}>Войти</button></>
          )}
        </p>
      </div>
    </div>
  );
}
