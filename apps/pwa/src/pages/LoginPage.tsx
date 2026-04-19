// SPDX-License-Identifier: AGPL-3.0-only
import { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { phoneRequest, phoneVerify, telegramInit, telegramCheck, updateProfile, ApiError } from "../services/api.js";
import { useAuthStore } from "../store/auth.js";
import { useUIStore } from "../store/ui.js";
import type { User } from "@samur/shared";
import { ConsentCheckboxes } from "../components/ConsentCheckboxes.js";

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
  const [step, setStep] = useState<"phone" | "code" | "profile">("phone");
  const [submitting, setSubmitting] = useState(false);
  const [tgLoading, setTgLoading] = useState(false);
  /** Set after telegramInit() returns a one-time token. Non-null means
   * the auth card is visible and we're polling for confirmation.
   * Carrying the token in state (vs a separate boolean) lets the <a>
   * href be a direct, gesture-safe tap — iOS Safari blocks window.open
   * / setTimeout-driven navigation but not a user-initiated anchor tap. */
  const [tgAuthToken, setTgAuthToken] = useState<string | null>(null);
  const [countdown, setCountdown] = useState(0);
  const [error, setError] = useState("");
  // 152-ФЗ consent — required at registration. Submit/social-login
  // buttons stay disabled until checked. Distribution is now implicit
  // in the policy text (single-checkbox UX).
  const [processingConsent, setProcessingConsent] = useState(false);

  const setAuth = useAuthStore((s) => s.setAuth);
  const showToast = useUIStore((s) => s.showToast);
  const navigate = useNavigate();
  const tgPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const codeInputRef = useRef<HTMLInputElement>(null);
  // Store token+user from verify so profile step can use them
  const pendingAuthRef = useRef<{ token: string; user: User } | null>(null);

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

  const cancelTgAuth = useCallback(() => {
    if (tgPollRef.current) {
      clearInterval(tgPollRef.current);
      tgPollRef.current = null;
    }
    setTgAuthToken(null);
    setTgLoading(false);
  }, []);

  const handleTelegramLogin = async () => {
    if (!processingConsent) return;
    setTgLoading(true);
    try {
      const res = await telegramInit({
        processing: processingConsent,
        distribution: true,
      });
      const { token } = res.data as { token: string };
      setTgAuthToken(token);
      setTgLoading(false);

      // Poll the server for confirmation. The user completes auth by
      // tapping the "Открыть Telegram" anchor in the card we now show —
      // that navigation is a direct user gesture, no popup blocker.
      let attempts = 0;
      const maxAttempts = 60;
      tgPollRef.current = setInterval(async () => {
        attempts++;
        if (attempts > maxAttempts) {
          cancelTgAuth();
          showToast("Время ожидания истекло. Попробуйте снова.", "error");
          return;
        }
        try {
          const check = await telegramCheck(token);
          const data = check.data as { status: string; token?: string; user?: User };
          if (data.status === "ok" && data.token && data.user) {
            if (tgPollRef.current) {
              clearInterval(tgPollRef.current);
              tgPollRef.current = null;
            }
            setTgAuthToken(null);
            setAuth(data.token, data.user);
            showToast("Вход выполнен через Telegram", "success");
            navigate("/");
          }
        } catch (err) {
          if (err instanceof ApiError && err.status === 404) {
            cancelTgAuth();
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
    if (!processingConsent) return;
    const codeVerifier = generateCodeVerifier();
    const codeChallenge = await generateCodeChallenge(codeVerifier);
    const state = crypto.randomUUID();

    sessionStorage.setItem("vk_code_verifier", codeVerifier);
    sessionStorage.setItem("vk_state", state);
    sessionStorage.setItem("vk_redirect_uri", VK_REDIRECT_URI);
    // VK redirects away — stash consent so VkCallbackPage can attach it
    // to the exchange. Server only writes ConsentLog on user-create.
    sessionStorage.setItem(
      "vk_consent",
      JSON.stringify({ processing: processingConsent, distribution: true }),
    );

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
    if (!phone.trim() || !processingConsent) return;
    setError("");
    // If cooldown is still active (e.g. user tapped "change" and came back),
    // go straight to code step without re-requesting
    if (countdown > 0) {
      setStep("code");
      setTimeout(() => codeInputRef.current?.focus(), 100);
      return;
    }
    setSubmitting(true);
    try {
      await phoneRequest(phone);
      setStep("code");
      startCountdown(120);
      showToast("Ожидайте звонок", "success");
      setTimeout(() => codeInputRef.current?.focus(), 100);
    } catch (err) {
      const msg = err instanceof ApiError
        ? err.message
        : "Ошибка отправки. Попробуйте ещё раз.";
      setError(msg);
      showToast(msg, "error");
    } finally {
      setSubmitting(false);
    }
  };

  const handleCodeVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    if (code.length < 4) return;
    setError("");
    setSubmitting(true);
    try {
      const res = await phoneVerify(phone, code, undefined, undefined, {
        processing: processingConsent,
        distribution: true,
      });
      const data = res.data as { token: string; user: User; isNew: boolean };

      if (data.isNew) {
        // New user — save auth data and show profile completion step
        pendingAuthRef.current = { token: data.token, user: data.user };
        setAuth(data.token, data.user);
        setStep("profile");
      } else {
        // Existing user — log in directly
        setAuth(data.token, data.user);
        showToast("С возвращением!", "success");
        navigate("/");
      }
    } catch (err) {
      const msg = err instanceof ApiError
        ? err.message
        : "Неверный код";
      setError(msg);
      showToast(msg, "error");
    } finally {
      setSubmitting(false);
    }
  };

  const handleProfileComplete = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      // Role is no longer chosen at signup — every user can both request and
      // offer help. We only send the name now.
      const data: { name?: string } = {};
      if (name.trim()) data.name = name.trim();
      if (!data.name) {
        // Nothing to save — skip the API call and proceed.
        navigate("/");
        return;
      }

      const res = await updateProfile(data);
      const updatedUser = res.data as User;

      const nextToken = res.token ?? useAuthStore.getState().token;
      if (nextToken) setAuth(nextToken, updatedUser);

      showToast("Добро пожаловать!", "success");
      navigate("/");
    } catch (err) {
      // Even if profile update fails, user is already authenticated
      showToast("Профиль сохранён", "success");
      navigate("/");
    } finally {
      setSubmitting(false);
    }
  };

  const handleSkipProfile = () => {
    showToast("Добро пожаловать!", "success");
    navigate("/");
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
      if (err instanceof ApiError) {
        showToast(err.message, "error");
      } else {
        showToast("Ошибка отправки", "error");
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleCodeChange = (value: string) => {
    // Only allow digits, max 6
    const digits = value.replace(/\D/g, "").slice(0, 6);
    setCode(digits);
  };

  return (
    <div className="login-page">
      <button
        className="login-back-btn"
        onClick={() => navigate(-1)}
        aria-label="Назад"
        type="button"
      >
        <svg width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
          <polyline points="15 18 9 12 15 6" />
        </svg>
      </button>
      <div className="login-card">
        <div className="login-header">
          <img src="/icons/icon-192.png?v=4" alt="" className="login-logo" width="150" height="150" />
          <h2>Кунак</h2>
          <p className="login-subtitle">
            {step === "profile" ? "Завершение регистрации" : "Вход и регистрация"}
          </p>
        </div>

        {/* Profile completion step — shown only for new users after code verification */}
        {step === "profile" && (
          <form onSubmit={handleProfileComplete} className="profile-form">
            <p className="profile-welcome">
              Вы успешно зарегистрировались! Как к вам обращаться?
            </p>

            <div className="form-group">
              <label htmlFor="login-name">Ваше имя</label>
              <input
                id="login-name"
                className="form-input"
                type="text"
                placeholder="Как вас зовут?"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoFocus
              />
            </div>

            <p className="profile-hint">
              Вы сможете и просить помощь, и откликаться на чужие заявки —
              одного аккаунта достаточно.
            </p>

            <button
              className="btn btn-primary btn-lg"
              type="submit"
              disabled={submitting}
            >
              {submitting ? "Сохранение..." : "Продолжить"}
            </button>

            <button
              type="button"
              className="btn-link profile-skip"
              onClick={handleSkipProfile}
            >
              Пропустить
            </button>
          </form>
        )}

        {/* Social Login — hidden during profile step */}
        {step !== "profile" && tgAuthToken && (
          <div className="tg-auth-card">
            <svg
              className="tg-auth-icon"
              width="40" height="40" viewBox="0 0 24 24" fill="#2aabee"
              aria-hidden="true"
            >
              <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.479.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/>
            </svg>
            <h3 className="tg-auth-title">Подтвердите вход</h3>
            <p className="tg-auth-body">
              Откройте Telegram и нажмите «Старт» в боте — мы подхватим
              подтверждение автоматически.
            </p>
            <a
              href={`tg://resolve?domain=${TG_BOT_NAME}&start=login_${tgAuthToken}`}
              className="btn-tg-login tg-auth-primary"
            >
              Открыть Telegram
            </a>
            <a
              href={`https://t.me/${TG_BOT_NAME}?start=login_${tgAuthToken}`}
              target="_blank"
              rel="noopener noreferrer"
              className="tg-auth-fallback"
            >
              Не открылось? Открыть в браузере
            </a>
            <div className="tg-auth-waiting" role="status" aria-live="polite">
              <span className="tg-auth-dots" aria-hidden="true">
                <span /><span /><span />
              </span>
              Ждём подтверждения…
            </div>
            <button
              type="button"
              className="btn-link tg-auth-cancel"
              onClick={cancelTgAuth}
            >
              Отменить
            </button>
          </div>
        )}

        {step !== "profile" && !tgAuthToken && (
          <>
            <ConsentCheckboxes
              processing={processingConsent}
              onProcessingChange={setProcessingConsent}
              disabled={submitting || tgLoading}
            />
            <div className="social-login-section">
              <button
                className="btn-vk-login"
                onClick={handleVkLogin}
                disabled={submitting || tgLoading || !processingConsent}
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
                disabled={submitting || tgLoading || !processingConsent}
                type="button"
              >
                <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.479.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/>
                </svg>
                {tgLoading ? "Подключение…" : "Войти через Telegram"}
              </button>
            </div>

            <div className="login-divider">
              <span>или</span>
            </div>
          </>
        )}

        {/* Phone Step — enter phone, request code */}
        {step === "phone" && !tgAuthToken && (
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

            {error && <p className="login-error">{error}</p>}

            <button
              className="btn btn-primary btn-lg"
              type="submit"
              disabled={submitting || tgLoading || !phone.trim() || !processingConsent}
            >
              {submitting ? "Отправка..." : "Получить код звонком"}
            </button>

            <p className="phone-hint">
              Вам поступит звонок. Введите последние 4 цифры номера.
            </p>
          </form>
        )}

        {/* Code Step — enter code only (no name/role here) */}
        {step === "code" && !tgAuthToken && (
          <form onSubmit={handleCodeVerify}>
            <p className="phone-code-info">
              Звонок на <strong>{phone}</strong>
              <button
                type="button"
                className="btn-link"
                onClick={() => { setStep("phone"); setCode(""); setError(""); }}
              >
                Изменить
              </button>
            </p>

            <div className="form-group">
              <label htmlFor="login-code">Код из входящего звонка</label>
              <input
                id="login-code"
                ref={codeInputRef}
                className="form-input code-input"
                type="text"
                inputMode="numeric"
                pattern="\d{4,6}"
                maxLength={6}
                required
                placeholder="0000"
                value={code}
                onChange={(e) => handleCodeChange(e.target.value)}
                autoComplete="one-time-code"
              />
            </div>

            {error && <p className="login-error">{error}</p>}

            <button
              className="btn btn-primary btn-lg"
              type="submit"
              disabled={submitting || code.length < 4}
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
