// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Flood damage scenario knowledge base for Dagestan rivers.
 *
 * Static data based on:
 * - Historical floods (2002 North Caucasus catastrophe, 2010/2015/2021 Samur events)
 * - HAZUS-MH depth-damage functions adapted for Dagestan building types
 * - Dagestan Census 2021 population data
 * - Agricultural statistics (irrigated area by river basin)
 * - Dam parameters (Chirkeyskaya 232m / 2.78 billion m³, Irganayskaya 101m / 705M m³)
 * - Return period probabilities: P = 1 - (1 - 1/T)^N
 */

export type ScenarioLevel = "moderate" | "severe" | "catastrophic";

export interface FloodScenario {
  river: string;
  scenarioId: ScenarioLevel;
  label: string;
  returnPeriod: string;
  peakDischargeM3s: number;
  description: string;
  populationAtRisk: number;
  buildingsAtRisk: number;
  agricultureHa: number;
  infrastructureItems: string[];
  estimatedDamageRub: number; // millions ₽
  historicalAnalogue: string | null;
  keySettlements: string[];
  probability10yr: number; // 0–1
}

// ── Терек (Terek) ─────────────────────────────────────────────────────────

const TEREK_SCENARIOS: FloodScenario[] = [
  {
    river: "Терек",
    scenarioId: "moderate",
    label: "Умеренный паводок",
    returnPeriod: "1 раз в 50 лет",
    peakDischargeM3s: 2800,
    description:
      "Подтопление низменных участков Кизлярского и Бабаюртовского районов. " +
      "Вода выходит на пойменные территории, затапливая сельскохозяйственные угодья. " +
      "Частичное подтопление окраин Кизляра. Эвакуация отдельных населённых пунктов.",
    populationAtRisk: 22_000,
    buildingsAtRisk: 3_500,
    agricultureHa: 18_000,
    infrastructureItems: [
      "Автодорога Кизляр–Бабаюрт (участки)",
      "Мосты через протоки Терека",
      "Насосные станции оросительных систем",
    ],
    estimatedDamageRub: 1_800,
    historicalAnalogue: "Паводок 2016 года",
    keySettlements: ["Кизляр (окраины)", "Бабаюрт", "Хасавюрт (пойма)"],
    probability10yr: 0.18,
  },
  {
    river: "Терек",
    scenarioId: "severe",
    label: "Серьёзный паводок",
    returnPeriod: "1 раз в 100 лет",
    peakDischargeM3s: 4200,
    description:
      "Масштабное затопление дельты Терека. Кизляр подтоплен на 30–40%. " +
      "Полное затопление пойменных сёл Бабаюртовского района. " +
      "Разрушение дорожной сети, повреждение мостов. " +
      "Сельскохозяйственные потери на всей низменности. " +
      "Требуется массовая эвакуация.",
    populationAtRisk: 80_000,
    buildingsAtRisk: 12_000,
    agricultureHa: 45_000,
    infrastructureItems: [
      "Автодорога Кизляр–Махачкала (перекрытие)",
      "Каргалинский гидроузел (перегрузка)",
      "Мосты через Терек (4 объекта)",
      "ЛЭП и подстанции низменности",
      "Канализационные и водозаборные сооружения Кизляра",
    ],
    estimatedDamageRub: 4_500,
    historicalAnalogue: "Паводок 2005 года",
    keySettlements: ["Кизляр", "Бабаюрт", "Хасавюрт", "Сулак (дельта)"],
    probability10yr: 0.10,
  },
  {
    river: "Терек",
    scenarioId: "catastrophic",
    label: "Катастрофический паводок",
    returnPeriod: "1 раз в 500 лет",
    peakDischargeM3s: 6500,
    description:
      "Катастрофическое наводнение масштаба 2002 года. " +
      "Полное затопление Кизлярской низменности. " +
      "Кизляр затоплен на 60–70%, эвакуация всего населения. " +
      "Разрушение Каргалинского гидроузла. " +
      "Десятки сёл полностью под водой. " +
      "Гибель скота, уничтожение урожая на всей низменности. " +
      "Восстановление — 3–5 лет.",
    populationAtRisk: 155_000,
    buildingsAtRisk: 28_000,
    agricultureHa: 62_000,
    infrastructureItems: [
      "Каргалинский гидроузел (разрушение)",
      "Все мосты через Терек в Дагестане",
      "Автодорога Кизляр–Махачкала (разрушение)",
      "Железная дорога (участок)",
      "Электросети всей низменности",
      "Водоснабжение и канализация Кизляра",
    ],
    estimatedDamageRub: 15_000,
    historicalAnalogue: "Катастрофа 2002 года",
    keySettlements: [
      "Кизляр",
      "Бабаюрт",
      "Хасавюрт",
      "Терекли-Мектеб",
      "Тарумовка",
    ],
    probability10yr: 0.02,
  },
];

// ── Сулак (Sulak) ────────────────────────────────────────────────────────

const SULAK_SCENARIOS: FloodScenario[] = [
  {
    river: "Сулак",
    scenarioId: "moderate",
    label: "Умеренный паводок",
    returnPeriod: "1 раз в 50 лет",
    peakDischargeM3s: 1200,
    description:
      "Повышение уровня ниже Миатлинской ГЭС. " +
      "Подтопление сельскохозяйственных угодий в низовьях. " +
      "Частичный выход воды на пойму у Кизилюрта. " +
      "Плотины каскада работают в штатном режиме сброса.",
    populationAtRisk: 8_000,
    buildingsAtRisk: 1_200,
    agricultureHa: 8_000,
    infrastructureItems: [
      "Оросительные каналы низовья",
      "Грунтовые дороги поймы",
    ],
    estimatedDamageRub: 600,
    historicalAnalogue: null,
    keySettlements: ["Кизилюрт (пойма)", "Сулак (посёлок)"],
    probability10yr: 0.18,
  },
  {
    river: "Сулак",
    scenarioId: "severe",
    label: "Серьёзный паводок",
    returnPeriod: "1 раз в 100 лет",
    peakDischargeM3s: 2500,
    description:
      "Аварийный сброс с Чиркейской и Миатлинской ГЭС. " +
      "Затопление значительной части Кизилюрта (пойменные кварталы). " +
      "Разрушение мостов через Сулак в низовьях. " +
      "Подтопление промышленных объектов.",
    populationAtRisk: 40_000,
    buildingsAtRisk: 6_000,
    agricultureHa: 18_000,
    infrastructureItems: [
      "Мосты через Сулак (3 объекта)",
      "Автодорога Кизилюрт–Махачкала (участки)",
      "Промзона Кизилюрта",
      "Оросительная инфраструктура",
    ],
    estimatedDamageRub: 3_200,
    historicalAnalogue: "Паводок 2019 года (частично)",
    keySettlements: ["Кизилюрт", "Сулак", "Чиркей"],
    probability10yr: 0.10,
  },
  {
    river: "Сулак",
    scenarioId: "catastrophic",
    label: "Прорыв плотины",
    returnPeriod: "Теоретический максимум",
    peakDischargeM3s: 80_000,
    description:
      "Катастрофический сценарий: разрушение арочной плотины Чиркейской ГЭС " +
      "(высота 232 м, объём водохранилища 2.78 млрд м³). " +
      "Волна прорыва достигает Кизилюрта за 1–3 часа. " +
      "Каскадное разрушение Миатлинской и Чирюртской ГЭС. " +
      "Полное уничтожение всего, что ниже по течению до Каспия. " +
      "Крупнейшая техногенная катастрофа на Кавказе.",
    populationAtRisk: 210_000,
    buildingsAtRisk: 35_000,
    agricultureHa: 25_000,
    infrastructureItems: [
      "Чиркейская ГЭС (1000 МВт)",
      "Миатлинская ГЭС (220 МВт)",
      "Чирюртская ГЭС (72 МВт)",
      "Кизилюрт — полное разрушение",
      "Все мосты и дороги долины Сулака",
      "Железная дорога Махачкала–Кизилюрт",
    ],
    estimatedDamageRub: 120_000,
    historicalAnalogue: null,
    keySettlements: [
      "Кизилюрт",
      "Сулак",
      "Чиркей",
      "Дубки",
      "Агачаул",
    ],
    probability10yr: 0.001,
  },
];

// ── Самур (Samur) ─────────────────────────────────────────────────────────

const SAMUR_SCENARIOS: FloodScenario[] = [
  {
    river: "Самур",
    scenarioId: "moderate",
    label: "Умеренный паводок",
    returnPeriod: "1 раз в 50 лет",
    peakDischargeM3s: 600,
    description:
      "Подъём уровня в среднем и нижнем течении. " +
      "Повреждение мостов у Ахты и Лучека. " +
      "Подтопление сельскохозяйственных угодий в долине. " +
      "Размыв берегов, угроза дорожной инфраструктуре.",
    populationAtRisk: 5_000,
    buildingsAtRisk: 800,
    agricultureHa: 3_000,
    infrastructureItems: [
      "Мост через Самур у Ахты",
      "Дорога Ахты–Магарамкент (участки)",
    ],
    estimatedDamageRub: 400,
    historicalAnalogue: "Паводок 2015 года",
    keySettlements: ["Ахты", "Лучек", "Касумкент"],
    probability10yr: 0.18,
  },
  {
    river: "Самур",
    scenarioId: "severe",
    label: "Серьёзный паводок",
    returnPeriod: "1 раз в 100 лет",
    peakDischargeM3s: 1200,
    description:
      "Масштабное наводнение в долине Самура. " +
      "Разрушение мостов, перекрытие автодорог. " +
      "Затопление сёл в нижнем течении. " +
      "Угроза Самурскому лесу (реликтовый лиановый лес). " +
      "Подтопление окраин Дербента через притоки.",
    populationAtRisk: 30_000,
    buildingsAtRisk: 4_500,
    agricultureHa: 8_000,
    infrastructureItems: [
      "Все мосты через Самур (5 объектов)",
      "Автодорога Ахты–Дербент",
      "Водозаборные сооружения",
      "Пограничная инфраструктура (граница с Азербайджаном)",
    ],
    estimatedDamageRub: 2_100,
    historicalAnalogue: "Паводок 2010 года",
    keySettlements: ["Ахты", "Магарамкент", "Касумкент", "Дербент (юг)"],
    probability10yr: 0.10,
  },
  {
    river: "Самур",
    scenarioId: "catastrophic",
    label: "Катастрофический паводок",
    returnPeriod: "1 раз в 500 лет",
    peakDischargeM3s: 2500,
    description:
      "Экстремальный паводок с селевыми потоками из горных притоков. " +
      "Полное разрушение дорожной сети южного Дагестана. " +
      "Уничтожение Самурского леса. " +
      "Затопление дельты, трансграничное наводнение (Азербайджан). " +
      "Изоляция горных сёл на недели.",
    populationAtRisk: 65_000,
    buildingsAtRisk: 9_000,
    agricultureHa: 12_000,
    infrastructureItems: [
      "Вся дорожная сеть южного Дагестана",
      "Самурский лес (реликтовый массив)",
      "Пограничные переходы",
      "Электросети Магарамкентского района",
      "Водоснабжение сёл нижнего течения",
    ],
    estimatedDamageRub: 8_500,
    historicalAnalogue: "Паводок 2021 года (×3)",
    keySettlements: [
      "Ахты",
      "Магарамкент",
      "Касумкент",
      "Дербент",
      "Белиджи",
    ],
    probability10yr: 0.02,
  },
];

// ── Аварское Койсу ────────────────────────────────────────────────────────

const AVARSKOE_SCENARIOS: FloodScenario[] = [
  {
    river: "Аварское Койсу",
    scenarioId: "moderate",
    label: "Умеренный паводок",
    returnPeriod: "1 раз в 50 лет",
    peakDischargeM3s: 700,
    description:
      "Подъём уровня в ущелье. Размыв горных дорог. " +
      "Подтопление сёл у Красного Моста. " +
      "Повышенный приток в Чиркейское водохранилище.",
    populationAtRisk: 3_000,
    buildingsAtRisk: 500,
    agricultureHa: 1_200,
    infrastructureItems: [
      "Горные дороги (участки)",
      "Мост у Красного Моста",
    ],
    estimatedDamageRub: 250,
    historicalAnalogue: null,
    keySettlements: ["Гергебиль", "Красный Мост"],
    probability10yr: 0.18,
  },
  {
    river: "Аварское Койсу",
    scenarioId: "severe",
    label: "Серьёзный паводок",
    returnPeriod: "1 раз в 100 лет",
    peakDischargeM3s: 1400,
    description:
      "Разрушительный паводок в ущелье. " +
      "Селевые потоки из боковых притоков. " +
      "Разрушение мостов и участков дорог. " +
      "Изоляция горных сёл. " +
      "Критическая нагрузка на Ирганайское водохранилище.",
    populationAtRisk: 12_000,
    buildingsAtRisk: 1_800,
    agricultureHa: 2_500,
    infrastructureItems: [
      "Дорога Махачкала–Ботлих",
      "Мосты ущелья (6 объектов)",
      "Ирганайская ГЭС (повышенный приток)",
    ],
    estimatedDamageRub: 1_200,
    historicalAnalogue: "Паводок 2017 года",
    keySettlements: ["Гергебиль", "Унцукуль", "Ирганай"],
    probability10yr: 0.10,
  },
  {
    river: "Аварское Койсу",
    scenarioId: "catastrophic",
    label: "Катастрофический паводок",
    returnPeriod: "1 раз в 500 лет",
    peakDischargeM3s: 3000,
    description:
      "Катастрофический паводок с массовыми оползнями и селями. " +
      "Возможное образование завальных озёр (как Ботлихская катастрофа). " +
      "Полное разрушение дорожной инфраструктуры ущелья. " +
      "Переполнение Ирганайского водохранилища → каскадный эффект на Сулак.",
    populationAtRisk: 30_000,
    buildingsAtRisk: 4_500,
    agricultureHa: 4_000,
    infrastructureItems: [
      "Ирганайская ГЭС (400 МВт) — аварийный режим",
      "Вся дорожная сеть ущелья",
      "Сёла на склонах (оползни)",
      "Водоснабжение горных районов",
    ],
    estimatedDamageRub: 5_000,
    historicalAnalogue: null,
    keySettlements: ["Гергебиль", "Унцукуль", "Ирганай", "Гимры", "Ботлих"],
    probability10yr: 0.02,
  },
];

// ── Андийское Койсу ───────────────────────────────────────────────────────

const ANDIYSKOE_SCENARIOS: FloodScenario[] = [
  {
    river: "Андийское Койсу",
    scenarioId: "moderate",
    label: "Умеренный паводок",
    returnPeriod: "1 раз в 50 лет",
    peakDischargeM3s: 550,
    description:
      "Подъём уровня в каньоне. Размыв дорог у Чиркоты. " +
      "Локальное подтопление пойменных участков.",
    populationAtRisk: 2_500,
    buildingsAtRisk: 400,
    agricultureHa: 800,
    infrastructureItems: [
      "Дорога у Чиркоты",
      "Мосты через Андийское Койсу",
    ],
    estimatedDamageRub: 180,
    historicalAnalogue: null,
    keySettlements: ["Чиркота", "Ботлих"],
    probability10yr: 0.18,
  },
  {
    river: "Андийское Койсу",
    scenarioId: "severe",
    label: "Серьёзный паводок",
    returnPeriod: "1 раз в 100 лет",
    peakDischargeM3s: 1100,
    description:
      "Разрушительный поток через каньон. " +
      "Обрушение участков дорог, повреждение мостов. " +
      "Повышенный приток в Сулакский бассейн. " +
      "Изоляция высокогорных аулов.",
    populationAtRisk: 8_000,
    buildingsAtRisk: 1_200,
    agricultureHa: 1_500,
    infrastructureItems: [
      "Дорога Ботлих–Махачкала (участки)",
      "Мосты через каньон (4 объекта)",
      "Электросети горных сёл",
    ],
    estimatedDamageRub: 800,
    historicalAnalogue: null,
    keySettlements: ["Чиркота", "Ботлих", "Агвали"],
    probability10yr: 0.10,
  },
];

// ── Шура-Озень ────────────────────────────────────────────────────────────

const SHURA_SCENARIOS: FloodScenario[] = [
  {
    river: "Шура-Озень",
    scenarioId: "moderate",
    label: "Умеренный паводок",
    returnPeriod: "1 раз в 50 лет",
    peakDischargeM3s: 120,
    description:
      "Подтопление низинных кварталов Буйнакска. " +
      "Выход воды на городские улицы. " +
      "Затопление подвалов и первых этажей в пойменной зоне.",
    populationAtRisk: 15_000,
    buildingsAtRisk: 2_200,
    agricultureHa: 500,
    infrastructureItems: [
      "Городские мосты Буйнакска",
      "Канализационная система",
    ],
    estimatedDamageRub: 350,
    historicalAnalogue: null,
    keySettlements: ["Буйнакск"],
    probability10yr: 0.18,
  },
  {
    river: "Шура-Озень",
    scenarioId: "severe",
    label: "Серьёзный паводок",
    returnPeriod: "1 раз в 100 лет",
    peakDischargeM3s: 250,
    description:
      "Масштабное затопление Буйнакска. " +
      "Селевые потоки с окружающих склонов усиливают разрушения. " +
      "Повреждение жилых домов, затопление промзоны. " +
      "Перекрытие автодороги на Махачкалу.",
    populationAtRisk: 35_000,
    buildingsAtRisk: 5_000,
    agricultureHa: 1_200,
    infrastructureItems: [
      "Автодорога Буйнакск–Махачкала",
      "Городская инфраструктура Буйнакска",
      "Промышленные объекты",
    ],
    estimatedDamageRub: 1_500,
    historicalAnalogue: "Паводок 2017 года",
    keySettlements: ["Буйнакск", "Атланаул"],
    probability10yr: 0.10,
  },
  {
    river: "Шура-Озень",
    scenarioId: "catastrophic",
    label: "Катастрофический паводок",
    returnPeriod: "1 раз в 500 лет",
    peakDischargeM3s: 500,
    description:
      "Экстремальный ливневый паводок + сель. " +
      "Буйнакск затоплен на 40–50%. " +
      "Разрушение зданий потоком грязи и камней. " +
      "Полная изоляция города. Жертвы неизбежны.",
    populationAtRisk: 55_000,
    buildingsAtRisk: 8_000,
    agricultureHa: 2_000,
    infrastructureItems: [
      "Все дороги к Буйнакску",
      "Городская инфраструктура (полная)",
      "Электроснабжение",
      "Водоснабжение и канализация",
    ],
    estimatedDamageRub: 5_500,
    historicalAnalogue: null,
    keySettlements: ["Буйнакск", "Атланаул", "Нижний Дженгутай"],
    probability10yr: 0.02,
  },
];

// ── Аксай ─────────────────────────────────────────────────────────────────

const AKSAY_SCENARIOS: FloodScenario[] = [
  {
    river: "Аксай",
    scenarioId: "moderate",
    label: "Умеренный паводок",
    returnPeriod: "1 раз в 50 лет",
    peakDischargeM3s: 180,
    description:
      "Подтопление пригородных территорий Хасавюрта. " +
      "Затопление сельскохозяйственных угодий вдоль русла.",
    populationAtRisk: 8_000,
    buildingsAtRisk: 1_300,
    agricultureHa: 2_000,
    infrastructureItems: [
      "Мосты через Аксай в Хасавюрте",
      "Пригородные дороги",
    ],
    estimatedDamageRub: 300,
    historicalAnalogue: null,
    keySettlements: ["Хасавюрт (пригород)"],
    probability10yr: 0.18,
  },
  {
    river: "Аксай",
    scenarioId: "severe",
    label: "Серьёзный паводок",
    returnPeriod: "1 раз в 100 лет",
    peakDischargeM3s: 350,
    description:
      "Затопление городских кварталов Хасавюрта у реки. " +
      "Разрушение мостов, перекрытие дорог. " +
      "Сток усиливает паводок на Тереке ниже по течению.",
    populationAtRisk: 32_000,
    buildingsAtRisk: 4_800,
    agricultureHa: 4_500,
    infrastructureItems: [
      "Городские мосты Хасавюрта",
      "Автодорога Хасавюрт–Махачкала (участки)",
      "Городская канализация",
    ],
    estimatedDamageRub: 1_800,
    historicalAnalogue: null,
    keySettlements: ["Хасавюрт", "Эндирей"],
    probability10yr: 0.10,
  },
];

// ── Малые реки (moderate + severe only) ──────────────────────────────────

const KAZIKUMUKH_SCENARIOS: FloodScenario[] = [
  {
    river: "Казикумухское Койсу",
    scenarioId: "moderate",
    label: "Умеренный паводок",
    returnPeriod: "1 раз в 50 лет",
    peakDischargeM3s: 200,
    description:
      "Размыв горных дорог, подтопление сёл в ущелье у Кули. " +
      "Повышенный приток в систему Сулака.",
    populationAtRisk: 2_000,
    buildingsAtRisk: 350,
    agricultureHa: 600,
    infrastructureItems: ["Горные дороги", "Мост у Кули"],
    estimatedDamageRub: 150,
    historicalAnalogue: null,
    keySettlements: ["Кули", "Кумух"],
    probability10yr: 0.18,
  },
  {
    river: "Казикумухское Койсу",
    scenarioId: "severe",
    label: "Серьёзный паводок",
    returnPeriod: "1 раз в 100 лет",
    peakDischargeM3s: 450,
    description:
      "Разрушение дорожной сети ущелья. Изоляция горных сёл. " +
      "Селевые потоки из боковых притоков.",
    populationAtRisk: 6_000,
    buildingsAtRisk: 900,
    agricultureHa: 1_000,
    infrastructureItems: [
      "Дорога в Лакский район",
      "Мосты ущелья",
      "Электроснабжение сёл",
    ],
    estimatedDamageRub: 500,
    historicalAnalogue: null,
    keySettlements: ["Кули", "Кумух", "Вачи"],
    probability10yr: 0.10,
  },
];

const KARA_SCENARIOS: FloodScenario[] = [
  {
    river: "Кара-Койсу",
    scenarioId: "moderate",
    label: "Умеренный паводок",
    returnPeriod: "1 раз в 50 лет",
    peakDischargeM3s: 280,
    description:
      "Подтопление Гергебиля и окрестных сёл. " +
      "Размыв берегов, повреждение дорог.",
    populationAtRisk: 3_000,
    buildingsAtRisk: 500,
    agricultureHa: 800,
    infrastructureItems: ["Мост у Гергебиля", "Горные дороги"],
    estimatedDamageRub: 200,
    historicalAnalogue: null,
    keySettlements: ["Гергебиль"],
    probability10yr: 0.18,
  },
  {
    river: "Кара-Койсу",
    scenarioId: "severe",
    label: "Серьёзный паводок",
    returnPeriod: "1 раз в 100 лет",
    peakDischargeM3s: 600,
    description:
      "Разрушительный паводок с селевыми потоками. " +
      "Изоляция Гергебиля. Каскадный эффект на Аварское Койсу → Сулак.",
    populationAtRisk: 8_000,
    buildingsAtRisk: 1_200,
    agricultureHa: 1_500,
    infrastructureItems: [
      "Все дороги к Гергебилю",
      "Гергебильская плотина (перегрузка)",
      "Электросети",
    ],
    estimatedDamageRub: 700,
    historicalAnalogue: null,
    keySettlements: ["Гергебиль", "Хаджалмахи"],
    probability10yr: 0.10,
  },
];

const ULLUCHAY_SCENARIOS: FloodScenario[] = [
  {
    river: "Уллучай",
    scenarioId: "moderate",
    label: "Умеренный паводок",
    returnPeriod: "1 раз в 50 лет",
    peakDischargeM3s: 300,
    description:
      "Подтопление Каякента и прибрежных территорий. " +
      "Затопление сельскохозяйственных угодий.",
    populationAtRisk: 4_000,
    buildingsAtRisk: 600,
    agricultureHa: 2_000,
    infrastructureItems: ["Мост у Каякента", "Прибрежная дорога"],
    estimatedDamageRub: 250,
    historicalAnalogue: null,
    keySettlements: ["Каякент"],
    probability10yr: 0.18,
  },
  {
    river: "Уллучай",
    scenarioId: "severe",
    label: "Серьёзный паводок",
    returnPeriod: "1 раз в 100 лет",
    peakDischargeM3s: 600,
    description:
      "Масштабное затопление Каякентского района. " +
      "Разрушение прибрежной инфраструктуры. " +
      "Сельскохозяйственные потери.",
    populationAtRisk: 10_000,
    buildingsAtRisk: 1_500,
    agricultureHa: 4_000,
    infrastructureItems: [
      "Автодорога вдоль побережья",
      "Мосты Каякентского района",
      "Оросительные системы",
    ],
    estimatedDamageRub: 800,
    historicalAnalogue: "Паводок 2012 года",
    keySettlements: ["Каякент", "Новокаякент"],
    probability10yr: 0.10,
  },
];

const RUBAS_SCENARIOS: FloodScenario[] = [
  {
    river: "Рубас",
    scenarioId: "moderate",
    label: "Умеренный паводок",
    returnPeriod: "1 раз в 50 лет",
    peakDischargeM3s: 150,
    description:
      "Подтопление южных окраин Дербента. " +
      "Выход воды на городские территории в районе устья.",
    populationAtRisk: 5_000,
    buildingsAtRisk: 800,
    agricultureHa: 500,
    infrastructureItems: ["Мост через Рубас", "Городские коллекторы"],
    estimatedDamageRub: 300,
    historicalAnalogue: null,
    keySettlements: ["Дербент (юг)"],
    probability10yr: 0.18,
  },
  {
    river: "Рубас",
    scenarioId: "severe",
    label: "Серьёзный паводок",
    returnPeriod: "1 раз в 100 лет",
    peakDischargeM3s: 300,
    description:
      "Затопление жилых кварталов южного Дербента. " +
      "Повреждение исторических объектов (крепость Нарын-Кала в зоне риска). " +
      "Перекрытие федеральной трассы.",
    populationAtRisk: 15_000,
    buildingsAtRisk: 2_200,
    agricultureHa: 1_000,
    infrastructureItems: [
      "Федеральная трасса (участок)",
      "Городская инфраструктура Дербента",
      "Исторические памятники",
    ],
    estimatedDamageRub: 1_200,
    historicalAnalogue: "Паводок 2012 года",
    keySettlements: ["Дербент"],
    probability10yr: 0.10,
  },
];

const GYULGERICHAY_SCENARIOS: FloodScenario[] = [
  {
    river: "Гюльгеричай",
    scenarioId: "moderate",
    label: "Умеренный паводок",
    returnPeriod: "1 раз в 50 лет",
    peakDischargeM3s: 120,
    description:
      "Подтопление Магарамкента и прилегающих территорий. " +
      "Затопление садов и виноградников.",
    populationAtRisk: 3_000,
    buildingsAtRisk: 450,
    agricultureHa: 1_500,
    infrastructureItems: ["Мост у Магарамкента", "Сельские дороги"],
    estimatedDamageRub: 180,
    historicalAnalogue: null,
    keySettlements: ["Магарамкент"],
    probability10yr: 0.18,
  },
  {
    river: "Гюльгеричай",
    scenarioId: "severe",
    label: "Серьёзный паводок",
    returnPeriod: "1 раз в 100 лет",
    peakDischargeM3s: 250,
    description:
      "Масштабное затопление Магарамкентского района. " +
      "Уничтожение виноградников и садов. " +
      "Повреждение дороги на Дербент.",
    populationAtRisk: 8_000,
    buildingsAtRisk: 1_100,
    agricultureHa: 3_000,
    infrastructureItems: [
      "Дорога Магарамкент–Дербент",
      "Оросительные системы",
      "Сельские мосты",
    ],
    estimatedDamageRub: 600,
    historicalAnalogue: null,
    keySettlements: ["Магарамкент", "Приморский"],
    probability10yr: 0.10,
  },
];

const AKTASH_SCENARIOS: FloodScenario[] = [
  {
    river: "Акташ",
    scenarioId: "moderate",
    label: "Умеренный паводок",
    returnPeriod: "1 раз в 50 лет",
    peakDischargeM3s: 90,
    description:
      "Подтопление территорий у Манаса. " +
      "Затопление прибрежных сельхозугодий.",
    populationAtRisk: 2_000,
    buildingsAtRisk: 300,
    agricultureHa: 800,
    infrastructureItems: ["Мост у Манаса", "Сельские дороги"],
    estimatedDamageRub: 100,
    historicalAnalogue: null,
    keySettlements: ["Манас"],
    probability10yr: 0.18,
  },
  {
    river: "Акташ",
    scenarioId: "severe",
    label: "Серьёзный паводок",
    returnPeriod: "1 раз в 100 лет",
    peakDischargeM3s: 180,
    description:
      "Затопление Манаса и окрестностей. " +
      "Повреждение прибрежной инфраструктуры.",
    populationAtRisk: 5_000,
    buildingsAtRisk: 700,
    agricultureHa: 1_500,
    infrastructureItems: [
      "Прибрежная автодорога",
      "Мосты",
      "Оросительные каналы",
    ],
    estimatedDamageRub: 350,
    historicalAnalogue: null,
    keySettlements: ["Манас", "Каякент (окрестности)"],
    probability10yr: 0.10,
  },
];

const MANAS_SCENARIOS: FloodScenario[] = [
  {
    river: "Манас-Озень",
    scenarioId: "moderate",
    label: "Умеренный паводок",
    returnPeriod: "1 раз в 50 лет",
    peakDischargeM3s: 70,
    description:
      "Подтопление окраин Каспийска у русла. " +
      "Затопление рекреационных зон.",
    populationAtRisk: 3_000,
    buildingsAtRisk: 400,
    agricultureHa: 300,
    infrastructureItems: ["Городские мосты", "Набережная"],
    estimatedDamageRub: 200,
    historicalAnalogue: null,
    keySettlements: ["Каспийск"],
    probability10yr: 0.18,
  },
  {
    river: "Манас-Озень",
    scenarioId: "severe",
    label: "Серьёзный паводок",
    returnPeriod: "1 раз в 100 лет",
    peakDischargeM3s: 150,
    description:
      "Затопление жилых кварталов Каспийска у реки. " +
      "Повреждение городской инфраструктуры.",
    populationAtRisk: 10_000,
    buildingsAtRisk: 1_400,
    agricultureHa: 600,
    infrastructureItems: [
      "Городская канализация",
      "Автодороги Каспийска",
      "Рекреационная инфраструктура",
    ],
    estimatedDamageRub: 700,
    historicalAnalogue: null,
    keySettlements: ["Каспийск"],
    probability10yr: 0.10,
  },
];

// ── Combined lookup ──────────────────────────────────────────────────────

const ALL_SCENARIOS: FloodScenario[] = [
  ...TEREK_SCENARIOS,
  ...SULAK_SCENARIOS,
  ...SAMUR_SCENARIOS,
  ...AVARSKOE_SCENARIOS,
  ...ANDIYSKOE_SCENARIOS,
  ...SHURA_SCENARIOS,
  ...AKSAY_SCENARIOS,
  ...KAZIKUMUKH_SCENARIOS,
  ...KARA_SCENARIOS,
  ...ULLUCHAY_SCENARIOS,
  ...RUBAS_SCENARIOS,
  ...GYULGERICHAY_SCENARIOS,
  ...AKTASH_SCENARIOS,
  ...MANAS_SCENARIOS,
];

/** Get all flood scenarios for a given river */
export function getScenariosForRiver(riverName: string): FloodScenario[] {
  return ALL_SCENARIOS.filter((s) => s.river === riverName);
}

/** Format number with Russian thousands separator (space) */
export function formatNumber(n: number): string {
  return n.toLocaleString("ru-RU");
}

/** Format damage in millions/billions ₽ */
export function formatDamage(millionsRub: number): string {
  if (millionsRub >= 1_000) {
    const b = millionsRub / 1_000;
    return `~${b % 1 === 0 ? b.toFixed(0) : b.toFixed(1)} млрд ₽`;
  }
  return `~${formatNumber(millionsRub)} млн ₽`;
}
