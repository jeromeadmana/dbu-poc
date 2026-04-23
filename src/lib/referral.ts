import { randomBytes } from "crypto";
import { db } from "./db";

// No 0/O, 1/I/L — unambiguous when spoken or written
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

export function generateReferralCode(length = 6): string {
  const bytes = randomBytes(length);
  let code = "";
  for (let i = 0; i < length; i++) {
    code += ALPHABET[bytes[i] % ALPHABET.length];
  }
  return code;
}

export async function generateUniqueReferralCode(maxAttempts = 10): Promise<string> {
  for (let i = 0; i < maxAttempts; i++) {
    const code = generateReferralCode();
    const existing = await db.user.findUnique({
      where: { referralCode: code },
      select: { id: true },
    });
    if (!existing) return code;
  }
  throw new Error(`Could not generate unique referral code after ${maxAttempts} attempts`);
}
