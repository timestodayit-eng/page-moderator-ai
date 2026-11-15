import { hash, verify } from "@node-rs/argon2";

// Argon2id with OWASP-recommended parameters.
const OPTS = { memoryCost: 19456, timeCost: 2, parallelism: 1, outputLen: 32 } as const;

export async function hashPassword(password: string) {
  return hash(password, OPTS);
}

export async function verifyPassword(hashValue: string, password: string) {
  try {
    return await verify(hashValue, password);
  } catch {
    return false;
  }
}

export function passwordPolicyError(password: string): string | null {
  if (password.length < 10) return "Password must be at least 10 characters";
  if (password.length > 200) return "Password is too long";
  if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) return "Password must contain letters and numbers";
  return null;
}

// Dummy hash used to equalise timing when the account does not exist.
export const DUMMY_HASH = "$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHRzb21lc2FsdA$0nKXc2nZx2Q4Rr5d0p0f4b7q4b2kq0zv0YmQe0Kq6gA";
