"use server";

import { z } from "zod";
import bcrypt from "bcryptjs";
import { redirect } from "next/navigation";
import { AuthError } from "next-auth";
import { db } from "@/lib/db";
import { generateUniqueReferralCode } from "@/lib/referral";
import { signIn } from "@/auth";

const signupSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8, "Password must be at least 8 characters"),
  name: z.string().min(1, "Name is required"),
  ref: z.string().optional(),
  callbackUrl: z.string().optional(),
});

function sanitizeCallback(raw: string | null | undefined): string {
  const value = raw ?? "";
  // Only allow relative paths starting with "/" to prevent open-redirect abuse.
  if (!value.startsWith("/") || value.startsWith("//")) return "/";
  return value;
}

export async function signupAction(formData: FormData) {
  const callbackUrl = sanitizeCallback(formData.get("callbackUrl")?.toString());
  const refValue = formData.get("ref")?.toString();

  const parsed = signupSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
    name: formData.get("name"),
    ref: refValue || undefined,
    callbackUrl,
  });

  if (!parsed.success) {
    const msg = parsed.error.issues[0]?.message ?? "Invalid input";
    const qs = new URLSearchParams({ error: msg });
    if (refValue) qs.set("ref", refValue);
    if (callbackUrl !== "/") qs.set("callbackUrl", callbackUrl);
    redirect(`/signup?${qs.toString()}`);
  }

  const { email, password, name, ref } = parsed.data;
  const normalizedEmail = email.toLowerCase();

  const existing = await db.user.findUnique({ where: { email: normalizedEmail } });
  if (existing) {
    const qs = new URLSearchParams({ error: "Email already in use" });
    if (refValue) qs.set("ref", refValue);
    if (callbackUrl !== "/") qs.set("callbackUrl", callbackUrl);
    redirect(`/signup?${qs.toString()}`);
  }

  let sponsorId: string | null = null;
  if (ref) {
    const sponsor = await db.user.findUnique({
      where: { referralCode: ref.toUpperCase() },
      select: { id: true },
    });
    if (sponsor) sponsorId = sponsor.id;
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const referralCode = await generateUniqueReferralCode();

  await db.user.create({
    data: {
      email: normalizedEmail,
      passwordHash,
      name,
      referralCode,
      sponsorId,
      role: "CLIENT",
    },
  });

  // signIn throws NEXT_REDIRECT on success — let it propagate.
  await signIn("credentials", {
    email: normalizedEmail,
    password,
    redirectTo: callbackUrl,
  });
}

const signinSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export async function signinAction(formData: FormData) {
  const callbackUrl = sanitizeCallback(formData.get("callbackUrl")?.toString());

  const parsed = signinSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    const qs = new URLSearchParams({ error: "Invalid input" });
    if (callbackUrl !== "/") qs.set("callbackUrl", callbackUrl);
    redirect(`/signin?${qs.toString()}`);
  }

  try {
    await signIn("credentials", {
      email: parsed.data.email.toLowerCase(),
      password: parsed.data.password,
      redirectTo: callbackUrl,
    });
  } catch (error) {
    if (error instanceof AuthError) {
      const qs = new URLSearchParams({ error: "Invalid email or password" });
      if (callbackUrl !== "/") qs.set("callbackUrl", callbackUrl);
      redirect(`/signin?${qs.toString()}`);
    }
    throw error; // re-throw NEXT_REDIRECT
  }
}
