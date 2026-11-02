import { Pool, types, type PoolClient } from "pg";
import { cache } from "react";
import { exigirDono } from "@/lib/auth";

// Banco no Supabase (PostgreSQL). O sistema conecta com um usuário próprio
// (bolos_app) que só enxerga o schema "app": lê e grava dados, mas não altera a estrutura.

type Row = Record<string, any>;
type Executor = Pick<Pool, "query"> | PoolClient;
export type Db = {
  sql: Executor;
  // Consultas repetidas na mesma tela são lidas uma vez só.
  cache?: Map<string, Promise<Row[]>>;
  // Numa transação há uma só conexão: as consultas entram em fila, uma de cada vez.
  queue?: { last: Promise<unknown> };
};

// COUNT e SUM de inteiros chegam como bigint/numeric; números pequenos, então viram Number.
types.setTypeParser(20, (value) => Number(value));
types.setTypeParser(1700, (value) => Number(value));

const globalForPool = globalThis as unknown as { bolosPool?: Pool };

// Na Vercel cada acesso pode abrir uma cópia nova do servidor. Por isso o sistema usa o
// pooler do Supabase em modo transação (porta 6543), que aceita muitas conexões curtas.
function connectionString() {
  // No computador de desenvolvimento usa a cópia de teste (schema app_teste), nunca os dados reais.
  const raw =
    process.env.NODE_ENV === "development" && process.env.DATABASE_URL_TESTE
      ? process.env.DATABASE_URL_TESTE
      : process.env.DATABASE_URL;
  if (!raw) {
    throw new Error("DATABASE_URL não configurada.");
  }
  const url = new URL(raw);
  if (url.hostname.endsWith("pooler.supabase.com")) {
    url.port = "6543";
  }
  return url.toString();
}

function getPool() {
  if (!globalForPool.bolosPool) {
    globalForPool.bolosPool = new Pool({
      connectionString: connectionString(),
      max: 3,
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 15_000,
    });
  }
  return globalForPool.bolosPool;
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
  const send = async () =>
    (await db.sql.query(toPostgresPlaceholders(text), normalizeParams(params))).rows as Row[];
  if (!db.queue) {
    return send();
  }
  const next = db.queue.last.then(send, send);
  db.queue.last = next.catch(() => undefined);
  return next;
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
  return callback({ sql: getPool(), cache: getRequestCache() });
}

export async function withTransaction<T>(callback: (db: Db) => T | Promise<T>) {
  await exigirDono();
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const result = await callback({ sql: client, queue: { last: Promise.resolve() } });
    await client.query("COMMIT");
    getRequestCache().clear();
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function verificarConexao() {
  await getPool().query("SELECT 1 FROM periods LIMIT 1");
}

export const dbHelpers = {
  queryAll,
  queryOne,
  run,
  seedLookupId,
};
