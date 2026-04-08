// SPDX-License-Identifier: AGPL-3.0-only
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  console.log("🌱 Seeding database...");

  await prisma.$transaction([
    prisma.riverLevel.deleteMany(),
    prisma.alert.deleteMany(),
    prisma.helpRequest.deleteMany(),
    prisma.incident.deleteMany(),
    prisma.shelter.deleteMany(),
    prisma.user.deleteMany(),
  ]);

  const admin = await prisma.user.create({
    data: {
      name: "Магомед Алиев",
      phone: "+79281234001",
      role: "admin",
      tgId: "admin_tg_001",
      password: "$2b$10$placeholder_hash_admin", // bcrypt hash placeholder
    },
  });

  const coordinator = await prisma.user.create({
    data: {
      name: "Патимат Гаджиева",
      phone: "+79281234002",
      role: "coordinator",
      tgId: "coord_tg_002",
      vkId: "coord_vk_002",
      password: "$2b$10$placeholder_hash_coord",
    },
  });

  const resident = await prisma.user.create({
    data: {
      name: "Ахмед Магомедов",
      phone: "+79281234003",
      role: "resident",
      tgId: "resident_tg_003",
    },
  });

  console.log(`  ✓ Created ${3} users`);

  const incidentsData = [
    {
      userId: resident.id,
      type: "flood" as const,
      severity: "critical" as const,
      lat: 42.9750,
      lng: 47.5020,
      address: "ул. Ярагского, 45, Махачкала",
      description: "Вода поднялась до 1.5 метров, первый этаж полностью затоплен. Люди на втором этаже.",
      status: "verified" as const,
      verifiedBy: coordinator.id,
      source: "pwa" as const,
    },
    {
      userId: resident.id,
      type: "flood" as const,
      severity: "high" as const,
      lat: 42.9830,
      lng: 47.4950,
      address: "пр. Имама Шамиля, 70, Махачкала",
      description: "Подвалы затоплены, вода прибывает. Нужны насосы.",
      status: "verified" as const,
      verifiedBy: coordinator.id,
      source: "telegram" as const,
    },
    {
      type: "road_blocked" as const,
      severity: "high" as const,
      lat: 42.9900,
      lng: 47.5100,
      address: "ул. Коркмасова / ул. Дахадаева, Махачкала",
      description: "Дорога перекрыта упавшим деревом и мусором после паводка.",
      status: "verified" as const,
      verifiedBy: coordinator.id,
      source: "pwa" as const,
    },
    {
      userId: resident.id,
      type: "building_damaged" as const,
      severity: "critical" as const,
      lat: 42.9780,
      lng: 47.5080,
      address: "ул. Буйнакского, 32, Махачкала",
      description: "Стена дома обрушилась от размыва фундамента. Срочно нужна эвакуация 4 семей.",
      status: "unverified" as const,
      source: "sms" as const,
    },
    {
      type: "power_out" as const,
      severity: "medium" as const,
      lat: 42.9920,
      lng: 47.4900,
      address: "мкр. Новый Кяхулай, Махачкала",
      description: "Электричество отключено во всём микрорайоне с 6 утра.",
      status: "verified" as const,
      verifiedBy: coordinator.id,
      source: "telegram" as const,
    },
    {
      type: "water_contaminated" as const,
      severity: "high" as const,
      lat: 42.9650,
      lng: 47.5150,
      address: "пос. Семендер, Махачкала",
      description: "Вода из крана мутная, коричневого цвета. Пить нельзя.",
      status: "verified" as const,
      verifiedBy: coordinator.id,
      source: "vk" as const,
    },
    {
      userId: resident.id,
      type: "flood" as const,
      severity: "medium" as const,
      lat: 43.0010,
      lng: 47.4780,
      address: "ул. Акушинского, 100, Махачкала",
      description: "Лужи на дороге глубиной по колено, движение затруднено.",
      status: "unverified" as const,
      source: "pwa" as const,
    },
    {
      type: "road_blocked" as const,
      severity: "critical" as const,
      lat: 42.9550,
      lng: 47.5200,
      address: "трасса Махачкала-Каспийск, 5 км",
      description: "Дорога полностью размыта, проезд невозможен. Объезда нет.",
      status: "verified" as const,
      verifiedBy: coordinator.id,
      source: "meshtastic" as const,
    },
    {
      type: "flood" as const,
      severity: "high" as const,
      lat: 42.9700,
      lng: 47.4850,
      address: "ул. Гамидова, 55, Махачкала",
      description: "Подтопление частного сектора, вода прибывает со стороны канала.",
      status: "unverified" as const,
      source: "sms" as const,
    },
    {
      type: "building_damaged" as const,
      severity: "low" as const,
      lat: 42.9870,
      lng: 47.5060,
      address: "ул. Леваневского, 18, Махачкала",
      description: "Трещина в стене после вибрации от паводка. Угрозы обрушения нет.",
      status: "resolved" as const,
      verifiedBy: coordinator.id,
      source: "pwa" as const,
    },
  ];

  const incidents = await Promise.all(
    incidentsData.map((data) => prisma.incident.create({ data }))
  );

  console.log(`  ✓ Created ${incidents.length} incidents`);

  const helpRequestsData = [
    {
      userId: resident.id,
      incidentId: incidents[0].id,
      type: "need" as const,
      category: "rescue" as const,
      description: "Семья из 5 человек на втором этаже, нужна лодка для эвакуации",
      lat: 42.9750,
      lng: 47.5020,
      address: "ул. Ярагского, 45, Махачкала",
      urgency: "critical" as const,
      contactPhone: "+79281234003",
      contactName: "Ахмед Магомедов",
      status: "in_progress" as const,
      claimedBy: coordinator.id,
      source: "pwa" as const,
    },
    {
      incidentId: incidents[1].id,
      type: "need" as const,
      category: "pump" as const,
      description: "Нужен мощный насос для откачки воды из подвала жилого дома",
      lat: 42.9830,
      lng: 47.4950,
      address: "пр. Имама Шамиля, 70, Махачкала",
      urgency: "urgent" as const,
      contactPhone: "+79281234010",
      contactName: "Расул",
      status: "open" as const,
      source: "telegram" as const,
    },
    {
      type: "need" as const,
      category: "food" as const,
      description: "Нужна еда для 20 человек, оказались отрезаны от магазинов",
      lat: 42.9650,
      lng: 47.5150,
      address: "пос. Семендер, ул. Центральная, 12",
      urgency: "urgent" as const,
      contactPhone: "+79281234011",
      contactName: "Зайнаб",
      status: "open" as const,
      source: "sms" as const,
    },
    {
      type: "need" as const,
      category: "water" as const,
      description: "Нужна питьевая вода на 15 семей, водопровод загрязнён",
      lat: 42.9660,
      lng: 47.5140,
      address: "пос. Семендер, ул. Озёрная, 5",
      urgency: "urgent" as const,
      contactPhone: "+79281234012",
      contactName: "Камиль",
      status: "claimed" as const,
      claimedBy: coordinator.id,
      source: "vk" as const,
    },
    {
      type: "need" as const,
      category: "medicine" as const,
      description: "Пожилой человек с диабетом, закончился инсулин. Срочно!",
      lat: 42.9780,
      lng: 47.5080,
      address: "ул. Буйнакского, 32, кв. 8, Махачкала",
      urgency: "critical" as const,
      contactPhone: "+79281234013",
      contactName: "Хадижа Алиева",
      status: "open" as const,
      source: "pwa" as const,
    },
    {
      type: "need" as const,
      category: "generator" as const,
      description: "Нужен генератор для подключения медицинского оборудования",
      lat: 42.9920,
      lng: 47.4900,
      address: "мкр. Новый Кяхулай, д. 14",
      urgency: "critical" as const,
      contactPhone: "+79281234014",
      contactName: "Муслим",
      status: "open" as const,
      source: "telegram" as const,
    },
    {
      type: "need" as const,
      category: "shelter" as const,
      description: "Семья с 3 детьми ищет временное жильё, дом непригоден",
      lat: 42.9780,
      lng: 47.5085,
      address: "ул. Буйнакского, 30, Махачкала",
      urgency: "urgent" as const,
      contactPhone: "+79281234015",
      contactName: "Маригат",
      status: "open" as const,
      source: "sms" as const,
    },
    {
      type: "need" as const,
      category: "transport" as const,
      description: "Нужен транспорт для перевозки 10 мешков с песком к дамбе",
      lat: 42.9550,
      lng: 47.5200,
      address: "трасса Махачкала-Каспийск, 3 км",
      urgency: "normal" as const,
      contactPhone: "+79281234016",
      contactName: "Гамзат",
      status: "completed" as const,
      claimedBy: coordinator.id,
      source: "pwa" as const,
    },
    {
      userId: coordinator.id,
      type: "offer" as const,
      category: "food" as const,
      description: "Могу привезти 50 порций горячего питания в любую точку города",
      lat: 42.9849,
      lng: 47.5047,
      address: "Центральный рынок, Махачкала",
      urgency: "normal" as const,
      contactPhone: "+79281234002",
      contactName: "Патимат Гаджиева",
      status: "open" as const,
      source: "pwa" as const,
    },
    {
      type: "offer" as const,
      category: "transport" as const,
      description: "Есть грузовик ГАЗель, готов помочь с перевозкой людей и грузов",
      lat: 42.9880,
      lng: 47.5030,
      address: "ул. Магомеда Гаджиева, 1, Махачкала",
      urgency: "normal" as const,
      contactPhone: "+79281234017",
      contactName: "Рустам",
      status: "open" as const,
      source: "telegram" as const,
    },
    {
      type: "offer" as const,
      category: "shelter" as const,
      description: "Могу приютить семью с детьми, есть свободная комната",
      lat: 42.9950,
      lng: 47.4970,
      address: "ул. Акушинского, 22, Махачкала",
      urgency: "normal" as const,
      contactPhone: "+79281234018",
      contactName: "Саида",
      status: "open" as const,
      source: "vk" as const,
    },
    {
      type: "offer" as const,
      category: "equipment" as const,
      description: "Есть 3 мотопомпы, могу предоставить для откачки воды",
      lat: 42.9700,
      lng: 47.5100,
      address: "пр. Акушинского, стройбаза",
      urgency: "normal" as const,
      contactPhone: "+79281234019",
      contactName: "Шамиль",
      status: "claimed" as const,
      claimedBy: coordinator.id,
      source: "pwa" as const,
    },
    {
      type: "offer" as const,
      category: "labor" as const,
      description: "Группа из 10 волонтёров готова помочь с укреплением дамбы",
      lat: 42.9800,
      lng: 47.5000,
      address: "Площадь Ленина, Махачкала",
      urgency: "normal" as const,
      contactPhone: "+79281234020",
      contactName: "Магомед",
      status: "open" as const,
      source: "pwa" as const,
    },
    {
      type: "need" as const,
      category: "equipment" as const,
      description: "Нужны мешки с песком (минимум 200 шт) для укрепления берега",
      lat: 42.9560,
      lng: 47.5190,
      address: "берег р. Сулак, район Каспийска",
      urgency: "urgent" as const,
      contactPhone: "+79281234021",
      contactName: "Абдулла",
      status: "open" as const,
      source: "meshtastic" as const,
    },
    {
      type: "offer" as const,
      category: "medicine" as const,
      description: "Врач-терапевт, готова оказать помощь на месте. Есть аптечка.",
      lat: 42.9840,
      lng: 47.5050,
      address: "ул. Расула Гамзатова, 11, Махачкала",
      urgency: "normal" as const,
      contactPhone: "+79281234022",
      contactName: "Айшат Омарова",
      status: "open" as const,
      source: "pwa" as const,
    },
  ];

  const helpRequests = await Promise.all(
    helpRequestsData.map((data) => prisma.helpRequest.create({ data }))
  );

  console.log(`  ✓ Created ${helpRequests.length} help requests`);

  const sheltersData = [
    {
      name: "Школа №13 — Временный пункт размещения",
      lat: 42.9810,
      lng: 47.5030,
      address: "ул. Дахадаева, 88, Махачкала",
      capacity: 200,
      currentOccupancy: 145,
      amenities: ["food" as const, "beds" as const, "medical" as const, "power" as const],
      contactPhone: "+79281235001",
      status: "open" as const,
    },
    {
      name: "Спорткомплекс «Динамо»",
      lat: 42.9870,
      lng: 47.5010,
      address: "пр. Имама Шамиля, 45, Махачкала",
      capacity: 500,
      currentOccupancy: 312,
      amenities: ["food" as const, "beds" as const, "power" as const, "wifi" as const],
      contactPhone: "+79281235002",
      status: "open" as const,
    },
    {
      name: "Мечеть «Джума» — гуманитарный штаб",
      lat: 42.9790,
      lng: 47.5070,
      address: "ул. Дахадаева, 136, Махачкала",
      capacity: 100,
      currentOccupancy: 100,
      amenities: ["food" as const, "beds" as const],
      contactPhone: "+79281235003",
      status: "full" as const,
    },
    {
      name: "ДК им. Ленинского комсомола",
      lat: 42.9920,
      lng: 47.4980,
      address: "пр. Акушинского, 15, Махачкала",
      capacity: 150,
      currentOccupancy: 67,
      amenities: ["food" as const, "beds" as const, "power" as const, "medical" as const, "wifi" as const],
      contactPhone: "+79281235004",
      status: "open" as const,
    },
    {
      name: "Палаточный лагерь МЧС",
      lat: 42.9600,
      lng: 47.5250,
      address: "поле у трассы Махачкала-Каспийск",
      capacity: 300,
      currentOccupancy: 89,
      amenities: ["food" as const, "beds" as const, "medical" as const],
      contactPhone: "+79281235005",
      status: "open" as const,
    },
  ];

  const shelters = await Promise.all(
    sheltersData.map((data) => prisma.shelter.create({ data }))
  );

  console.log(`  ✓ Created ${shelters.length} shelters`);

  const now = new Date();

  const alertsData = [
    {
      authorId: admin.id,
      urgency: "critical" as const,
      title: "ВНИМАНИЕ: Ожидается третья волна паводка",
      body: "По данным Росгидромета, 11 апреля ожидается резкий подъём уровня рек Сулак и Терек. Жителям низинных районов Махачкалы рекомендуется эвакуироваться в пункты временного размещения. Следите за обновлениями.",
      channels: ["pwa" as const, "telegram" as const, "vk" as const, "sms" as const],
      sentAt: new Date(now.getTime() - 2 * 60 * 60 * 1000), // 2 hours ago
      expiresAt: new Date(now.getTime() + 72 * 60 * 60 * 1000), // +72 hours
    },
    {
      authorId: coordinator.id,
      urgency: "warning" as const,
      title: "Водопровод в Семендере загрязнён",
      body: "Не используйте водопроводную воду для питья и приготовления пищи в пос. Семендер. Чистая вода раздаётся в школе №13 и спорткомплексе «Динамо». Привозите свою тару.",
      channels: ["pwa" as const, "telegram" as const, "vk" as const],
      sentAt: new Date(now.getTime() - 6 * 60 * 60 * 1000), // 6 hours ago
      expiresAt: new Date(now.getTime() + 48 * 60 * 60 * 1000),
    },
    {
      authorId: coordinator.id,
      urgency: "info" as const,
      title: "Открыт новый пункт размещения",
      body: "ДК им. Ленинского комсомола (пр. Акушинского, 15) принимает пострадавших. Есть горячее питание, спальные места, медицинская помощь и Wi-Fi. Вместимость — 150 человек.",
      channels: ["pwa" as const, "telegram" as const, "vk" as const],
      sentAt: new Date(now.getTime() - 12 * 60 * 60 * 1000), // 12 hours ago
      expiresAt: null,
    },
  ];

  const alerts = await Promise.all(
    alertsData.map((data) => prisma.alert.create({ data }))
  );

  console.log(`  ✓ Created ${alerts.length} alerts`);

  const baseTime = now.getTime();
  const hour = 60 * 60 * 1000;

  const riverLevelsData = [
    { riverName: "Сулак", stationName: "Кизилюрт", lat: 43.1920, lng: 46.8750, levelCm: 420, dangerLevelCm: 500, trend: "rising" as const, measuredAt: new Date(baseTime - 6 * hour) },
    { riverName: "Сулак", stationName: "Кизилюрт", lat: 43.1920, lng: 46.8750, levelCm: 445, dangerLevelCm: 500, trend: "rising" as const, measuredAt: new Date(baseTime - 4 * hour) },
    { riverName: "Сулак", stationName: "Кизилюрт", lat: 43.1920, lng: 46.8750, levelCm: 468, dangerLevelCm: 500, trend: "rising" as const, measuredAt: new Date(baseTime - 2 * hour) },
    { riverName: "Сулак", stationName: "Кизилюрт", lat: 43.1920, lng: 46.8750, levelCm: 482, dangerLevelCm: 500, trend: "rising" as const, measuredAt: new Date(baseTime) },

    { riverName: "Сулак", stationName: "Сулак (город)", lat: 43.2780, lng: 46.7420, levelCm: 510, dangerLevelCm: 480, trend: "rising" as const, measuredAt: new Date(baseTime - 2 * hour) },
    { riverName: "Сулак", stationName: "Сулак (город)", lat: 43.2780, lng: 46.7420, levelCm: 525, dangerLevelCm: 480, trend: "rising" as const, measuredAt: new Date(baseTime) },

    { riverName: "Терек", stationName: "Кизляр", lat: 43.8476, lng: 46.7135, levelCm: 380, dangerLevelCm: 450, trend: "stable" as const, measuredAt: new Date(baseTime - 4 * hour) },
    { riverName: "Терек", stationName: "Кизляр", lat: 43.8476, lng: 46.7135, levelCm: 382, dangerLevelCm: 450, trend: "stable" as const, measuredAt: new Date(baseTime - 2 * hour) },
    { riverName: "Терек", stationName: "Кизляр", lat: 43.8476, lng: 46.7135, levelCm: 379, dangerLevelCm: 450, trend: "stable" as const, measuredAt: new Date(baseTime) },

    { riverName: "Терек", stationName: "Бабаюрт", lat: 43.6000, lng: 46.7800, levelCm: 410, dangerLevelCm: 430, trend: "rising" as const, measuredAt: new Date(baseTime - 2 * hour) },
    { riverName: "Терек", stationName: "Бабаюрт", lat: 43.6000, lng: 46.7800, levelCm: 418, dangerLevelCm: 430, trend: "rising" as const, measuredAt: new Date(baseTime) },
  ];

  const riverLevels = await Promise.all(
    riverLevelsData.map((data) => prisma.riverLevel.create({ data }))
  );

  console.log(`  ✓ Created ${riverLevels.length} river level readings`);

  // Sync PostGIS location columns via raw SQL
  await prisma.$executeRawUnsafe(`
    UPDATE incidents SET location = ST_SetSRID(ST_MakePoint(lng, lat), 4326);
    UPDATE help_requests SET location = ST_SetSRID(ST_MakePoint(lng, lat), 4326);
    UPDATE shelters SET location = ST_SetSRID(ST_MakePoint(lng, lat), 4326);
    UPDATE river_levels SET location = ST_SetSRID(ST_MakePoint(lng, lat), 4326);
  `);

  console.log("  ✓ Synced PostGIS geometry columns");
  console.log("✅ Seed complete!");
}

main()
  .catch((e) => {
    console.error("❌ Seed failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
