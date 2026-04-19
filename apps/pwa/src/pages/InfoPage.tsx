// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { UserActivitySnapshot } from "@samur/shared";
import { getUserStats } from "../services/api.js";
import { useAuthStore } from "../store/auth.js";
import { Spinner } from "../components/Spinner.js";
import {
  ProfileIdentity,
  ProfileStats,
  ProfileAchievements,
  type ProfileData,
} from "../components/ProfileBlocks.js";

export function InfoPage() {
  return (
    <div className="info-page">
      <ProfileSection />
      <EmergencyPhones />
      <SafetyGuide />
      <SheltersLink />
      <LegalLinks />
    </div>
  );
}

function ProfileSection() {
  const currentUser = useAuthStore((s) => s.user);
  const isLoggedIn = useAuthStore((s) => s.isLoggedIn)();
  const [data, setData] = useState<ProfileData | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!isLoggedIn || !currentUser?.id) {
      setData(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    getUserStats(currentUser.id)
      .then((res) => {
        if (!cancelled) setData(res.data as ProfileData);
      })
      .catch(() => {
        // Stats are optional enrichment; on failure we just hide them.
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [isLoggedIn, currentUser?.id]);

  const snapshot = useMemo<UserActivitySnapshot | null>(() => {
    if (!data) return null;
    return {
      helpsCompleted: data.helpsCompleted,
      requestsCreated: data.requestsCreated,
      joinedAt: data.joinedAt,
      helpsByCategory: data.helpsByCategory,
      avgResponseToOnWayMinutes: data.avgResponseToOnWayMinutes,
      installedPwa: data.installedPwa ?? false,
    };
  }, [data]);

  if (!isLoggedIn) {
    return (
      <section className="info-login-card">
        <div className="info-login-card-body">
          <h2>Станьте кунаком</h2>
          <p>
            Войдите, чтобы откликаться на запросы о помощи,
            отслеживать свои заявки и собирать награды сообщества.
          </p>
        </div>
        <Link to="/login" className="btn btn-primary info-login-btn">
          Войти или зарегистрироваться
        </Link>
      </section>
    );
  }

  if (loading && !data) {
    return (
      <section className="info-profile-loading"><Spinner /></section>
    );
  }

  if (!data) return null;

  return (
    <section className="info-profile">
      <ProfileIdentity data={data} />
      <ProfileStats data={data} />
      {snapshot && (
        <ProfileAchievements
          earned={new Set(data.achievements)}
          snapshot={snapshot}
        />
      )}
    </section>
  );
}

function EmergencyPhones() {
  return (
    <section className="info-section info-phones-section">
      <h3>Экстренные телефоны</h3>
      <div className="info-phones-row">
        <a href="tel:112" className="info-phone-chip info-phone-chip--primary">
          <strong>112</strong>
          <span>Спасение</span>
        </a>
        <a href="tel:101" className="info-phone-chip">
          <strong>101</strong>
          <span>Пожарные</span>
        </a>
        <a href="tel:102" className="info-phone-chip">
          <strong>102</strong>
          <span>Полиция</span>
        </a>
        <a href="tel:103" className="info-phone-chip">
          <strong>103</strong>
          <span>Скорая</span>
        </a>
      </div>
      <div className="info-phones-extra">
        <a href="tel:+78722674090" className="info-phone-row">
          <span className="info-phone-row-num">+7 (8722) 67-40-90</span>
          <span className="info-phone-row-label">МЧС Дагестана</span>
        </a>
        <a href="tel:+78722670521" className="info-phone-row">
          <span className="info-phone-row-num">+7 (8722) 67-05-21</span>
          <span className="info-phone-row-label">Горячая линия по наводнению</span>
        </a>
      </div>
    </section>
  );
}

interface AccordionItem {
  key: string;
  title: string;
  items: string[];
}

const SAFETY_SECTIONS: AccordionItem[] = [
  {
    key: "before",
    title: "До наводнения",
    items: [
      "Подготовьте тревожный чемоданчик: документы в водонепроницаемом пакете, вода, еда, фонарик, аптечка, зарядка для телефона",
      "Знайте маршруты эвакуации и расположение убежищ",
      "Переместите ценные вещи на верхние этажи",
      "Зарядите все устройства, портативные аккумуляторы",
      "Запасите питьевую воду (минимум 3 литра на человека в день)",
      "Наполните ванну водой для бытовых нужд",
    ],
  },
  {
    key: "during",
    title: "Во время наводнения",
    items: [
      "Поднимитесь на верхние этажи, на крышу — НЕ в подвал",
      "Отключите электричество и газ",
      "НЕ ходите по затопленным улицам — там могут быть открытые люки, провода",
      "НЕ пейте водопроводную воду — она может быть загрязнена",
      "Если вы в машине — не въезжайте в затопленную зону, 30 см воды сносит автомобиль",
      "Отправьте SOS через это приложение или по СМС на горячую линию",
    ],
  },
  {
    key: "after",
    title: "После наводнения",
    items: [
      "Не возвращайтесь домой, пока власти не дадут разрешение",
      "Сфотографируйте повреждения для страховки",
      "Не включайте электроприборы в затопленных помещениях",
      "Выбросьте все продукты, которые контактировали с водой",
      "Проветрите и просушите помещения",
      "Обратитесь за помощью через это приложение",
    ],
  },
];

function SafetyGuide() {
  const [openKey, setOpenKey] = useState<string | null>(null);
  return (
    <section className="info-section">
      <h3>Памятка по наводнению</h3>
      <div className="info-accordion">
        {SAFETY_SECTIONS.map((sec) => {
          const open = openKey === sec.key;
          return (
            <div key={sec.key} className={`info-accordion-item ${open ? "info-accordion-item--open" : ""}`}>
              <button
                type="button"
                className="info-accordion-header"
                aria-expanded={open}
                onClick={() => setOpenKey(open ? null : sec.key)}
              >
                <span>{sec.title}</span>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="info-accordion-chevron">
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              </button>
              {open && (
                <ul className="info-accordion-body">
                  {sec.items.map((item, i) => (
                    <li key={i}>{item}</li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function SheltersLink() {
  return (
    <section className="info-section">
      <Link to="/?layer=shelters" className="info-shelter-link">
        <div className="info-shelter-link-icon">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 12l9-9 9 9"/>
            <path d="M5 10v10a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1V10"/>
          </svg>
        </div>
        <div className="info-shelter-link-body">
          <div className="info-shelter-link-title">Убежища на карте</div>
          <div className="info-shelter-link-sub">Посмотреть ближайшие пункты и маршрут</div>
        </div>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="9 18 15 12 9 6" />
        </svg>
      </Link>
    </section>
  );
}

function LegalLinks() {
  return (
    <section className="info-section info-section--legal">
      <Link to="/privacy" className="info-legal-link">
        Политика конфиденциальности
      </Link>
    </section>
  );
}
