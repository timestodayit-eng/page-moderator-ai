import { api, paginate } from "@/server/http";
import { listUsers } from "@/server/platform/admin";

export const GET = api({ auth: "platform-support" }, async ({ req }) => {
  const { skip, take, page, pageSize } = paginate(req);
  const sp = req.nextUrl.searchParams;
  const data = await listUsers({ search: sp.get("search") ?? undefined, status: sp.get("status") ?? undefined, platformRole: sp.get("platformRole") ?? undefined, skip, take });
  return { ...data, page, pageSize };
});
