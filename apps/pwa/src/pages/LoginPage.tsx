// SPDX-License-Identifier: AGPL-3.0-only
import { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { phoneRequest, phoneVerify, telegramInit, telegramCheck, ApiError } from "../services/api.js";
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
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [step, setStep] = useState<"phone" | "code">("phone");
  const [submitting, setSubmitting] = useState(false);
  const [tgLoading, setTgLoading] = useState(false);
  const [tgPolling, setTgPolling] = useState(false);
  const [countdown, setCountdown] = useState(0);

  const setAuth = useAuthStore((s) => s.setAuth);
  const showToast = useUIStore((s) => s.showToast);
  const navigate = useNavigate();
  const tgPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const codeInputRef = useRef<HTMLInputElement>(null);

  // Clean up on unmount
  useEffect(() => {
    return () => {
      if (tgPollRef.current) clearInterval(tgPollRef.current);
      if (countdownRef.current) clearInterval(countdownRef.current);
    };
  }, []);

  const startCountdown = useCallback((seconds: number) => {
    setCountdown(seconds);
    if (countdownRef.current) clearInterval(countdownRef.current);
    countdownRef.current = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(countdownRef.current!);
          countdownRef.current = null;
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  }, []);

  const handleTelegramLogin = async () => {
    setTgLoading(true);
    try {
      const res = await telegramInit();
      const { token } = res.data as { token: string };

      const tgDeepLink = `tg://resolve?domain=${TG_BOT_NAME}&start=login_${token}`;
      const tgWebLink = `https://t.me/${TG_BOT_NAME}?start=login_${token}`;

      window.location.href = tgDeepLink;
      setTimeout(() => {
        if (document.hasFocus()) {
          window.open(tgWebLink, "_blank");
        }
      }, 1500);

      setTgPolling(true);
      let attempts = 0;
      const maxAttempts = 60;

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
        } catch (err) {
          if (err instanceof ApiError && err.status === 404) {
            clearInterval(tgPollRef.current!);
            tgPollRef.current = null;
            setTgPolling(false);
            setTgLoading(false);
            showToast("Время ожидания истекло. Попробуйте снова.", "error");
          }
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

  const handlePhoneRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!phone.trim()) return;
    setSubmitting(true);
    try {
      const res = await phoneRequest(phone);
      const data = res.data as { method: string; expiresIn: number };
      setStep("code");
      startCountdown(120); // 2 min cooldown for resend
      showToast("Ожидайте звонок", "success");
      // Focus code input after render
      setTimeout(() => codeInputRef.current?.focus(), 100);
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : "Ошибка отправки", "error");
    } finally {
      setSubmitting(false);
    }
  };

  const handleCodeVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    if (code.length !== 4) return;
    setSubmitting(true);
    try {
      const res = await phoneVerify(phone, code, name || undefined);
      const data = res.data as { token: string; user: User; isNew: boolean };
      setAuth(data.token, data.user);
      showToast("Вход выполнен", "success");
      navigate("/");
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : "Неверный код", "error");
    } finally {
      setSubmitting(false);
    }
  };

  const handleResend = async () => {
    if (countdown > 0) return;
    setSubmitting(true);
    try {
      await phoneRequest(phone);
      startCountdown(120);
      setCode("");
      showToast("Повторный звонок отправлен", "success");
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : "Ошибка", "error");
    } finally {
      setSubmitting(false);
    }
  };

  const handleCodeChange = (value: string) => {
    // Only allow digits, max 4
    const digits = value.replace(/\D/g, "").slice(0, 4);
    setCode(digits);
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

        {/* Phone + Call Verification */}
        {step === "phone" && (
          <form onSubmit={handlePhoneRequest}>
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
                autoComplete="tel"
              />
            </div>

            <button
              className="btn btn-primary btn-lg"
              type="submit"
              disabled={submitting || tgLoading || !phone.trim()}
            >
              {submitting ? "Отправка..." : "Получить код звонком"}
            </button>

            <p className="phone-hint">
              Вам поступит звонок. Введите последние 4 цифры номера.
            </p>
          </form>
        )}

        {step === "code" && (
          <form onSubmit={handleCodeVerify}>
            <p className="phone-code-info">
              Звонок на <strong>{phone}</strong>
              <button
                type="button"
                className="btn-link"
                onClick={() => { setStep("phone"); setCode(""); }}
              >
                Изменить
              </button>
            </p>

            <div className="form-group">
              <label htmlFor="login-code">Последние 4 цифры номера</label>
              <input
                id="login-code"
                ref={codeInputRef}
                className="form-input code-input"
                type="text"
                inputMode="numeric"
                pattern="\d{4}"
                maxLength={4}
                required
                placeholder="0000"
                value={code}
                onChange={(e) => handleCodeChange(e.target.value)}
                autoComplete="one-time-code"
              />
            </div>

            <div className="form-group">
              <label htmlFor="login-name">Имя (для новых пользователей)</label>
              <input
                id="login-name"
                className="form-input"
                type="text"
                placeholder="Ваше имя"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>

            <button
              className="btn btn-primary btn-lg"
              type="submit"
              disabled={submitting || code.length !== 4}
            >
              {submitting ? "Проверка..." : "Подтвердить"}
            </button>

            <div className="resend-section">
              {countdown > 0 ? (
                <p className="resend-timer">
                  Повторный звонок через {countdown} сек.
                </p>
              ) : (
                <button
                  type="button"
                  className="btn-link"
                  onClick={handleResend}
                  disabled={submitting}
                >
                  Отправить повторно
                </button>
              )}
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
