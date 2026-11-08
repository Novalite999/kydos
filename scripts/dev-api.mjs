// Local stand-in for the Vercel function: serves /api/* on port 3001 using .env.local.
// Run `npm run dev:api` next to `npm run dev` (Vite proxies /api here).
import { createServer } from 'node:http';
import { existsSync } from 'node:fs';

if (existsSync('.env.local')) process.loadEnvFile('.env.local');
if (process.env.PGLITE) {
  // Offline mode: an in-memory Postgres instead of Neon (data is lost on restart).
  const { PGlite } = await import('@electric-sql/pglite');
  const { setTestClient } = await import('../server/db.js');
  const db = new PGlite();
  process.env.DATABASE_URL ||= 'pglite://memory';
  setTestClient({ query: async (text, params) => (await db.query(text, params)).rows });
}
const { handle } = await import('../server/router.js');
const port = Number(process.env.API_PORT || 3001);

createServer(async (req, res) => {
  try {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = chunks.length ? Buffer.concat(chunks) : undefined;
    const url = `http://${req.headers.host || `localhost:${port}`}${req.url}`;
    const request = new Request(url, { method: req.method, headers: req.headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : body });
    const response = await handle(request);
    const headers = Object.fromEntries(response.headers);
    const cookies = response.headers.getSetCookie?.() || [];
    if (cookies.length) headers['set-cookie'] = cookies;
    res.writeHead(response.status, headers);
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch (error) {
    console.error(error);
    res.writeHead(500, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'Local API error' }));
  }
}).listen(port, () => console.log(`Kydos API on http://localhost:${port}/api`));
