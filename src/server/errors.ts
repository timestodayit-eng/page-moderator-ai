export class AppError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export const Errors = {
  unauthorized: () => new AppError(401, "UNAUTHORIZED", "Authentication required"),
  forbidden: (msg = "You do not have permission to perform this action") => new AppError(403, "FORBIDDEN", msg),
  notFound: (what = "Resource") => new AppError(404, "NOT_FOUND", `${what} not found`),
  badRequest: (msg: string, details?: unknown) => new AppError(400, "BAD_REQUEST", msg, details),
  conflict: (msg: string) => new AppError(409, "CONFLICT", msg),
  rateLimited: (retryAfter: number) => new AppError(429, "RATE_LIMITED", "Too many requests, please slow down", { retryAfter }),
  limitReached: (msg: string) => new AppError(402, "PLAN_LIMIT", msg),
  unavailable: (msg: string) => new AppError(503, "UNAVAILABLE", msg),
  notConfigured: (what: string) => new AppError(503, "NOT_CONFIGURED", `${what} is not configured on this server. See README → configuration.`),
};
