# Authentication Strategy

## Context

Samur is a flood relief PWA for Dagestan (samurchs.ru). Users need to log in to respond to help requests, claim tasks, and coordinate rescue efforts. Anonymous access is allowed for viewing the map, sending SOS, and browsing — but responding/volunteering requires identity.

**Audience**: Dagestan residents, primarily using Android, with high Telegram and VK adoption. Connectivity may be limited during floods. Some users may have only one social account or none.

**Current state**: Phone + password login exists but has no phone verification — anyone can register any number. VK Mini App auth exists but only for the embedded VK app, not the standalone PWA.

---

## Method 1 — VK ID

### What it is

VK ID is VK's OAuth 2.0 platform for third-party websites. Replaces the older VK Connect / VK SDK. Most Russians have a VK account, making this the highest-reach social login for the target audience.

### User flow

1. User taps "Войти через VK" button
2. VK popup/redirect opens — user confirms permissions
3. VK redirects back to `https://samurchs.ru/auth/vk/callback` with an authorization `code`
4. Our server exchanges the code for an access token (server-to-server)
5. Server fetches user info (name, phone, avatar) from VK
6. Server creates/finds user by `vkId`, issues JWT
7. PWA stores JWT, user is logged in

### Technical details

**OAuth flow**: Authorization Code with PKCE (recommended for SPAs/PWAs)

**Endpoints**:
- Authorize: `https://id.vk.com/authorize`
- Token exchange: `https://id.vk.com/oauth2/auth` (POST, server-to-server)
- User info: `https://id.vk.com/oauth2/user_info` (POST with access_token)

**SDK**: `@vkid/sdk` (npm) — provides pre-built `OneTap` button widget

```javascript
import * as VKID from '@vkid/sdk';

VKID.Config.init({
  app: APP_ID,
  redirectUrl: 'https://samurchs.ru/auth/vk/callback',
  state: 'random-csrf-string',
  codeVerifier: 'pkce-verifier',
  scope: 'phone',
});

const oneTap = new VKID.OneTap();
oneTap.render({ container: document.getElementById('vk-login') });
```

**Scopes**:
- `vkid.personal_info` — name, avatar (granted by default)
- `phone` — user's verified phone number (+7XXXXXXXXXX)
- `email` — user's email

**User data returned**:
| Field | Notes |
|-------|-------|
| `user_id` | VK user ID (numeric) |
| `first_name`, `last_name` | Always present |
| `phone` | If `phone` scope granted, format +7XXXXXXXXXX |
| `email` | If `email` scope granted |
| `avatar` | Profile photo URL |
| `verified` | Whether VK account is verified |

**App registration**:
1. Go to https://id.vk.com/business/go
2. Create app (type: "Website")
3. Set redirect URI: `https://samurchs.ru/auth/vk/callback`
4. Receive `app_id` (client_id) and `client_secret`

**Key advantage**: VK accounts have verified phone numbers, so requesting the `phone` scope gives us a trusted phone number without needing our own phone verification.

### Implementation plan

**API side** (`apps/api/src/routes/authVk.ts`):
- Add new `POST /auth/vk/exchange` endpoint:
  - Receives `{ code, codeVerifier, redirectUri }` from PWA
  - Exchanges code for access_token with VK (server-to-server, uses client_secret)
  - Fetches user info from VK
  - Creates or finds user by `vkId`
  - If VK returns phone and user has no phone — saves it
  - Issues JWT, returns token + user

**PWA side** (`apps/pwa/src/pages/LoginPage.tsx`):
- Add VK ID SDK initialization
- Render `OneTap` button on login page
- Handle redirect callback — extract code, send to our API
- Store JWT, redirect to app

**Config**:
- `VK_APP_ID` — existing env var, may need update for VK ID vs Mini App
- `VK_SECRET` — existing env var
- Redirect URI must match exactly what's registered in VK developer console

### Prerequisites
- [ ] Register the PWA as a standalone app in VK ID developer portal (separate from Mini App)
- [ ] Set redirect URI to `https://samurchs.ru/auth/vk/callback`
- [ ] Get `app_id` and `client_secret` for the PWA app

### Official docs
- https://id.vk.com/business/go
- https://id.vk.com/about/business/go/docs/vkid/latest/vk-id/connection/start-page
- https://www.npmjs.com/package/@vkid/sdk

---

## Method 2 — Telegram Login Widget

### What it is

Telegram provides a JavaScript widget that lets users log into websites with their Telegram account. One tap, no passwords, no SMS. Very popular in Dagestan where Telegram usage is high.

### User flow

1. User taps "Войти через Telegram" button (widget rendered by Telegram's JS)
2. Telegram popup opens — user confirms login
3. Widget calls our JavaScript callback with user data + HMAC hash
4. PWA sends data to our API for verification
5. Server verifies hash using bot token, creates/finds user by `tgId`
6. Server issues JWT, returns token + user
7. PWA stores JWT, user is logged in

### Technical details

**Widget embed** (callback mode):
```html
<script
  async
  src="https://telegram.org/js/telegram-widget.js?22"
  data-telegram-login="SamurBot"
  data-size="large"
  data-onauth="onTelegramAuth(user)"
  data-request-access="write">
</script>
```

**Data returned to callback**:
| Field | Always present | Notes |
|-------|---------------|-------|
| `id` | Yes | Telegram user ID (numeric) |
| `first_name` | Yes | |
| `last_name` | No | Optional in Telegram |
| `username` | No | Optional in Telegram |
| `photo_url` | No | Only if user has profile photo |
| `auth_date` | Yes | Unix timestamp |
| `hash` | Yes | HMAC-SHA256 for verification |

**Important limitation**: Telegram Login Widget does NOT return the user's phone number. We only get name + Telegram ID. If we need a verified phone, we must use flash call verification separately.

**Server-side hash verification** (Node.js):
```typescript
import crypto from 'node:crypto';

function verifyTelegramAuth(data: Record<string, string>, botToken: string): boolean {
  const secretKey = crypto.createHash('sha256').update(botToken).digest();
  const checkString = Object.keys(data)
    .filter(k => k !== 'hash')
    .sort()
    .map(k => `${k}=${data[k]}`)
    .join('\n');
  const hmac = crypto.createHmac('sha256', secretKey).update(checkString).digest('hex');

  if (hmac !== data.hash) return false;

  // Reject stale auth (older than 24 hours)
  const authDate = parseInt(data.auth_date, 10);
  if (Date.now() / 1000 - authDate > 86400) return false;

  return true;
}
```

**Bot setup**:
1. Open @BotFather in Telegram
2. Send `/setdomain`
3. Select the bot (e.g., @SamurBot)
4. Enter: `samurchs.ru`
5. HTTPS is required (already done)

### Implementation plan

**API side** (`apps/api/src/routes/auth.ts`):
- Add `POST /auth/telegram` endpoint:
  - Receives `{ id, first_name, last_name?, username?, photo_url?, auth_date, hash }`
  - Verifies HMAC hash using `TG_BOT_TOKEN`
  - Rejects auth older than 24 hours
  - Creates or finds user by `tgId`
  - Updates name if changed
  - Issues JWT, returns token + user
  - Links with existing bot-created user if same `tgId`

**PWA side** (`apps/pwa/src/pages/LoginPage.tsx`):
- Load Telegram widget script dynamically
- Render Telegram login button
- Handle `onTelegramAuth` callback — send data to our API
- Store JWT, redirect to app

**Config**:
- `TG_BOT_TOKEN` — already exists in env
- Bot domain must be set via @BotFather `/setdomain` command

### Prerequisites
- [ ] Run `/setdomain` on @BotFather and set `samurchs.ru`
- [ ] Verify the bot name (what's the bot username?)

### Official docs
- https://core.telegram.org/widgets/login

---

## Method 3 — Phone + Flash Call Verification

### What it is

Instead of SMS OTP (expensive, 2-5 RUB/message), a flash call service rings the user's phone once. The last 4 digits of the calling number are the verification code. The user enters these digits to prove they own the phone number. Costs 0.4-2 RUB per verification — 3-5x cheaper than SMS.

### User flow

1. User enters phone number (+7 XXX XXX XX XX)
2. Taps "Получить код"
3. Our server calls the flash call API with the phone number
4. Service returns the expected pincode (e.g., "1234") — stored server-side
5. Service rings the user's phone once, hangs up
6. User sees missed call from e.g., +7 495 XXX **1234**
7. User enters "1234" in the PWA
8. Server compares — if match, phone is verified
9. If user already has an account with this phone — log in
10. If new phone — create account, user enters name

### Provider options (Russia)

| Provider | Price/call | API style | Notes |
|----------|-----------|-----------|-------|
| **ucaller.ru** | from 0.4 RUB | REST GET | Most popular, free test credits, SMS fallback |
| **zvonok.com** | from 0.5 RUB | REST POST | Also offers voice OTP (robot speaks code) |
| **МТС Exolve** | on request | REST JSON | MTS carrier, enterprise-grade |
| **SMS Aero** | ~1 RUB | REST | Also has SMS API |

### Recommended: ucaller.ru

**API flow**:
```
GET https://api.ucaller.ru/v1.0/initCall
  ?service_id=SERVICE_ID
  &key=API_KEY
  &phone=79XXXXXXXXX

Response:
{
  "status": true,
  "ucaller_id": 12345,
  "phone": "79XXXXXXXXX",
  "code": "1234",
  "client": "...",
  "unique_request_id": "..."
}
```

Store `code` server-side (Redis, 5-minute TTL). User enters the code, server compares.

**Fallback**: If flash call fails (user blocks unknown numbers, VoIP number, etc.), fall back to SMS via the same provider or SMS Aero.

### Implementation plan

**API side**:
- Add `POST /auth/phone/request` endpoint:
  - Receives `{ phone }` (validated format)
  - Rate limit: 1 request per phone per 2 minutes
  - Calls ucaller.ru API to initiate flash call
  - Stores `{ phone, code, expiresAt }` in Redis (5 min TTL)
  - Returns `{ success: true, method: "call" }`
- Add `POST /auth/phone/verify` endpoint:
  - Receives `{ phone, code }`
  - Compares code with stored value in Redis
  - If match: find or create user by phone, issue JWT
  - If mismatch: return error (max 3 attempts, then expire code)

**PWA side** (`apps/pwa/src/pages/LoginPage.tsx`):
- Two-step form:
  1. Phone input + "Получить код" button
  2. Code input (4 digits) + "Подтвердить" button
- Show instruction: "Вам поступит звонок. Введите последние 4 цифры номера"
- Timer showing code expiry (5 min countdown)
- "Отправить повторно" button (after 2 min cooldown)

**Config** (new env vars):
- `UCALLER_SERVICE_ID` — from ucaller.ru dashboard
- `UCALLER_API_KEY` — from ucaller.ru dashboard

### Prerequisites
- [ ] Register at ucaller.ru (or zvonok.com)
- [ ] Get service_id and API key
- [ ] Fund the account (test credits usually included for free)
- [ ] Test with a real Russian phone number

### Cost estimate
- Registration: free
- Per verification: ~0.4-1 RUB (~$0.004-0.01)
- For 1000 users: ~400-1000 RUB (~$4-10)

### Official docs
- ucaller.ru: https://ucaller.ru/doc
- zvonok.com: https://zvonok.com/documentation/

---

## Unified User Model

All three methods converge to the same User record:

```
User {
  id:       cuid
  name:     "Ахмед"
  phone:    "+79281234567"     ← from VK scope OR flash call verification
  vkId:     "12345678"        ← from VK ID login
  tgId:     "87654321"        ← from Telegram Login Widget
  password: null              ← no password needed with social/phone auth
  role:     "resident"
}
```

**Account linking logic**:
- If user logs in via Telegram and we find an existing user with matching `tgId` → log in
- If user logs in via VK and VK returns a phone number that matches an existing user → link `vkId` to that user
- If user verifies phone via flash call and we find a user with that phone → log in (update name if needed)
- Otherwise → create new user

**Priority for phone number**:
1. VK ID with `phone` scope — already verified by VK
2. Flash call verification — verified by us
3. Unverified (current phone+password flow) — phase out eventually

---

## Implementation Order

### Phase 1 — Telegram Login Widget
- Lowest effort, zero cost, very popular in Dagestan
- Requires: `/setdomain` on @BotFather, one API endpoint, widget embed
- Estimate: 1-2 hours

### Phase 2 — VK ID
- Highest reach in Russia, gives verified phone number
- Requires: VK ID app registration, SDK integration, callback endpoint
- Estimate: 3-4 hours

### Phase 3 — Phone + Flash Call
- Covers users without VK/Telegram accounts
- Requires: ucaller.ru account, two API endpoints, two-step UI
- Estimate: 3-4 hours

### Phase 4 — Cleanup
- Remove old phone+password registration (or keep as admin-only)
- Add account linking UI (connect VK/Telegram to existing account)
- Add logout-everywhere functionality

---

## Login Page Design

```
┌─────────────────────────────────┐
│                                 │
│            Самур                │
│    Координация помощи           │
│                                 │
│  ┌───────────────────────────┐  │
│  │  🔵 Войти через VK ID    │  │
│  └───────────────────────────┘  │
│                                 │
│  ┌───────────────────────────┐  │
│  │  ✈️ Войти через Telegram  │  │
│  └───────────────────────────┘  │
│                                 │
│  ─────── или ───────            │
│                                 │
│  📱 +7 ___ ___ __ __           │
│  ┌───────────────────────────┐  │
│  │    Получить код звонком    │  │
│  └───────────────────────────┘  │
│                                 │
│  Продолжая, вы соглашаетесь    │
│  с условиями использования      │
│                                 │
└─────────────────────────────────┘
```

---

## Security Considerations

- **VK ID**: Server-side code exchange with client_secret — token never exposed to browser
- **Telegram**: HMAC-SHA256 verification with bot token — cannot be forged
- **Flash call**: Code stored server-side only, 5-minute TTL, 3 attempt max
- **JWT**: 7-day expiry, HS256 with 32+ char secret
- **Account linking**: Only link accounts when identity is cryptographically verified (VK OAuth, Telegram HMAC, flash call code match) — never by user claim alone
- **Rate limiting**: Phone verification requests limited to 1 per phone per 2 minutes
