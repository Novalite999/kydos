// Single Vercel Function that serves every /api/* route (see vercel.json rewrites).
import { handle } from '../server/router.js';

export default { fetch: handle };
