# SOS Verification Stack

## Context

The "Я в беде" SOS button must be easy to use in a real emergency (wet hands, panic, no time), but false activations waste volunteer/coordinator resources and erode trust. Research of Apple SOS, Noonlight, EPIRB maritime beacons, 911/112, Cajun Navy (Hurricane Harvey), and Ushahidi crowdsourcing platforms informs this strategy.

**Core principle**: false negatives (missing a real emergency) are categorically worse than false positives (responding to a false one). All verification happens server-side or post-activation — zero added friction for real users.

---

## Current State (as of 2026-04-11)

- SOS button: tap → long-press 2s → situation picker (5s auto-send) → sent
- Duplicate prevention: only for authenticated users (checks active SOS by userId)
- Rate limiting: global 90 req/min per IP (shared across all API endpoints)
- **Vulnerability**: anonymous users can spam ~90 SOS/min with no deduplication

---

## Tier 1 — Implement Now

High impact, low complexity, zero friction for real users.

### 1.1 Per-IP SOS Rate Limit

- Max **1 SOS per IP per 5 minutes** (separate from global rate limiter)
- Returns 429 with message "Вы уже отправили сигнал SOS. Подождите 5 минут."
- Implementation: dedicated `RateLimiterMemory` instance in the SOS endpoint

### 1.2 Anonymous Deduplication by IP + Coordinates

- For anonymous users (no `req.user`), check for existing open SOS from same IP within last 30 minutes and within 1km radius
- If found, return existing SOS (same behavior as authenticated dedup)
- Store `sourceIp` field on HelpRequest for this purpose

### 1.3 Contextual Confidence Score (0–100)

Auto-computed on SOS creation, stored on the help request, visible to coordinators.

| Signal | Points | How |
|--------|--------|-----|
| Location within 5km of river station showing elevated levels (>100%) | +30 | Cross-reference GPS with GloFAS river data |
| Active flood warnings / NERV crisis mode for this area | +25 | Check crisis state + active alerts with geoBounds |
| Other SOS within 3km in the last 60 minutes | +20 | Spatial query on recent SOS |
| User is authenticated (phone-verified) | +10 | Check `req.user` presence |
| User selected a specific situation (vs "send without choosing") | +10 | Check `situation` field |
| Battery level below 30% | +5 | Check `batteryLevel` field |

Score interpretation for coordinators:
- **70–100**: High confidence — likely real, prioritize
- **40–69**: Medium — treat normally
- **0–39**: Low confidence — verify before dispatching

### 1.4 Adaptive Crisis Mode

- During NERV crisis mode (tier 4 river levels): all SOS treated as high priority regardless of score
- During normal mode: SOS with score < 20 flagged as "требует проверки" (needs verification)
- Implementation: check crisis state on the server when computing score

---

## Tier 2 — Implement Soon

High impact, medium complexity.

### 2.1 Post-Activation Telegram Callback

After SOS is received, if the user has Telegram linked:
1. Bot sends: "Мы получили ваш SOS. Ответьте ДА если вы в опасности, или ОТМЕНА если это ошибка"
2. If user responds "ОТМЕНА" within 60 seconds → auto-resolve the SOS
3. If user responds "ДА" or doesn't respond → proceed with dispatch
4. Key insight from EPIRB beacons (98% false alarm rate): a simple callback resolves most false alarms without coordinator effort

### 2.2 Cluster Detection and Auto-Escalation

- If 3+ SOS arrive from within 3km radius within 30 minutes → auto-escalate to "confirmed incident"
- Flag individual SOS that arrive with no nearby signals as "unconfirmed"
- Display cluster count on coordinator dashboard
- Implementation: spatial query on SOS creation

### 2.3 Two-Digit Confirmation (Non-Crisis Mode Only)

- After long-press activation, display a random 2-digit number: "Введите 47 для подтверждения"
- Blocks children playing with phones; adults in panic can type 2 digits in 2–3 seconds
- **Skip entirely during active crisis mode** — no barriers when flooding is confirmed
- Implementation: client-side stage between "situation" and "sending"

---

## Tier 3 — Implement Later

Medium impact, higher complexity.

### 3.1 Trust Tiers

| Tier | Who | SOS Treatment |
|------|-----|---------------|
| 0 — Anonymous | No account, no phone | Accepted but flagged "неподтверждён" |
| 1 — Phone-verified | Registered via SMS/Telegram | Treated normally |
| 2 — Community-vouched | Confirmed by coordinator | Auto-prioritized |

Display tier badge on coordinator dashboard. Aligns with Dagestan's community-based culture.

### 3.2 Periodic Check-In After SOS

- Push notification / Telegram message every 15 minutes: "Вы ещё в опасности? ДА / НЕТ"
- "НЕТ" or "СПАСЁН" → auto-resolve
- No response for 3 check-ins → flag for coordinator attention (phone may have died)
- Helps coordinators manage queue as situations evolve

### 3.3 Coordinator Quick-Resolve Tools

- One-tap "Ложный вызов" (false call) button on admin panel
- Track false call rate per user/device over time
- After 3 confirmed false calls from same device → auto-flag future SOS for manual review
- Not criminal penalties — trust degradation

### 3.4 Optional Photo Evidence

- After SOS is sent, offer (never require) ability to attach a photo
- Photo of rising water is strong corroboration
- Never mandatory — someone in immediate danger shouldn't be taking photos

---

## Anti-Patterns — Do NOT Implement

| Strategy | Why Not |
|----------|---------|
| CAPTCHA | Wrong for emergency context — panicking user with wet hands |
| Require account creation before SOS | Someone drowning shouldn't need to sign up |
| Require photo before sending | Delays real emergencies |
| Movement-based auto-cancel | Flood victims are stationary (on roofs, in cars) |
| Financial penalties | Inappropriate for disaster relief platform |
| Block anonymous SOS entirely | Phone might not be logged in, person still deserves rescue |
| Automated crash/fall detection | Massive false positive rate (Apple's ski slope problem) |

---

## Key Research Sources

- **Apple Crash Detection**: millions of false 911 calls from ski slopes, roller coasters. Lesson: automated activation without user intent is problematic.
- **EPIRB Maritime Beacons**: 98% false alarm rate. Resolution: mandatory registration + phone callback resolves vast majority without deploying resources.
- **Noonlight**: PIN-to-cancel model + text/call verification by dispatchers. Best-in-class for preventing false dispatch.
- **911/112 Systems**: all hang-ups get called back. If no answer, dispatch anyway (err toward action).
- **Russia's 112/MChS**: callback-based verification. False calls punishable under Article 19.13 Administrative Code.
- **Cajun Navy (Hurricane Harvey)**: phone callback before dispatching boats. Still had "dozens of false reports." Information overload was the biggest problem.
- **Ushahidi**: without verification loop, crowdsourcing amplifies misinformation.
- **Cry Wolf Effect**: documented but may be overblown — research on tornado warnings (75% false alarm rate) found public complacency doesn't correlate as strongly as assumed.

---

## Implementation Priority

1. **Now**: Tier 1 (rate limit, dedup, confidence score, adaptive mode)
2. **Next sprint**: Tier 2 (Telegram callback, cluster detection, 2-digit confirm)
3. **Backlog**: Tier 3 (trust tiers, check-ins, coordinator tools, photo evidence)
