import { randomInt } from "node:crypto";

const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

export function newInviteCode(): string {
  let out = "";
  for (let i = 0; i < 12; i += 1) out += ALPHABET[randomInt(ALPHABET.length)];
  return out;
}
