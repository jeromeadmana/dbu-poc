/**
 * Bootstrap: promote an existing user to ADMIN role by email.
 *
 * Usage:  npm run make:admin <email>
 *
 * After running, the user must sign out + sign back in to get a fresh JWT
 * with role=ADMIN (otherwise middleware still sees the old CLIENT/BARBER claim).
 */

import { db } from "../src/lib/db";

async function main() {
  const email = process.argv[2];
  if (!email) {
    console.error("Usage: npm run make:admin <email>");
    process.exit(1);
  }

  const normalized = email.toLowerCase();
  const user = await db.user.findUnique({
    where: { email: normalized },
    select: { id: true, name: true, email: true, role: true },
  });
  if (!user) {
    console.error(`No user with email ${normalized}`);
    process.exit(1);
  }
  if (user.role === "ADMIN") {
    console.log(`${user.name} <${user.email}> is already ADMIN.`);
    await db.$disconnect();
    return;
  }

  await db.user.update({
    where: { id: user.id },
    data: { role: "ADMIN" },
  });

  console.log(`✓ Promoted ${user.name} <${user.email}> from ${user.role} to ADMIN.`);
  console.log("  (sign out + sign back in to refresh the JWT)");
  await db.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await db.$disconnect();
  process.exit(1);
});
