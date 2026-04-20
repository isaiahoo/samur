// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { ACHIEVEMENTS } from "@samur/shared";
import { useInstallPrompt, type InstallPlatform } from "../hooks/useInstallPrompt.js";
import { useUIStore } from "../store/ui.js";
import { getAchievementRarity } from "../services/api.js";

const INSTALL_ACHIEVEMENT = ACHIEVEMENTS.find((a) => a.key === "installed_pwa")!;

function formatInstallRarity(count: number | null): string {
  if (count == null) return "присоединитесь к соседям";
  if (count === 0) return "вы первый, кто её получит";
  if (count === 1) return "уже с 1 соседом";
  return `уже с ${count} соседями`;
}

/** Single controller that owns the install-prompt hook and renders
 * the two surfaces it drives: a persistent top banner (always
 * visible when installable) and a tap-to-open full-screen sheet.
 *
 * Keeping both in one component so the hook's state is a single
 * source of truth — otherwise `<TopBar />` and `<Sheet />` would each
 * call the hook and maintain independent dismissal state, making
 * "tap banner → sheet opens" impossible without an additional store. */
export function InstallPrompt() {
  const {
    platform,
    sheetVisible,
    bannerVisible,
    triggerNative,
    openSheet,
    closeSheet,
    dismissSheet,
    dismissBanner,
  } = useInstallPrompt();

  return (
    <>
      {bannerVisible && (
        <InstallTopBar
          onOpenSheet={openSheet}
          onDismiss={dismissBanner}
        />
      )}
      {sheetVisible && (
        <InstallSheet
          platform={platform}
          onTriggerNative={triggerNative}
          onDismiss={dismissSheet}
          onCloseOnly={closeSheet}
        />
      )}
    </>
  );
}

/** Compact persistent banner that sits above the app header. Design
 * brief: small, unobtrusive, taps to open the full guide. Gives users
 * a way to install later even after they dismissed the sheet once. */
function InstallTopBar({ onOpenSheet, onDismiss }: {
  onOpenSheet: () => void;
  onDismiss: () => void;
}) {
  return (
    <div className="install-bar" role="region" aria-label="Установка приложения">
      <button type="button" className="install-bar-body" onClick={onOpenSheet}>
        <span className="install-bar-icon" aria-hidden="true">
          <img src="/icons/icon-192.png?v=5" alt="" width="26" height="26" />
        </span>
        <span className="install-bar-text">
          <strong>Установите Кунак</strong>
          <span>Быстрый запуск с экрана</span>
        </span>
        <span className="install-bar-cta">Установить</span>
      </button>
      <button
        type="button"
        className="install-bar-close"
        onClick={onDismiss}
        aria-label="Скрыть"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
          <path d="M6 6l12 12M18 6L6 18" />
        </svg>
      </button>
    </div>
  );
}

interface SheetProps {
  platform: InstallPlatform;
  onTriggerNative: () => Promise<void>;
  onDismiss: () => void;
  onCloseOnly: () => void;
}

function InstallSheet({ platform, onTriggerNative, onDismiss, onCloseOnly }: SheetProps) {
  const showToast = useUIStore((s) => s.showToast);
  const [installing, setInstalling] = useState(false);
  const [rarityCount, setRarityCount] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    getAchievementRarity()
      .then((res) => {
        if (cancelled) return;
        const count = res.data?.rarity?.[INSTALL_ACHIEVEMENT.key];
        if (typeof count === "number") setRarityCount(count);
      })
      .catch(() => { /* non-fatal — we just omit the rarity line */ });
    return () => { cancelled = true; };
  }, []);

  const handleInstall = async () => {
    if (installing) return;
    setInstalling(true);
    try {
      await onTriggerNative();
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
      <div className="install-scrim" onClick={onCloseOnly} />
      <div className="install-sheet">
        <button
          type="button"
          className="install-close"
          onClick={onDismiss}
          aria-label="Закрыть"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>

        <div className="install-header">
          <div className="install-icon">
            <img src="/icons/icon-192.png?v=5" alt="Кунак" width="64" height="64" />
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

        <div className="install-reward">
          <div className={`install-reward-medal install-reward-medal--${INSTALL_ACHIEVEMENT.tier}`}>
            <img
              src={`/achievements/${INSTALL_ACHIEVEMENT.key}.webp`}
              alt=""
              decoding="async"
            />
          </div>
          <div className="install-reward-kicker">Награда</div>
          <div className="install-reward-name">«{INSTALL_ACHIEVEMENT.name}»</div>
          <div className="install-reward-rarity">{formatInstallRarity(rarityCount)}</div>
        </div>

        <PlatformBody
          platform={platform}
          onInstall={handleInstall}
          installing={installing}
          onCopyLink={copyLink}
          onLater={onDismiss}
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
