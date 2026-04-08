// SPDX-License-Identifier: AGPL-3.0-only
import { Router } from "express";
import { prisma } from "@samur/db";
import { validateBody } from "../middleware/validate.js";
import { requireApiKey } from "../middleware/apiKey.js";
import {
  SmsWebhookSchema,
  MeshtasticWebhookSchema,
  MeshtasticHeartbeatSchema,
} from "@samur/shared";
import { emitIncidentCreated, emitHelpRequestCreated } from "../lib/emitter.js";
import type { Incident, HelpRequest, HelpCategory } from "@samur/shared";

const router = Router();

// Apply API key auth to all webhook routes
router.use(requireApiKey);

// ─── SMS message parser ────────────────────────────────────────────────────

interface ParsedSms {
  action: "incident" | "help_request" | "query_shelters" | "query_levels";
  type?: string;
  category?: string;
  severity?: string;
  urgency?: string;
  address: string;
  description: string;
}

const CATEGORY_ALIASES: Record<string, string> = {
  // Russian
  еда: "food",
  вода: "water",
  лекарства: "medicine",
  медикаменты: "medicine",
  транспорт: "transport",
  генератор: "generator",
  насос: "pump",
  убежище: "shelter",
  спасение: "rescue",
  оборудование: "equipment",
  люди: "labor",
  // English
  food: "food",
  water: "water",
  medicine: "medicine",
  transport: "transport",
  generator: "generator",
  pump: "pump",
  shelter: "shelter",
  rescue: "rescue",
  equipment: "equipment",
  labor: "labor",
};

function parseSmsMessage(message: string): ParsedSms {
  const trimmed = message.trim();
  const upper = trimmed.toUpperCase();
  const lower = trimmed.toLowerCase();

  // ── Query commands (return info, no DB write) ──

  // УБЕЖИЩЕ / УКРЫТИЕ → nearest shelters
  if (
    upper.startsWith("УБЕЖИЩЕ") ||
    upper.startsWith("УКРЫТИЕ") ||
    upper.startsWith("SHELTER")
  ) {
    return { action: "query_shelters", address: "", description: "" };
  }

  // УРОВЕНЬ / LEVEL → river levels
  if (upper.startsWith("УРОВЕНЬ") || upper.startsWith("LEVEL")) {
    return { action: "query_levels", address: "", description: "" };
  }

  // ── SOS / ПОМОЩЬ → critical help request (rescue) ──

  if (upper.startsWith("SOS") || upper.startsWith("ПОМОЩЬ")) {
    const prefix = upper.startsWith("SOS") ? 3 : "ПОМОЩЬ".length;
    const rest = trimmed.slice(prefix).trim() || "Адрес не указан";
    return {
      action: "help_request",
      category: "rescue",
      urgency: "critical",
      address: rest,
      description: `SOS: ${rest}`,
    };
  }

  // ── ПОТОП / ВОДА / FLOOD / НАВОДНЕНИЕ → flood incident ──

  if (
    upper.startsWith("ПОТОП") ||
    upper.startsWith("ВОДА") ||
    upper.startsWith("FLOOD") ||
    upper.startsWith("НАВОДНЕНИЕ")
  ) {
    const prefixLen =
      upper.startsWith("ПОТОП") ? 5 :
      upper.startsWith("ВОДА") ? 4 :
      upper.startsWith("FLOOD") ? 5 :
      "НАВОДНЕНИЕ".length;
    const rest = trimmed.slice(prefixLen).trim() || "Адрес не указан";
    return {
      action: "incident",
      type: "flood",
      severity: "high",
      address: rest,
      description: `Сообщение о наводнении: ${rest}`,
    };
  }

  // ── HELP / ПОМОЩЬ [category] [description] → help request ──

  if (upper.startsWith("HELP")) {
    const rest = trimmed.slice(4).trim();
    return parseHelpBody(rest);
  }

  // ── Unrecognized → generic help request ──

  return {
    action: "help_request",
    category: "rescue",
    urgency: "urgent",
    address: trimmed,
    description: `СМС-запрос: ${trimmed}`,
  };
}

function parseHelpBody(rest: string): ParsedSms {
  const parts = rest.split(/\s+/);
  let category = "rescue";
  let descStart = 0;

  if (parts.length > 0 && parts[0]) {
    const firstWord = parts[0].toLowerCase();
    if (CATEGORY_ALIASES[firstWord]) {
      category = CATEGORY_ALIASES[firstWord];
      descStart = 1;
    }
  }

  const description = parts.slice(descStart).join(" ") || "Запрос помощи через СМС";

  return {
    action: "help_request",
    category,
    urgency: "urgent",
    address: description,
    description,
  };
}

// ─── Helper: truncate to single SMS (160 chars) ────────────────────────────

function smsReply(text: string): string {
  return text.length <= 160 ? text : text.slice(0, 157) + "...";
}

// ─── POST /sms — receive SMS from FrontlineSMS ────────────────────────────

router.post(
  "/sms",
  validateBody(SmsWebhookSchema),
  async (req, res, next) => {
    try {
      const { from, message } = req.body;
      const parsed = parseSmsMessage(message);
      const user = await prisma.user.findUnique({ where: { phone: from } });

      // Default coords: Makhachkala center
      const defaultLat = 42.9849;
      const defaultLng = 47.5047;

      // ── Query: shelters ──
      if (parsed.action === "query_shelters") {
        const shelters = await prisma.shelter.findMany({
          where: { status: "open", deletedAt: null },
          orderBy: { name: "asc" },
          take: 3,
        });

        if (shelters.length === 0) {
          res.json({
            success: true,
            data: { reply: smsReply("Нет открытых укрытий.") },
          });
          return;
        }

        const lines = shelters.map(
          (s) => `${s.name}: ${s.address}, тел ${s.contactPhone ?? "нет"}`
        );
        res.json({
          success: true,
          data: {
            reply: smsReply(`Укрытия: ${lines.join("; ")}`),
          },
        });
        return;
      }

      // ── Query: river levels ──
      if (parsed.action === "query_levels") {
        const levels = await prisma.riverLevel.findMany({
          where: { deletedAt: null },
          orderBy: { measuredAt: "desc" },
          distinct: ["riverName"],
          take: 5,
        });

        if (levels.length === 0) {
          res.json({
            success: true,
            data: { reply: smsReply("Нет данных об уровне рек.") },
          });
          return;
        }

        const trendArrow: Record<string, string> = {
          rising: "↑",
          stable: "→",
          falling: "↓",
        };
        const lines = levels.map(
          (l) =>
            `${l.riverName}: ${l.levelCm}см${trendArrow[l.trend] ?? ""}`
        );
        res.json({
          success: true,
          data: { reply: smsReply(`Реки: ${lines.join(", ")}`) },
        });
        return;
      }

      // ── Create incident ──
      if (parsed.action === "incident") {
        const incident = await prisma.incident.create({
          data: {
            userId: user?.id ?? null,
            type: parsed.type as "flood",
            severity: (parsed.severity ?? "high") as "high",
            lat: defaultLat,
            lng: defaultLng,
            address: parsed.address,
            description: parsed.description,
            source: "sms",
          },
        });

        emitIncidentCreated(incident as unknown as Incident);

        res.json({
          success: true,
          data: {
            reply: smsReply(
              `Инцидент зарегистрирован (#${incident.id.slice(0, 8)}). Спасибо.`
            ),
          },
        });
        return;
      }

      // ── Create help request ──
      const helpRequest = await prisma.helpRequest.create({
        data: {
          userId: user?.id ?? null,
          type: "need",
          category: parsed.category as HelpCategory,
          description: parsed.description,
          lat: defaultLat,
          lng: defaultLng,
          address: parsed.address,
          urgency: (parsed.urgency ?? "urgent") as "urgent",
          contactPhone: from,
          contactName: user?.name ?? null,
          source: "sms",
        },
      });

      emitHelpRequestCreated(helpRequest as unknown as HelpRequest);

      res.json({
        success: true,
        data: {
          reply: smsReply(
            `Запрос помощи принят (#${helpRequest.id.slice(0, 8)}). Мы свяжемся с вами.`
          ),
        },
      });
    } catch (err) {
      next(err);
    }
  }
);

// ─── GET /sms/broadcast — pending SMS broadcasts for FrontlineSMS ─────────

router.get("/sms/broadcast", async (_req, res, next) => {
  try {
    // Find critical alerts with "sms" channel that haven't been fully broadcast
    const alerts = await prisma.alert.findMany({
      where: {
        urgency: "critical",
        channels: { has: "sms" },
        deletedAt: null,
        OR: [
          { expiresAt: null },
          { expiresAt: { gt: new Date() } },
        ],
      },
      orderBy: { sentAt: "desc" },
      take: 10,
    });

    if (alerts.length === 0) {
      res.json({ success: true, data: { messages: [] } });
      return;
    }

    // Get all phones of registered users
    const users = await prisma.user.findMany({
      where: { phone: { not: null } },
      select: { phone: true },
    });
    const allPhones = users
      .map((u) => u.phone)
      .filter((p): p is string => p !== null);

    if (allPhones.length === 0) {
      res.json({ success: true, data: { messages: [] } });
      return;
    }

    const messages: { phone: string; message: string }[] = [];

    for (const alert of alerts) {
      // Check which phones already received this alert
      const sent = await prisma.smsBroadcastLog.findMany({
        where: { alertId: alert.id },
        select: { phone: true },
      });
      const sentSet = new Set(sent.map((s) => s.phone));

      const unsent = allPhones.filter((p) => !sentSet.has(p));
      if (unsent.length === 0) continue;

      const text = smsReply(
        `[${alert.urgency === "critical" ? "!!!" : "!"}] ${alert.title}: ${alert.body}`
      );

      for (const phone of unsent) {
        messages.push({ phone, message: text });

        // Log as sent
        await prisma.smsBroadcastLog.create({
          data: { alertId: alert.id, phone },
        });
      }
    }

    res.json({ success: true, data: { messages } });
  } catch (err) {
    next(err);
  }
});

// ─── POST /meshtastic — receive message from Meshtastic bridge ────────────

router.post(
  "/meshtastic",
  validateBody(MeshtasticWebhookSchema),
  async (req, res, next) => {
    try {
      const { node_id, message, lat, lng } = req.body;

      const effectiveLat = lat ?? 42.9849;
      const effectiveLng = lng ?? 47.5047;

      const upper = message.trim().toUpperCase();

      // Parse LEVEL command: "LEVEL Sulak 350"
      if (upper.startsWith("LEVEL") || upper.startsWith("УРОВЕНЬ")) {
        const prefixLen = upper.startsWith("LEVEL") ? 5 : "УРОВЕНЬ".length;
        const rest = message.trim().slice(prefixLen).trim();
        const parts = rest.split(/\s+/);

        if (parts.length >= 2) {
          const riverName = parts.slice(0, -1).join(" ");
          const levelCm = parseFloat(parts[parts.length - 1]);

          if (!isNaN(levelCm) && riverName) {
            await prisma.riverLevel.create({
              data: {
                riverName,
                stationName: `Meshtastic ${node_id}`,
                lat: effectiveLat,
                lng: effectiveLng,
                levelCm,
                dangerLevelCm: 500, // default danger level
                trend: "stable",
                measuredAt: new Date(),
              },
            });

            res.json({
              success: true,
              data: {
                type: "river_level",
                reply: `Уровень ${riverName}: ${levelCm}см записан`,
              },
            });
            return;
          }
        }
      }

      // Parse OK command: "OK [request_id_prefix]"
      if (upper.startsWith("OK ")) {
        const idPrefix = message.trim().slice(3).trim();
        if (idPrefix.length >= 4) {
          const requests = await prisma.helpRequest.findMany({
            where: {
              id: { startsWith: idPrefix },
              status: { in: ["open", "claimed", "in_progress"] },
              deletedAt: null,
            },
            take: 1,
          });

          if (requests.length > 0) {
            await prisma.helpRequest.update({
              where: { id: requests[0].id },
              data: { status: "completed" },
            });

            res.json({
              success: true,
              data: {
                type: "status_update",
                id: requests[0].id,
                reply: `Запрос #${requests[0].id.slice(0, 8)} завершён`,
              },
            });
            return;
          }
        }
      }

      // Reuse SMS parser for SOS/HELP/FLOOD messages
      const parsed = parseSmsMessage(message);

      if (parsed.action === "query_shelters" || parsed.action === "query_levels") {
        // Mesh queries — return short text
        if (parsed.action === "query_shelters") {
          const shelters = await prisma.shelter.findMany({
            where: { status: "open", deletedAt: null },
            take: 3,
          });
          const reply =
            shelters.length === 0
              ? "Нет укрытий"
              : shelters.map((s) => `${s.name}: ${s.address}`).join("; ");
          res.json({ success: true, data: { type: "query", reply } });
          return;
        }
        // query_levels
        const levels = await prisma.riverLevel.findMany({
          where: { deletedAt: null },
          orderBy: { measuredAt: "desc" },
          distinct: ["riverName"],
          take: 5,
        });
        const reply =
          levels.length === 0
            ? "Нет данных"
            : levels.map((l) => `${l.riverName}:${l.levelCm}см`).join(" ");
        res.json({ success: true, data: { type: "query", reply } });
        return;
      }

      if (parsed.action === "incident") {
        const incident = await prisma.incident.create({
          data: {
            type: parsed.type as "flood",
            severity: (parsed.severity ?? "high") as "high",
            lat: effectiveLat,
            lng: effectiveLng,
            address: parsed.address,
            description: `[Meshtastic ${node_id}] ${parsed.description}`,
            source: "meshtastic",
          },
        });

        emitIncidentCreated(incident as unknown as Incident);

        res.json({
          success: true,
          data: {
            type: "incident",
            id: incident.id,
            reply: `Инцидент #${incident.id.slice(0, 8)} создан`,
          },
        });
      } else {
        const helpRequest = await prisma.helpRequest.create({
          data: {
            type: "need",
            category: parsed.category as HelpCategory,
            description: `[Meshtastic ${node_id}] ${parsed.description}`,
            lat: effectiveLat,
            lng: effectiveLng,
            address: parsed.address,
            urgency: (parsed.urgency ?? "urgent") as "urgent",
            contactName: `Meshtastic node ${node_id}`,
            source: "meshtastic",
          },
        });

        emitHelpRequestCreated(helpRequest as unknown as HelpRequest);

        res.json({
          success: true,
          data: {
            type: "help_request",
            id: helpRequest.id,
            reply: `Запрос #${helpRequest.id.slice(0, 8)} создан`,
          },
        });
      }
    } catch (err) {
      next(err);
    }
  }
);

// ─── POST /meshtastic/heartbeat — bridge health check ─────────────────────

router.post(
  "/meshtastic/heartbeat",
  validateBody(MeshtasticHeartbeatSchema),
  async (req, res, next) => {
    try {
      const { node_id, uptime_seconds, battery_level, channel_utilization } =
        req.body;

      await prisma.channelHeartbeat.upsert({
        where: { channel: "meshtastic" },
        update: {
          lastSeen: new Date(),
          metadata: {
            node_id,
            uptime_seconds,
            battery_level,
            channel_utilization,
          },
        },
        create: {
          channel: "meshtastic",
          lastSeen: new Date(),
          metadata: {
            node_id,
            uptime_seconds,
            battery_level,
            channel_utilization,
          },
        },
      });

      res.json({ success: true, data: { ack: true } });
    } catch (err) {
      next(err);
    }
  }
);

export default router;
