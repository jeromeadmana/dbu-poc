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
});

export async function signupAction(formData: FormData) {
  const parsed = signupSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
    name: formData.get("name"),
    ref: formData.get("ref") || undefined,
  });

  if (!parsed.success) {
    const msg = parsed.error.issues[0]?.message ?? "Invalid input";
    redirect(`/signup?error=${encodeURIComponent(msg)}`);
  }

  const { email, password, name, ref } = parsed.data;
  const normalizedEmail = email.toLowerCase();

  const existing = await db.user.findUnique({ where: { email: normalizedEmail } });
  if (existing) {
    redirect(`/signup?error=${encodeURIComponent("Email already in use")}`);
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
    redirectTo: "/",
  });
}

const signinSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export async function signinAction(formData: FormData) {
  const parsed = signinSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    redirect(`/signin?error=${encodeURIComponent("Invalid input")}`);
  }

  try {
    await signIn("credentials", {
      email: parsed.data.email.toLowerCase(),
      password: parsed.data.password,
      redirectTo: "/",
    });
  } catch (error) {
    if (error instanceof AuthError) {
      redirect(`/signin?error=${encodeURIComponent("Invalid email or password")}`);
    }
    throw error; // re-throw NEXT_REDIRECT
  }
}
