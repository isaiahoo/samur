// SPDX-License-Identifier: AGPL-3.0-only
import type { Request } from "express";

/**
 * Safely extract a route param as string.
 * Express 5 types allow string | string[] for params.
 */
export function paramId(req: Request): string {
  const id = req.params.id;
  return Array.isArray(id) ? id[0] : id;
}
