// SPDX-License-Identifier: AGPL-3.0-only
import { describe, it, expect } from "vitest";
import request from "supertest";
import { createTestApp } from "./setup.js";

const app = createTestApp();

describe("POST /api/v1/webhook/sms", () => {
  it("parses SOS message as critical help request", async () => {
    const res = await request(app)
      .post("/api/v1/webhook/sms")
      .send({ from: "+79281234567", message: "SOS ул. Ленина 15" });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.reply).toContain("Запрос помощи принят");
  });

  it("parses ПОМОЩЬ as critical help request", async () => {
    const res = await request(app)
      .post("/api/v1/webhook/sms")
      .send({ from: "+79281234567", message: "ПОМОЩЬ нужна эвакуация" });

    expect(res.status).toBe(200);
    expect(res.body.data.reply).toContain("Запрос помощи принят");
  });

  it("parses ПОТОП as flood incident", async () => {
    const res = await request(app)
      .post("/api/v1/webhook/sms")
      .send({ from: "+79281234567", message: "ПОТОП ул. Гагарина 10" });

    expect(res.status).toBe(200);
    expect(res.body.data.reply).toContain("Инцидент зарегистрирован");
  });

  it("parses ВОДА as flood incident", async () => {
    const res = await request(app)
      .post("/api/v1/webhook/sms")
      .send({ from: "+79281234567", message: "ВОДА затопило двор" });

    expect(res.status).toBe(200);
    expect(res.body.data.reply).toContain("Инцидент зарегистрирован");
  });

  it("parses FLOOD as flood incident", async () => {
    const res = await request(app)
      .post("/api/v1/webhook/sms")
      .send({ from: "+79281234567", message: "FLOOD center street" });

    expect(res.status).toBe(200);
    expect(res.body.data.reply).toContain("Инцидент зарегистрирован");
  });

  it("parses УБЕЖИЩЕ as shelter query", async () => {
    const res = await request(app)
      .post("/api/v1/webhook/sms")
      .send({ from: "+79281234567", message: "УБЕЖИЩЕ" });

    expect(res.status).toBe(200);
    expect(res.body.data.reply).toMatch(/Укрытия|Нет открытых укрытий/);
  });

  it("parses УРОВЕНЬ as river levels query", async () => {
    const res = await request(app)
      .post("/api/v1/webhook/sms")
      .send({ from: "+79281234567", message: "УРОВЕНЬ" });

    expect(res.status).toBe(200);
    expect(res.body.data.reply).toMatch(/Реки|Нет данных/);
  });

  it("parses HELP with category", async () => {
    const res = await request(app)
      .post("/api/v1/webhook/sms")
      .send({ from: "+79281234567", message: "HELP food нужна еда для 5 человек" });

    expect(res.status).toBe(200);
    expect(res.body.data.reply).toContain("Запрос помощи принят");
  });

  it("parses unrecognized text as generic help request", async () => {
    const res = await request(app)
      .post("/api/v1/webhook/sms")
      .send({ from: "+79281234567", message: "нам плохо помогите" });

    expect(res.status).toBe(200);
    expect(res.body.data.reply).toContain("Запрос помощи принят");
  });

  it("rejects empty message", async () => {
    const res = await request(app)
      .post("/api/v1/webhook/sms")
      .send({ from: "+79281234567", message: "" });

    expect(res.status).toBe(400);
  });

  it("replies are under 160 characters", async () => {
    const res = await request(app)
      .post("/api/v1/webhook/sms")
      .send({ from: "+79281234567", message: "SOS " + "a".repeat(500) });

    expect(res.status).toBe(200);
    expect(res.body.data.reply.length).toBeLessThanOrEqual(160);
  });
});

describe("POST /api/v1/webhook/meshtastic", () => {
  it("creates incident from SOS message", async () => {
    const res = await request(app)
      .post("/api/v1/webhook/meshtastic")
      .send({ node_id: "!abc123", message: "SOS вода в подвале" });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.type).toBe("help_request");
  });

  it("creates incident with GPS coordinates", async () => {
    const res = await request(app)
      .post("/api/v1/webhook/meshtastic")
      .send({
        node_id: "!abc123",
        message: "FLOOD подвал затоплен",
        lat: 42.98,
        lng: 47.50,
      });

    expect(res.status).toBe(200);
    expect(res.body.data.type).toBe("incident");
  });

  it("parses LEVEL command for river data", async () => {
    const res = await request(app)
      .post("/api/v1/webhook/meshtastic")
      .send({ node_id: "!abc123", message: "LEVEL Сулак 350" });

    expect(res.status).toBe(200);
    expect(res.body.data.type).toBe("river_level");
  });

  it("rejects missing node_id", async () => {
    const res = await request(app)
      .post("/api/v1/webhook/meshtastic")
      .send({ message: "SOS" });

    expect(res.status).toBe(400);
  });
});

describe("POST /api/v1/webhook/meshtastic/heartbeat", () => {
  it("accepts heartbeat", async () => {
    const res = await request(app)
      .post("/api/v1/webhook/meshtastic/heartbeat")
      .send({ node_id: "bridge" });

    expect(res.status).toBe(200);
    expect(res.body.data.ack).toBe(true);
  });
});

describe("GET /api/v1/webhook/sms/broadcast", () => {
  it("returns broadcast messages array", async () => {
    const res = await request(app).get("/api/v1/webhook/sms/broadcast");

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.messages).toBeInstanceOf(Array);
  });
});
