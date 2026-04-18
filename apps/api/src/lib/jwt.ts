// SPDX-License-Identifier: AGPL-3.0-only
import jwt from "jsonwebtoken";
import { config } from "../config.js";

/** Single source of truth for JWT minting. All four auth paths (password,
 * phone-OTP, Telegram, VK) converge here so the payload shape stays
 * consistent and the tokenVersion field is never accidentally omitted
 * — missing it would leave a revocation-immune door.
 *
 * Algorithm is always HS256 (matches the verify-side pinning in
 * middleware/auth.ts and socket.ts). */
export function signToken(
  userId: string,
  role: string,
  tokenVersion: number,
): string {
  return jwt.sign(
    { sub: userId, role, tokenVersion },
    config.JWT_SECRET,
    {
      algorithm: "HS256",
      expiresIn: config.JWT_EXPIRES_IN,
    } as jwt.SignOptions,
  );
}
