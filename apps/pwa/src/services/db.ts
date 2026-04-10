// SPDX-License-Identifier: AGPL-3.0-only
import { openDB, type DBSchema, type IDBPDatabase } from "idb";

export interface OutboxEntry {
  id: string;
  endpoint: string;
  method: "POST" | "PATCH" | "DELETE";
  body: Record<string, unknown> | null;
  createdAt: number;
  retryCount: number;
  lastRetryAt?: number;
}

interface SamurDB extends DBSchema {
  outbox: {
    key: string;
    value: OutboxEntry;
    indexes: { "by-created": number };
  };
  incidents: {
    key: string;
    value: Record<string, unknown>;
  };
  help_requests: {
    key: string;
    value: Record<string, unknown>;
  };
  shelters: {
    key: string;
    value: Record<string, unknown>;
  };
  alerts: {
    key: string;
    value: Record<string, unknown>;
  };
}

let dbPromise: Promise<IDBPDatabase<SamurDB>> | null = null;

export function getDB(): Promise<IDBPDatabase<SamurDB>> {
  if (!dbPromise) {
    dbPromise = openDB<SamurDB>("samur", 1, {
      upgrade(db) {
        const outbox = db.createObjectStore("outbox", { keyPath: "id" });
        outbox.createIndex("by-created", "createdAt");
        db.createObjectStore("incidents", { keyPath: "id" });
        db.createObjectStore("help_requests", { keyPath: "id" });
        db.createObjectStore("shelters", { keyPath: "id" });
        db.createObjectStore("alerts", { keyPath: "id" });
      },
    });
  }
  return dbPromise;
}

type StoreName = "incidents" | "help_requests" | "shelters" | "alerts";

export async function cacheItems(store: StoreName, items: Array<Record<string, unknown>>) {
  const db = await getDB();
  const tx = db.transaction(store, "readwrite");
  for (const item of items) {
    await tx.store.put(item);
  }
  await tx.done;
}

export async function getCachedItems(store: StoreName): Promise<Array<Record<string, unknown>>> {
  const db = await getDB();
  return db.getAll(store);
}

export async function getCachedItem(store: StoreName, id: string): Promise<Record<string, unknown> | undefined> {
  const db = await getDB();
  return db.get(store, id);
}

export async function addToOutbox(entry: Omit<OutboxEntry, "id" | "createdAt" | "retryCount">) {
  const db = await getDB();
  const id = crypto.randomUUID();
  await db.put("outbox", {
    ...entry,
    id,
    createdAt: Date.now(),
    retryCount: 0,
  });
  return id;
}

export async function getOutboxEntries(): Promise<OutboxEntry[]> {
  const db = await getDB();
  return db.getAllFromIndex("outbox", "by-created");
}

export async function removeFromOutbox(id: string) {
  const db = await getDB();
  await db.delete("outbox", id);
}

export async function incrementOutboxRetry(id: string) {
  const db = await getDB();
  const entry = await db.get("outbox", id);
  if (entry) {
    entry.retryCount++;
    entry.lastRetryAt = Date.now();
    await db.put("outbox", entry);
  }
}
