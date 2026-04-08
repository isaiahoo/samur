// SPDX-License-Identifier: AGPL-3.0-only
import type { Request, Response, NextFunction } from "express";
import { type ZodSchema, ZodError } from "zod";

/**
 * Express middleware that validates req.body against a Zod schema.
 * On success, replaces req.body with the parsed (coerced/defaulted) value.
 * On failure, returns 400 with structured validation errors.
 */
export function validateBody(schema: ZodSchema) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      const formatted = formatZodError(result.error);
      res.status(400).json({
        success: false,
        error: {
          code: "VALIDATION_ERROR",
          message: "Ошибка валидации данных",
          details: formatted,
        },
      });
      return;
    }
    req.body = result.data;
    next();
  };
}

export function validateQuery(schema: ZodSchema) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.query);
    if (!result.success) {
      const formatted = formatZodError(result.error);
      res.status(400).json({
        success: false,
        error: {
          code: "VALIDATION_ERROR",
          message: "Ошибка валидации параметров запроса",
          details: formatted,
        },
      });
      return;
    }
    (req as Request & { parsedQuery: unknown }).parsedQuery = result.data;
    next();
  };
}

function formatZodError(error: ZodError): Record<string, string[]> {
  const formatted: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const path = issue.path.join(".") || "_root";
    if (!formatted[path]) formatted[path] = [];
    formatted[path].push(issue.message);
  }
  return formatted;
}
