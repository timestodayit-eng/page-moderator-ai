/**
 * Offline-friendly migration driver that uses Prisma's WebAssembly schema engine
 * (the same engine `prisma migrate` uses) through the pg driver adapter.
 *
 * Why: environments that cannot reach binaries.prisma.sh (the Prisma CLI downloads its
 * native schema-engine binary on first use) still need to create and apply migrations.
 * It produces exactly the same migration files and `_prisma_migrations` bookkeeping as the
 * CLI, so `prisma migrate deploy` on the server stays fully compatible.
 *
 *   tsx scripts/prisma-wasm-migrate.ts create <name>   # diff schema vs migrations -> new migration dir
 *   tsx scripts/prisma-wasm-migrate.ts deploy          # apply pending migrations (like migrate deploy)
 *   tsx scripts/prisma-wasm-migrate.ts status          # show pending / applied
 */
import "dotenv/config";
import { readFileSync, readdirSync, existsSync, mkdirSync, writeFileSync, statSync } from "node:fs";
import path from "node:path";
import pg from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { bindMigrationAwareSqlAdapterFactory } from "@prisma/driver-adapter-utils";
import { createRequire } from "node:module";

// The wasm package's entry imports a .wasm file directly (bundler-style); instantiate it by hand.
async function loadSchemaEngine() {
  const require = createRequire(import.meta.url);
  const pkgDir = path.dirname(require.resolve("@prisma/schema-engine-wasm/schema_engine_bg"));
  const bg = (await import(path.join(pkgDir, "schema_engine_bg.js"))) as typeof import("@prisma/schema-engine-wasm/schema_engine_bg");
  const bytes = readFileSync(path.join(pkgDir, "schema_engine_bg.wasm"));
  const { instance } = await WebAssembly.instantiate(bytes, { "./schema_engine_bg.js": bg as unknown as WebAssembly.ModuleImports });
  bg.__wbg_set_wasm(instance.exports);
  (instance.exports as { __wbindgen_start?: () => void }).__wbindgen_start?.();
  return bg.SchemaEngine;
}

const root = process.cwd();

/**
 * The engine's introspection queries return Postgres internal "char" columns (OID 18, e.g. relkind),
 * which @prisma/adapter-pg does not map. Present them as text so the WASM engine can describe the schema.
 */
class PatchedClient extends pg.Client {
  override query(...args: unknown[]): never {
    const fix = (res: { fields?: { dataTypeID: number }[] } | undefined) => {
      for (const f of res?.fields ?? []) if (f.dataTypeID === 18) f.dataTypeID = 25;
      return res;
    };
    const last = args[args.length - 1];
    if (typeof last === "function") {
      args[args.length - 1] = (err: unknown, res: never) => (last as (e: unknown, r: unknown) => void)(err, fix(res));
      return (super.query as (...a: unknown[]) => never)(...args);
    }
    const result = (super.query as (...a: unknown[]) => unknown)(...args);
    if (result && typeof (result as Promise<unknown>).then === "function") return (result as Promise<never>).then(fix as never) as never;
    return result as never;
  }
}
const makePool = (connectionString: string) => new pg.Pool({ connectionString, Client: PatchedClient as never });
const schemaPath = path.join(root, "prisma/schema.prisma");
const migrationsDir = path.join(root, "prisma/migrations");

function migrationList() {
  if (!existsSync(migrationsDir)) mkdirSync(migrationsDir, { recursive: true });
  const lockPath = path.join(migrationsDir, "migration_lock.toml");
  const dirs = readdirSync(migrationsDir).filter((d) => statSync(path.join(migrationsDir, d)).isDirectory()).sort();
  return {
    baseDir: migrationsDir,
    lockfile: { path: "migration_lock.toml", content: existsSync(lockPath) ? readFileSync(lockPath, "utf8") : null },
    shadowDbInitScript: "",
    migrationDirectories: dirs.map((d) => {
      const file = path.join(migrationsDir, d, "migration.sql");
      return {
        path: d,
        migrationFile: {
          path: "migration.sql",
          content: existsSync(file) ? { tag: "ok" as const, value: readFileSync(file, "utf8") } : { tag: "error" as const, value: "missing migration.sql" },
        },
      };
    }),
  };
}

async function main() {
  const [cmd, name] = process.argv.slice(2);
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required");
  const schema = readFileSync(schemaPath, "utf8");
  const factory = new PrismaPg(makePool(url));
  // The engine speaks the error-capturing adapter protocol ({ ok, value } results); bind the factory.
  // Shadow database (used only by `create` for diffing): a temporary DB created next to the main one.
  const shadowUrl = new URL(url);
  const shadowName = `${shadowUrl.pathname.slice(1)}_shadow_${Date.now().toString(36)}`;
  shadowUrl.pathname = `/${shadowName}`;
  const admin = new pg.Client({ connectionString: url });
  let shadowCreated = false;
  const ensureShadow = async () => {
    if (shadowCreated) return;
    await admin.connect();
    await admin.query(`CREATE DATABASE "${shadowName}"`);
    shadowCreated = true;
  };
  const shadowFactory = new PrismaPg(makePool(shadowUrl.toString()));
  const adapter = bindMigrationAwareSqlAdapterFactory({
    provider: factory.provider,
    adapterName: factory.adapterName,
    connect: () => factory.connect(),
    connectToShadowDb: async () => {
      await ensureShadow();
      return shadowFactory.connect();
    },
  });
  const SchemaEngine = await loadSchemaEngine();
  const engine = await SchemaEngine.new({ datamodels: [["schema.prisma", schema]] }, () => {}, adapter);
  const schemaContainer = { files: [{ path: "schema.prisma", content: schema }] };
  const filters = { externalTables: [], externalEnums: [] };

  try {
    if (cmd === "create") {
      if (!name) throw new Error("usage: create <name>");
      // Build the "current" state in a temporary database by replaying existing migrations,
      // then diff it against the desired schema. Equivalent to Prisma's shadow-database step.
      await ensureShadow();
      const shadow = new pg.Client({ connectionString: shadowUrl.toString() });
      await shadow.connect();
      for (const m of migrationList().migrationDirectories) {
        if (m.migrationFile.content.tag === "ok") await shadow.query(m.migrationFile.content.value);
      }
      await shadow.end();
      // A second engine whose datasource is the replayed temp database.
      const shadowEngine = await SchemaEngine.new(
        { datamodels: [["schema.prisma", schema]] },
        () => {},
        bindMigrationAwareSqlAdapterFactory({
          provider: shadowFactory.provider,
          adapterName: shadowFactory.adapterName,
          connect: () => shadowFactory.connect(),
          connectToShadowDb: () => shadowFactory.connect(),
        }),
      );
      let res: unknown;
      try {
        res = await shadowEngine.diff({
          from: { tag: "schemaDatasource", files: schemaContainer.files, configDir: path.dirname(schemaPath) },
          to: { tag: "schemaDatamodel", ...schemaContainer },
          script: true,
          exitCode: null,
          filters,
        } as never);
      } finally {
        shadowEngine.free();
      }
      const script = (res as unknown as { stdout?: string | null }).stdout?.trim();
      if (!script) {
        console.log("No schema changes detected — nothing to create.");
        return;
      }
      const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
      const dirName = `${stamp}_${name}`;
      const dir = path.join(migrationsDir, dirName);
      mkdirSync(dir, { recursive: true });
      writeFileSync(path.join(dir, "migration.sql"), script + "\n");
      const lock = path.join(migrationsDir, "migration_lock.toml");
      if (!existsSync(lock)) writeFileSync(lock, `# Please do not edit this file manually\n# It should be added in your version-control system (e.g., Git)\nprovider = "postgresql"\n`);
      console.log(`Created migration ${dirName}`);
    } else if (cmd === "deploy") {
      const out = await engine.applyMigrations({ migrationsList: migrationList(), filters } as never);
      const names = (out as unknown as { appliedMigrationNames: string[] }).appliedMigrationNames;
      console.log(names.length ? `Applied: ${names.join(", ")}` : "No pending migrations.");
    } else if (cmd === "status") {
      const out = await engine.diagnoseMigrationHistory({ migrationsList: migrationList(), optInToShadowDatabase: false, filters } as never);
      console.log(JSON.stringify(out, null, 2));
    } else {
      throw new Error("usage: create <name> | deploy | status");
    }
  } finally {
    engine.free();
    if (shadowCreated) {
      await admin.query(`DROP DATABASE IF EXISTS "${shadowName}" WITH (FORCE)`).catch(() => {});
      await admin.end();
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
