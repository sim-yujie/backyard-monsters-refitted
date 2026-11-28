// bun q.ts "<sql>" : one query on DB_NAME over the network (read the server .env for the login)
import { Client } from "pg";
const c = new Client({ host: process.env.DB_HOST === "bymr-database" ? "localhost" : process.env.DB_HOST, port: Number(process.env.DB_HOST_PORT ?? process.env.DB_PORT ?? 5432), user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME });
await c.connect();
try { const r = await c.query(process.argv[2]); console.log(JSON.stringify(r.rows, null, 0).slice(0, 3000)); } finally { await c.end(); }
