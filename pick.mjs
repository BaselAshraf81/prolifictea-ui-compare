// Read-only: list the busiest visible researcher pages.
import "dotenv/config";
import pg from "pg";
const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
await c.connect();
const r = await c.query(`SELECT id, "reviewCount", "isPersonName" FROM "Researcher" WHERE "isHidden" = false ORDER BY "reviewCount" DESC LIMIT 5`);
console.log(JSON.stringify(r.rows));
await c.end();
