import { api, paginate } from "@/server/http";
import { prisma } from "@/server/db";

export const GET = api({ auth: "platform-support" }, async ({ req }) => {
  const { skip, take, page, pageSize } = paginate(req, { pageSize: 50 });
  const status = req.nextUrl.searchParams.get("status") ?? undefined;
  const where = status ? { status } : {};
  const [total, rows, totals] = await Promise.all([
    prisma.invoice.count({ where }),
    prisma.invoice.findMany({ where, skip, take, orderBy: { createdAt: "desc" }, include: { workspace: { select: { id: true, name: true } }, payments: { select: { provider: true, reference: true, amountCents: true, confirmedAt: true } } } }),
    prisma.invoice.groupBy({ by: ["status"], _sum: { totalCents: true }, _count: true }),
  ]);
  return { total, rows, page, pageSize, totals: Object.fromEntries(totals.map((t) => [t.status, { count: t._count, cents: t._sum.totalCents ?? 0 }])) };
});
