// SPDX-License-Identifier: AGPL-3.0-only
import { useState } from "react";
import { createPortal } from "react-dom";
import { useInstallPrompt, type InstallPlatform } from "../hooks/useInstallPrompt.js";
import { useUIStore } from "../store/ui.js";

/** Bottom-sheet "Install Кунак" nudge.
 *
 * Rendered once at the Layout level via a portal. The hook decides
 * when it's eligible; this component renders the platform-specific
 * body for each of the four buckets (iOS Safari / iOS other / Android
 * native / Android manual). Desktop and already-standalone cases
 * short-circuit in the hook — we never render at all. */
export function InstallPromptSheet() {
  const { platform, visible, triggerNative, dismiss } = useInstallPrompt();
  const showToast = useUIStore((s) => s.showToast);
  const [installing, setInstalling] = useState(false);

  if (!visible) return null;

  const handleInstall = async () => {
    if (installing) return;
    setInstalling(true);
    try {
      await triggerNative();
    } finally {
      setInstalling(false);
    }
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.origin);
      showToast("Ссылка скопирована — вставьте её в Safari", "success");
    } catch {
      showToast("Скопируйте адрес и откройте его в Safari", "info");
    }
  };

  return createPortal(
    <div className="install-overlay" role="dialog" aria-modal="true" aria-labelledby="install-title">
      <div className="install-scrim" onClick={dismiss} />
      <div className="install-sheet">
        <button
          type="button"
          className="install-close"
          onClick={dismiss}
          aria-label="Закрыть"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>

        <div className="install-header">
          <div className="install-icon">
            <img src="/icons/icon-192.png?v=4" alt="Кунак" width="64" height="64" />
          </div>
          <h2 id="install-title" className="install-title">
            Установите Кунак на экран «Домой»
          </h2>
          <p className="install-subtitle">
            Быстрый запуск одним касанием и стабильная связь в кризисной ситуации.
          </p>
        </div>

        <ul className="install-benefits">
          <li>
            <BenefitIcon />
            <span>Открывается одним касанием с экрана</span>
          </li>
          <li>
            <BenefitIcon />
            <span>Работает как родное приложение — без адресной строки</span>
          </li>
          <li>
            <BenefitIcon />
            <span>Уведомления о SOS и заявках рядом с вами</span>
          </li>
        </ul>

        <PlatformBody
          platform={platform}
          onInstall={handleInstall}
          installing={installing}
          onCopyLink={copyLink}
          onLater={dismiss}
        />
      </div>
    </div>,
    document.body,
  );
}

function BenefitIcon() {
  return (
    <span className="install-benefit-icon" aria-hidden="true">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
        <path d="M20 6L9 17l-5-5" />
      </svg>
    </span>
  );
}

function PlatformBody({
  platform, onInstall, installing, onCopyLink, onLater,
}: {
  platform: InstallPlatform;
  onInstall: () => void;
  installing: boolean;
  onCopyLink: () => void;
  onLater: () => void;
}) {
  if (platform === "android-native") {
    return (
      <div className="install-body">
        <button
          type="button"
          className="install-primary"
          onClick={onInstall}
          disabled={installing}
        >
          {installing ? "Установка..." : "Установить"}
        </button>
        <button type="button" className="install-secondary" onClick={onLater}>
          Позже
        </button>
      </div>
    );
  }

  if (platform === "android-manual") {
    return (
      <div className="install-body">
        <ol className="install-steps">
          <li>
            Откройте меню браузера
            <span className="install-inline-icon"><ThreeDotsIcon /></span>
          </li>
          <li>
            Выберите <strong>«Установить приложение»</strong> или
            <strong> «На главный экран»</strong>
          </li>
          <li>Подтвердите — иконка появится на рабочем столе</li>
        </ol>
        <button type="button" className="install-primary" onClick={onLater}>
          Понятно
        </button>
      </div>
    );
  }

  if (platform === "ios-safari") {
    return (
      <div className="install-body">
        <ol className="install-steps">
          <li>
            Нажмите
            <span className="install-inline-icon"><IosShareIcon /></span>
            в нижней панели Safari
          </li>
          <li>
            Прокрутите и выберите <strong>«На экран „Домой"»</strong>
          </li>
          <li>
            Нажмите <strong>«Добавить»</strong> — Кунак появится на
            экране как приложение
          </li>
        </ol>
        <button type="button" className="install-primary" onClick={onLater}>
          Понятно
        </button>
      </div>
    );
  }

  if (platform === "ios-other") {
    return (
      <div className="install-body">
        <p className="install-prose">
          Установка на экран «Домой» доступна только в Safari. Откройте
          Кунак в Safari, затем нажмите <IosShareIcon inline /> и выберите
          «На экран „Домой"».
        </p>
        <button type="button" className="install-primary" onClick={onCopyLink}>
          Скопировать ссылку
        </button>
        <button type="button" className="install-secondary" onClick={onLater}>
          Позже
        </button>
      </div>
    );
  }

  return null;
}

function IosShareIcon({ inline = false }: { inline?: boolean }) {
  const size = inline ? 18 : 26;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="install-share-icon"
      aria-hidden="true"
    >
      <path d="M8 9V7a2 2 0 012-2h4a2 2 0 012 2v2" />
      <rect x="5" y="9" width="14" height="12" rx="2" />
      <path d="M12 15V3M8 7l4-4 4 4" />
    </svg>
  );
}

function ThreeDotsIcon() {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="currentColor"
      className="install-share-icon"
      aria-hidden="true"
    >
      <circle cx="12" cy="5" r="1.8" />
      <circle cx="12" cy="12" r="1.8" />
      <circle cx="12" cy="19" r="1.8" />
    </svg>
  );
}
