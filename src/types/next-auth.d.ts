import type { Role, Rank } from "@prisma/client";
import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      role: Role;
      rank: Rank | null;
    } & DefaultSession["user"];
  }

  interface User {
    id: string;
    role: Role;
    rank: Rank | null;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id: string;
    role: Role;
    rank: Rank | null;
  }
}
