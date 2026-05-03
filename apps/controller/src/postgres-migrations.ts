import crypto from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import pg from "pg";

const SCHEMA_NAME = "agent_team";
const MIGRATIONS_TABLE = `${SCHEMA_NAME}.schema_migrations`;

type MigrationFile = {
  checksum: string;
  path: string;
  sql: string;
  version: string;
};

export async function runPostgresMigrations(pool: pg.Pool): Promise<void> {
  await pool.query(`create schema if not exists ${SCHEMA_NAME}`);
  await pool.query(`
    create table if not exists ${MIGRATIONS_TABLE} (
      version text primary key,
      checksum text not null,
      applied_at timestamptz not null default now()
    )
  `);

  for (const migration of await loadMigrationFiles()) {
    const existing = await pool.query<{ checksum: string }>(
      `select checksum from ${MIGRATIONS_TABLE} where version = $1`,
      [migration.version]
    );
    if (existing.rows[0]) {
      if (existing.rows[0].checksum !== migration.checksum) {
        throw new Error(`Migration ${migration.version} checksum changed after it was applied.`);
      }
      continue;
    }

    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query(`set local search_path to ${SCHEMA_NAME}, public`);
      await client.query(migration.sql);
      await client.query(`insert into ${MIGRATIONS_TABLE} (version, checksum) values ($1, $2)`, [
        migration.version,
        migration.checksum
      ]);
      await client.query("commit");
    } catch (error) {
      try {
        await client.query("rollback");
      } catch (rollbackError) {
        console.warn("Postgres migration rollback failed.", rollbackError);
      }
      throw error;
    } finally {
      client.release();
    }
  }
}

async function loadMigrationFiles(): Promise<MigrationFile[]> {
  const migrationsDir = path.resolve(process.cwd(), "apps/controller/migrations");
  const entries = (await readdir(migrationsDir, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith(".sql"))
    .map((entry) => entry.name)
    .sort();

  if (!entries.length) {
    throw new Error(`No controller migrations found in ${migrationsDir}.`);
  }

  return Promise.all(
    entries.map(async (name) => {
      const migrationPath = path.join(migrationsDir, name);
      const sql = await readFile(migrationPath, "utf8");
      return {
        checksum: crypto.createHash("sha256").update(sql).digest("hex"),
        path: migrationPath,
        sql,
        version: path.basename(name, ".sql")
      };
    })
  );
}
