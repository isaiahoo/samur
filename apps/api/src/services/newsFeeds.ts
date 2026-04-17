// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Registry of curated news feeds for the Kunak flood relief platform.
 *
 * Each feed is verified to be active and relevant to Dagestan emergency/flood news.
 * Feeds are fetched periodically and stored in the news_articles table.
 *
 * Feed types:
 *   - "rss" — standard RSS/Atom feed, parsed with XML
 *   - "html" — structured HTML page, parsed with regex/DOM (phase 2)
 */

export interface NewsFeed {
  /** Unique feed identifier */
  id: string;
  /** Human-readable name (Russian) */
  name: string;
  /** Feed URL (RSS/Atom XML or HTML page) */
  url: string;
  /** Feed type */
  type: "rss" | "html";
  /** How often to fetch, in minutes */
  intervalMinutes: number;
  /** Priority: lower = more important, shown first when same timestamp */
  priority: number;
  /** If set, only keep articles matching these category substrings (case-insensitive) */
  categoryFilter?: string[];
  /** If set, only keep articles whose title/summary matches at least one keyword */
  keywordFilter?: string[];
  /** If set, reject articles whose title/summary matches any of these (applied after keywordFilter) */
  excludeKeywords?: string[];
  /** Whether this feed is currently enabled */
  enabled: boolean;
}

export const NEWS_FEEDS: NewsFeed[] = [
  // ── Tier 1: Essential — pure emergency content ────────────────────────
  {
    id: "mchs-dagestan-forecasts",
    name: "МЧС Дагестан — Прогнозы ЧС",
    url: "https://05.mchs.gov.ru/deyatelnost/press-centr/operativnaya-informaciya/prognozy/rss",
    type: "rss",
    intervalMinutes: 15,
    priority: 1,
    enabled: true,
    // No filters — every item is an emergency forecast, all relevant
  },
  {
    id: "ria-dagestan",
    name: "РИА Дагестан",
    url: "http://riadagestan.ru/rss",
    type: "rss",
    intervalMinutes: 15,
    priority: 2,
    keywordFilter: [
      // Flooding
      "паводок", "паводк", "наводнен", "подтоплен", "затоплен",
      "уровень воды", "река ", "дамб", "прорыв", "размыв",
      "водохранилищ", "водосброс", "плотин",
      // Emergency response
      "эвакуац", "МЧС", "спасат", "укрыти", "убежищ",
      "гуманитар", "помощь пострадав", "волонтер", "пострадавш",
      "бедстви", "катастроф", "чрезвычайн", "стихи",
      // Natural hazards
      "оползн", "сель", "ливень", "ливнев", "шторм",
      "снегопад", "снег", "лавин", "обрушен", "разруш",
      // Infrastructure damage
      "перекрыт", "отрезан", "обесточен",
    ],
    enabled: true,
  },

  // ── Tier 2: Supplementary — wire agencies with keyword filtering ──────
  {
    id: "interfax-south",
    name: "Интерфакс — Юг и Кавказ",
    url: "http://www.interfax-russia.ru/rss/public.rss",
    type: "rss",
    intervalMinutes: 30,
    priority: 3,
    keywordFilter: [
      // Major cities
      "Дагестан", "Дербент", "Махачкал", "Каспийск", "Буйнакск", "Хасавюрт", "Кизляр",
      // Mountain districts & towns (mudslide/landslide risk)
      "Уркарах", "Акуша", "Левашин", "Сергокала", "Гергебиль", "Гуниб",
      "Ботлих", "Цумада", "Тляратин", "Рутул", "Ахты", "Агул",
      "Хучни", "Кули", "Хунзах", "Цуриб", "Кубачи",
      // Emergency keywords (catch articles about Dagestan disasters even without city name)
      "сель", "оползень", "оползн", "паводок", "наводнен", "эвакуац",
    ],
    excludeKeywords: [
      // Sports
      "футбол", "матч", "тренер", "игрок", "чемпионат", "турнир", "лига",
      "Динамо", "Анжи", "Легион", "сборн", "гол ", "счёт ", "стадион",
      "оштрафова", "дисквалиф", "трансфер", "болельщик", "спортсмен",
      "борец", "боец", "UFC", "MMA", "ММА", "бокс", "самб", "дзюдо",
      // Entertainment / culture
      "концерт", "фестиваль", "кинотеатр", "фильм", "актёр", "актрис",
      "певец", "певиц", "шоу-бизнес", "клип", "альбом", "премьер",
      // Politics (non-emergency)
      "выбор", "депутат", "голосован", "партия", "фракци", "парламент",
      "законопроект", "сенатор",
      // Business / economy (non-emergency)
      "акци", "инвестиц", "биржа", "курс валют", "дивиденд",
    ],
    enabled: true,
  },
  {
    id: "tass",
    name: "ТАСС",
    url: "https://tass.ru/rss/v2.xml",
    type: "rss",
    intervalMinutes: 30,
    priority: 4,
    keywordFilter: [
      // Major cities
      "Дагестан", "Дербент", "Махачкал", "Каспийск", "Буйнакск", "Хасавюрт", "Кизляр",
      // Mountain districts & towns (mudslide/landslide risk)
      "Уркарах", "Акуша", "Левашин", "Сергокала", "Гергебиль", "Гуниб",
      "Ботлих", "Цумада", "Тляратин", "Рутул", "Ахты", "Агул",
      "Хучни", "Кули", "Хунзах", "Цуриб", "Кубачи",
      // Emergency keywords (catch articles about Dagestan disasters even without city name)
      "сель", "оползень", "оползн", "паводок", "наводнен", "эвакуац",
    ],
    excludeKeywords: [
      // Sports
      "футбол", "матч", "тренер", "игрок", "чемпионат", "турнир", "лига",
      "Динамо", "Анжи", "Легион", "сборн", "гол ", "счёт ", "стадион",
      "оштрафова", "дисквалиф", "трансфер", "болельщик", "спортсмен",
      "борец", "боец", "UFC", "MMA", "ММА", "бокс", "самб", "дзюдо",
      // Entertainment / culture
      "концерт", "фестиваль", "кинотеатр", "фильм", "актёр", "актрис",
      "певец", "певиц", "шоу-бизнес", "клип", "альбом", "премьер",
      // Politics (non-emergency)
      "выбор", "депутат", "голосован", "партия", "фракци", "парламент",
      "законопроект", "сенатор",
      // Business / economy (non-emergency)
      "акци", "инвестиц", "биржа", "курс валют", "дивиденд",
    ],
    enabled: true,
  },
];
