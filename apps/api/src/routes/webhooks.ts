// SPDX-License-Identifier: AGPL-3.0-only
import { Router } from "express";
import { prisma } from "@samur/db";
import { validateBody } from "../middleware/validate.js";
import { SmsWebhookSchema, MeshtasticWebhookSchema } from "@samur/shared";
import { emitIncidentCreated, emitHelpRequestCreated } from "../lib/emitter.js";
import type { Incident, HelpRequest, HelpCategory } from "@samur/shared";

const router = Router();

/**
 * Parse SMS message format:
 * "SOS [address]" → critical help request (rescue)
 * "FLOOD [address]" → flood incident
 * "HELP [category] [address] [description]" → help request
 * Anything else → generic help request
 */
function parseSmsMessage(message: string): {
  action: "incident" | "help_request";
  type?: string;
  category?: string;
  severity?: string;
  urgency?: string;
  address: string;
  description: string;
} {
  const trimmed = message.trim();
  const upper = trimmed.toUpperCase();

  // SOS [address]
  if (upper.startsWith("SOS")) {
    const address = trimmed.slice(3).trim() || "Адрес не указан";
    return {
      action: "help_request",
      category: "rescue",
      urgency: "critical",
      address,
      description: `SOS: ${address}`,
    };
  }

  // FLOOD [address] / НАВОДНЕНИЕ [address]
  if (upper.startsWith("FLOOD") || upper.startsWith("НАВОДНЕНИЕ")) {
    const prefix = upper.startsWith("FLOOD") ? "FLOOD" : "НАВОДНЕНИЕ";
    const address = trimmed.slice(prefix.length).trim() || "Адрес не указан";
    return {
      action: "incident",
      type: "flood",
      severity: "high",
      address,
      description: `Сообщение о наводнении: ${address}`,
    };
  }

  // HELP [category] [address] [description]
  // ПОМОЩЬ [category] [address] [description]
  if (upper.startsWith("HELP") || upper.startsWith("ПОМОЩЬ")) {
    const prefix = upper.startsWith("HELP") ? "HELP" : "ПОМОЩЬ";
    const rest = trimmed.slice(prefix.length).trim();
    const parts = rest.split(/\s+/);

    const validCategories = [
      "rescue", "shelter", "food", "water", "medicine",
      "equipment", "transport", "labor", "generator", "pump",
    ];
    const categoryMap: Record<string, string> = {
      // Russian aliases
      "еда": "food", "вода": "water", "лекарства": "medicine",
      "медикаменты": "medicine", "транспорт": "transport",
      "генератор": "generator", "насос": "pump", "убежище": "shelter",
      "спасение": "rescue", "оборудование": "equipment", "люди": "labor",
    };

    let category = "rescue";
    let descStart = 0;
    if (parts.length > 0) {
      const firstWord = parts[0].toLowerCase();
      if (validCategories.includes(firstWord)) {
        category = firstWord;
        descStart = 1;
      } else if (categoryMap[firstWord]) {
        category = categoryMap[firstWord];
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

  return {
    action: "help_request",
    category: "rescue",
    urgency: "urgent",
    address: trimmed,
    description: `СМС-запрос: ${trimmed}`,
  };
}

router.post(
  "/sms",
  validateBody(SmsWebhookSchema),
  async (req, res, next) => {
    try {
      const { from, message } = req.body;

      const user = await prisma.user.findUnique({ where: { phone: from } });

      const parsed = parseSmsMessage(message);

      // Default coordinates: Makhachkala center (for SMS without GPS)
      const defaultLat = 42.9849;
      const defaultLng = 47.5047;

      let responseText: string;

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
        responseText = `Инцидент зарегистрирован (ID: ${incident.id.slice(0, 8)}). Спасибо за сообщение.`;
      } else {
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
        responseText = `Запрос помощи принят (ID: ${helpRequest.id.slice(0, 8)}). Мы свяжемся с вами.`;
      }

      res.json({
        success: true,
        data: { reply: responseText },
      });
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  "/meshtastic",
  validateBody(MeshtasticWebhookSchema),
  async (req, res, next) => {
    try {
      const { node_id, message, lat, lng } = req.body;

      const effectiveLat = lat ?? 42.9849;
      const effectiveLng = lng ?? 47.5047;

      const parsed = parseSmsMessage(message);

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

export default router;
