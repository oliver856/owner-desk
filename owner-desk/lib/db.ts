import postgres from 'postgres';

// Server-only database client. The connection string lives in Vercel's environment settings,
// never in the browser. Uses Supabase's transaction pooler, so prepared statements are off.
const g = globalThis as unknown as { __sql?: postgres.Sql };

export const sql: postgres.Sql =
  g.__sql ??
  (g.__sql = postgres(process.env.DATABASE_URL as string, {
    prepare: false,
    max: 3,
    idle_timeout: 20,
    connect_timeout: 15,
  }));
