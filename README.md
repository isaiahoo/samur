# Самур — Платформа координации помощи при наводнении

Платформа реального времени для координации спасательных операций и помощи пострадавшим от наводнения в Дагестане (апрель 2026).

## Архитектура

```
┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌──────────────┐
│   PWA/Web   │  │  Telegram   │  │ VK Mini App │  │  SMS / Mesh  │
│  (React)    │  │    Bot      │  │   (VKUI)    │  │   Bridges    │
└──────┬──────┘  └──────┬──────┘  └──────┬──────┘  └──────┬───────┘
       │                │                │                 │
       └────────────────┴────────┬───────┴─────────────────┘
                                 │
                    ┌────────────▼────────────┐
                    │     REST API + WS       │
                    │   (Express + Socket.IO) │
                    └────────────┬────────────┘
                                 │
                    ┌────────────▼────────────┐
                    │  PostgreSQL + PostGIS    │
                    │       + Redis           │
                    └─────────────────────────┘
```

## Стек технологий

| Компонент | Технологии |
|---|---|
| API | Node.js 20, Express, Socket.IO, Prisma, Zod, Pino, Prometheus |
| PWA | React, Vite, MapLibre GL JS, PMTiles (офлайн), Workbox, IndexedDB |
| Telegram | node-telegram-bot-api, Socket.IO client |
| VK | VKUI, VK Bridge SDK, MapLibre GL JS |
| SMS | FrontlineSMS webhook интеграция |
| Meshtastic | Python bridge (LoRa mesh radio) |
| БД | PostgreSQL 16 + PostGIS 3.4 |
| Кэш | Redis 7 |
| Деплой | Docker Compose, nginx, Let's Encrypt |

## Каналы связи

| Канал | Охват | Статус |
|---|---|---|
| **PWA** | Смартфоны с интернетом | Готов (офлайн-режим) |
| **Telegram** | 70%+ пользователей в РФ | Готов |
| **VK Mini App** | Пользователи ВКонтакте | Готов |
| **SMS** | Кнопочные телефоны | Готов (нужен FrontlineSMS) |
| **Meshtastic** | Полное отключение связи | Готов (нужна LoRa-радиостанция) |

## Быстрый старт (локальная разработка)

### Требования

- Node.js 20+
- Docker + Docker Compose
- Git

### Установка

```bash
git clone https://github.com/isaiahoo/samur.git
cd samur

# Скопировать переменные окружения
cp .env.example .env
# Отредактировать .env (минимум: JWT_SECRET)

# Запустить БД
docker compose up -d postgres redis

# Установить зависимости
npm install

# Сгенерировать Prisma клиент и применить миграции
npm run db:generate
npm run db:migrate

# Заполнить тестовыми данными (опционально)
npm run db:seed

# Запустить в режиме разработки
npm run dev:api     # API на :3000
npm run dev:pwa     # PWA на :5173
npm run dev:telegram # Telegram бот
npm run dev:vk      # VK Mini App на :5174
```

### Полная сборка

```bash
npm run build   # Собирает все 6 пакетов
```

## Продакшн-деплой

### 1. Подготовка сервера

```bash
# Установить Docker
curl -fsSL https://get.docker.com | sh
apt install docker-compose-plugin

# Клонировать проект
git clone https://github.com/isaiahoo/samur.git /opt/samur
cd /opt/samur

# Настроить переменные окружения
cp .env.example .env
nano .env
```

### 2. Настройка .env

Обязательные переменные:

| Переменная | Описание | Как получить |
|---|---|---|
| `POSTGRES_PASSWORD` | Пароль БД | Придумать надёжный пароль |
| `JWT_SECRET` | Секрет JWT | `openssl rand -base64 48` |
| `TG_BOT_TOKEN` | Токен Telegram бота | @BotFather → /newbot |
| `VK_APP_ID` | ID VK приложения | vk.com/apps?act=manage |
| `VK_SECRET` | Защищённый ключ VK | Настройки VK приложения |
| `WEBHOOK_API_KEY` | Ключ для вебхуков | `openssl rand -base64 32` |
| `DOMAIN` | Домен сервера | Ваш домен |
| `CERTBOT_EMAIL` | Email для SSL | Ваш email |

### 3. SSL-сертификат

```bash
DOMAIN=samur.dag CERTBOT_EMAIL=admin@example.com ./scripts/init-ssl.sh
```

### 4. Запуск

```bash
docker compose -f docker-compose.prod.yml up -d
```

### 5. Проверка

```bash
curl https://your-domain/api/v1/health
curl https://your-domain/api/v1/channels/health
```

### Деплой обновлений

```bash
./scripts/deploy.sh user@server main
```

### Бэкапы

```bash
# Ручной бэкап
./scripts/backup.sh

# С загрузкой в S3
./scripts/backup.sh --upload s3://samur-backups/db

# Автоматические бэкапы: уже работают через pg-backup контейнер (каждые 24ч)
```

## Как добавить координатора

```bash
# Через Prisma Studio
npm run db:studio
# Найти пользователя → изменить role на "coordinator"

# Или через psql
docker compose exec postgres psql -U samur -c \
  "UPDATE users SET role = 'coordinator' WHERE phone = '+79281234567';"
```

## Подключение Meshtastic

### Требования
- Raspberry Pi или ноутбук
- Meshtastic LoRa-радиостанция (TTGO T-Beam, Heltec V3, и т.д.)
- USB-кабель

### Установка

```bash
cd scripts/meshtastic-bridge

# Создать виртуальное окружение
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt

# Настроить конфигурацию
cp meshtastic-bridge.yaml /opt/samur/meshtastic-bridge/
nano /opt/samur/meshtastic-bridge/meshtastic-bridge.yaml
# Указать: api.base_url, api.api_key, meshtastic.serial_port

# Запустить
python bridge.py
```

### Установка как системный сервис

```bash
sudo cp meshtastic-bridge.service /etc/systemd/system/
sudo systemctl enable meshtastic-bridge
sudo systemctl start meshtastic-bridge
```

### Формат сообщений через mesh

| Сообщение | Действие |
|---|---|
| `SOS [описание]` | Критический запрос помощи |
| `HELP [категория] [описание]` | Запрос помощи |
| `FLOOD [описание]` | Сообщение о затоплении |
| `LEVEL [река] [см]` | Уровень воды |
| `OK [id]` | Отметить запрос выполненным |

## Подключение SMS-шлюза (FrontlineSMS)

### 1. Установить FrontlineSMS

Скачать с [frontlinesms.com](https://frontlinesms.com). Подключить GSM-модем или Android-телефон.

### 2. Настроить webhook

В FrontlineSMS создать Activity → Webhook:
- URL: `https://your-domain/api/v1/webhook/sms`
- Метод: POST
- Заголовки: `X-API-Key: ваш_WEBHOOK_API_KEY`
- Тело: `{"from": "${from}", "message": "${message}"}`

### 3. Настроить исходящие

Создать cron-задачу или Activity для опроса:
```
GET https://your-domain/api/v1/webhook/sms/broadcast
```
Ответ содержит массив `{phone, message}` для отправки.

### Формат SMS

| SMS | Действие | Ответ |
|---|---|---|
| `SOS адрес` | Критическая помощь | `Запрос помощи принят (#xxx)` |
| `ПОТОП адрес` | Инцидент наводнения | `Инцидент зарегистрирован (#xxx)` |
| `УБЕЖИЩЕ` | Запрос укрытий | Список ближайших |
| `УРОВЕНЬ` | Уровень рек | `Реки: Сулак:350см↑, Терек:280см→` |
| `ПОМОЩЬ текст` | Общий запрос | `Запрос помощи принят (#xxx)` |

## Деплой VK Mini App

1. Зайти на [vk.com/apps?act=manage](https://vk.com/apps?act=manage)
2. Выбрать приложение "Самур"
3. Перейти в "Разработка" → "Настройки"
4. Указать URL: `https://your-domain` (PWA будет обслуживать VK Mini App)
5. Или собрать отдельно: `npm run build:vk` и загрузить содержимое `apps/vk/dist/`

## Мониторинг

### Prometheus + Grafana (опционально)

```bash
docker compose -f docker-compose.prod.yml --profile monitoring up -d
```

- Prometheus: http://localhost:9090
- Grafana: http://localhost:3001 (admin / значение GRAFANA_PASSWORD)

### Метрики API

```
GET /metrics
```

Доступные метрики:
- `samur_http_requests_total` — счётчик запросов
- `samur_http_request_duration_seconds` — гистограмма задержек
- `samur_ws_connections_active` — активные WebSocket-соединения
- `samur_incidents_created_total` — созданные инциденты
- `samur_help_requests_created_total` — созданные запросы помощи

### Проверка здоровья каналов

```
GET /api/v1/channels/health
```

```json
{
  "pwa": "online",
  "telegram": "online",
  "vk": "online",
  "sms": "offline",
  "meshtastic": "online"
}
```

## Тесты

```bash
# Запустить PostgreSQL (нужен для интеграционных тестов)
docker compose up -d postgres

# Запустить тесты API
npm run test:api
```

## Структура проекта

```
samur/
├── apps/
│   ├── api/          # REST API + WebSocket сервер
│   ├── pwa/          # Progressive Web App
│   ├── telegram/     # Telegram бот
│   └── vk/           # VK Mini App
├── packages/
│   ├── db/           # Prisma ORM, схема БД, миграции
│   └── shared/       # Общие типы, схемы, константы
├── scripts/
│   ├── meshtastic-bridge/  # Python bridge для LoRa
│   ├── deploy.sh           # Скрипт деплоя
│   ├── backup.sh           # Скрипт бэкапа
│   └── init-ssl.sh         # Инициализация SSL
├── nginx/            # Конфиг reverse proxy
├── monitoring/       # Prometheus + Grafana
├── docker-compose.yml       # Разработка
└── docker-compose.prod.yml  # Продакшн
```

## Участие в разработке

1. Форкнуть репозиторий
2. Создать ветку: `git checkout -b feature/my-feature`
3. Внести изменения
4. Убедиться что сборка проходит: `npm run build`
5. Создать Pull Request

### Соглашения

- Все файлы содержат заголовок `// SPDX-License-Identifier: AGPL-3.0-only`
- Типы и схемы валидации — в `packages/shared`
- Новые API-эндпоинты должны использовать Zod-валидацию через `validateBody` / `validateQuery`
- Сообщения пользователю — на русском языке

## Лицензия

[GNU Affero General Public License v3.0](LICENSE)

Открытый исходный код для максимальной прозрачности и возможности адаптации в других регионах.
