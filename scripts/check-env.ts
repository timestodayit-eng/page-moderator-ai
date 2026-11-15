import "dotenv/config";
import { validateEnv } from "../src/server/env";
const { errors } = validateEnv();
if (errors.length) {
  console.error("Environment problems:\n - " + errors.join("\n - "));
  process.exit(1);
}
console.log("Environment OK");
