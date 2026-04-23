import type { NextAuthConfig } from "next-auth";
import type { Role, Rank } from "@prisma/client";

/**
 * Edge-safe auth config.
 * Used by middleware.ts (runs on Edge runtime — no Prisma, no Node APIs).
 * The full config in auth.ts extends this with the Credentials provider.
 */
export const authConfig = {
  pages: {
    signIn: "/signin",
  },
  session: {
    strategy: "jwt",
  },
  callbacks: {
    authorized({ request, auth }) {
      const path = request.nextUrl.pathname;
      const session = auth;
      const role = session?.user?.role;

      if (path.startsWith("/admin")) {
        return !!session && role === "ADMIN";
      }
      if (path.startsWith("/barber")) {
        return !!session && (role === "BARBER" || role === "ADMIN");
      }
      if (path.startsWith("/client")) {
        return !!session;
      }
      return true;
    },
    jwt({ token, user, trigger, session }) {
      if (user) {
        token.id = user.id as string;
        token.role = (user as { role: Role }).role;
        token.rank = (user as { rank: Rank | null }).rank;
      }
      // Refresh role/rank when server action calls `unstable_update({ user: { role, rank } })`.
      // Needed because the JWT is otherwise stamped at signin and becomes stale when we
      // change user.role in the DB (e.g. CLIENT → BARBER via becomeBarberAction).
      if (trigger === "update" && session && typeof session === "object" && "user" in session) {
        const updated = (session as { user?: { role?: Role; rank?: Rank | null } }).user;
        if (updated) {
          if (updated.role) token.role = updated.role;
          if ("rank" in updated) token.rank = updated.rank ?? null;
        }
      }
      return token;
    },
    session({ session, token }) {
      if (token && session.user) {
        session.user.id = token.id as string;
        session.user.role = token.role as Role;
        session.user.rank = token.rank as Rank | null;
      }
      return session;
    },
  },
  providers: [],
} satisfies NextAuthConfig;
