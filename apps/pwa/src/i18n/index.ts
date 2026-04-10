// SPDX-License-Identifier: AGPL-3.0-only
import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import ru from "./ru.json";
import en from "./en.json";

const savedLang = localStorage.getItem("samur:lang");

i18n.use(initReactI18next).init({
  resources: {
    ru: { translation: ru },
    en: { translation: en },
  },
  lng: savedLang ?? "ru",
  fallbackLng: "ru",
  interpolation: { escapeValue: false },
});

i18n.on("languageChanged", (lng) => {
  localStorage.setItem("samur:lang", lng);
  document.documentElement.lang = lng;
});

export default i18n;
