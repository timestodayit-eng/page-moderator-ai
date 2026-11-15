/**
 * Creates (or promotes) the platform Super Admin and the three internal business workspaces.
 *   ADMIN_EMAIL=owner@example.com ADMIN_PASSWORD='...' ADMIN_NAME='Jamil' npm run admin:bootstrap
 * Password is never printed. Safe to re-run.
 */
import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { hashPassword, passwordPolicyError } from "../src/server/auth/password";
import { createWorkspace, ensureWorkspaceRoles } from "../src/server/platform/workspaces";

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });
const INTERNAL = ["Creative International", "Coastal Manpower", "SM Enterprise"];

async function main() {
  const email = (process.env.ADMIN_EMAIL ?? "").trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD ?? "";
  const name = process.env.ADMIN_NAME ?? "Platform Owner";
  if (!email) throw new Error("ADMIN_EMAIL is required");
  let user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    const err = passwordPolicyError(password);
    if (err) throw new Error(`ADMIN_PASSWORD: ${err}`);
    user = await prisma.user.create({ data: { email, name, passwordHash: await hashPassword(password), platformRole: "SUPER_ADMIN", emailVerifiedAt: new Date() } });
    console.log(`Created super admin ${email}`);
  } else {
    user = await prisma.user.update({ where: { id: user.id }, data: { platformRole: "SUPER_ADMIN", status: "ACTIVE", emailVerifiedAt: user.emailVerifiedAt ?? new Date() } });
    console.log(`Promoted existing user ${email} to SUPER_ADMIN`);
  }
  for (const wsName of INTERNAL) {
    const existing = await prisma.workspace.findFirst({ where: { name: wsName, type: "INTERNAL" } });
    if (existing) {
      await ensureWorkspaceRoles(existing.id);
      console.log(`Workspace exists: ${wsName}`);
      continue;
    }
    const ws = await prisma.$transaction((tx) => createWorkspace({ name: wsName, ownerUserId: user!.id, type: "INTERNAL", billingExempt: true, planKey: "enterprise", actorUserId: user!.id }, tx));
    console.log(`Created internal workspace: ${wsName} (${ws.slug})`);
  }
}

main()
  .catch((e) => {
    console.error(e.message ?? e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
