// SPDX-License-Identifier: AGPL-3.0-only
import { logger } from "./logger.js";

/** Privileged actions we log for post-incident review. Kept as a
 * closed enum so the grep "audit_log" surface is discoverable and a
 * typo in a handler doesn't silently drop an event. */
export type AuditAction =
  | "delete_incident"
  | "delete_alert"
  | "delete_shelter"
  | "delete_help_request"
  | "delete_help_message"
  | "remove_help_participant"
  | "resolve_help_message_report"
  | "logout_all";

interface AuditEntry {
  action: AuditAction;
  actorId: string;
  targetId?: string;
  meta?: Record<string, unknown>;
}

/** Emit a structured audit-log line. Reads back as a regular pino
 * INFO entry with `audit: true` so log aggregators can filter on it
 * without parsing message strings. Intentionally not wired through a
 * DB table yet — the pino stream to stderr + Sentry is enough to
 * answer "who soft-deleted this row" without introducing a write
 * amplification on every privileged action. */
export function auditLog(entry: AuditEntry): void {
  logger.info(
    {
      audit: true,
      action: entry.action,
      actorId: entry.actorId,
      targetId: entry.targetId,
      ...entry.meta,
    },
    `audit: ${entry.action}`,
  );
}
