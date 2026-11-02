import postgres from "postgres";
import { cache } from "react";
import { exigirDono } from "@/lib/auth";

// Banco no Supabase (PostgreSQL). O sistema conecta com um usuário próprio
// (bolos_app) que só enxerga o schema "app": lê e grava dados, mas não altera a estrutura.

type Row = Record<string, any>;
export type Db = {
  sql: postgres.Sql | postgres.TransactionSql;
  // Consultas repetidas na mesma tela são lidas uma vez só.
  cache?: Map<string, Promise<Row[]>>;
};

const globalForSql = globalThis as unknown as { bolosSql?: postgres.Sql };

function getSql() {
  if (!globalForSql.bolosSql) {
    const url = process.env.DATABASE_URL;
    if (!url) {
      throw new Error("DATABASE_URL não configurada.");
    }
    globalForSql.bolosSql = postgres(url, {
      prepare: false, // exigido pelo pooler do Supabase (modo transação)
      max: 5,
      idle_timeout: 20,
      connect_timeout: 15,
      types: {
        // COUNT e SUM de inteiros chegam como bigint; números pequenos, então viram Number.
        bigint: {
          to: 20,
          from: [20],
          serialize: (value: number) => String(value),
          parse: (value: string) => Number(value),
        },
        numeric: {
          to: 1700,
          from: [1700],
          serialize: (value: number) => String(value),
          parse: (value: string) => Number(value),
        },
      },
    });
  }
  return globalForSql.bolosSql;
}

const getRequestCache = cache(() => new Map<string, Promise<Row[]>>());

// O código usa "?" como marcador de parâmetro; o PostgreSQL usa $1, $2...
function toPostgresPlaceholders(text: string) {
  let index = 0;
  let inString = false;
  let output = "";
  for (const char of text) {
    if (char === "'") inString = !inString;
    if (char === "?" && !inString) {
      index += 1;
      output += `$${index}`;
    } else {
      output += char;
    }
  }
  return output;
}

function normalizeParams(params: any[]) {
  return params.map((value) => (value === undefined ? null : value));
}

async function execute(db: Db, text: string, params: any[]): Promise<Row[]> {
  const result = await db.sql.unsafe(toPostgresPlaceholders(text), normalizeParams(params));
  return Array.from(result, (row) => ({ ...row }));
}

async function queryAll(db: Db, text: string, params: any[] = []): Promise<Row[]> {
  if (!db.cache) {
    return execute(db, text, params);
  }
  const key = `${text}\u0000${JSON.stringify(normalizeParams(params))}`;
  let pending = db.cache.get(key);
  if (!pending) {
    pending = execute(db, text, params);
    db.cache.set(key, pending);
    pending.catch(() => db.cache?.delete(key));
  }
  return pending;
}

async function queryOne(db: Db, text: string, params: any[] = []) {
  return (await queryAll(db, text, params))[0] || null;
}

async function run(db: Db, text: string, params: any[] = []) {
  db.cache?.clear();
  return execute(db, text, params);
}

async function seedLookupId(db: Db, table: string, name: string) {
  const row = await queryOne(db, `SELECT id FROM ${table} WHERE name = ?`, [name]);
  return row ? Number(row.id) : null;
}

export async function withDatabase<T>(callback: (db: Db) => T | Promise<T>) {
  await exigirDono();
  return callback({ sql: getSql(), cache: getRequestCache() });
}

export async function withTransaction<T>(callback: (db: Db) => T | Promise<T>) {
  await exigirDono();
  const result = await getSql().begin((tx) => callback({ sql: tx }));
  getRequestCache().clear();
  return result as T;
}

export async function verificarConexao() {
  await getSql()`SELECT 1 FROM periods LIMIT 1`;
}

export const dbHelpers = {
  queryAll,
  queryOne,
  run,
  seedLookupId,
};
