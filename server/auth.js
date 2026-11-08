// Sign-in with a Solana wallet: the browser asks for a challenge, Phantom signs it
// (a free message signature, not a transaction), and the server sets an HMAC-signed
// session cookie. The wallet address is the user id across the app.
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import bs58 from 'bs58';
import nacl from 'tweetnacl';

const COOKIE = 'kydos_session';
const SESSION_SECONDS = 30 * 24 * 3600;
const CHALLENGE_SECONDS = 300;
const WALLET = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

const fail = (message, status = 400) => Object.assign(new Error(message), { status });

function secret() {
  const value = process.env.SESSION_SECRET;
  if (!value || value.length < 32) throw fail('SESSION_SECRET (32+ characters) is not configured on the server.', 503);
  return value;
}
const b64 = value => Buffer.from(value).toString('base64url');
const sign = payload => createHmac('sha256', secret()).update(payload).digest('base64url');

function seal(data) {
  const payload = b64(JSON.stringify(data));
  return `${payload}.${sign(payload)}`;
}
function unseal(token) {
  if (typeof token !== 'string' || !token.includes('.')) return null;
  const [payload, mac] = token.split('.');
  const expected = Buffer.from(sign(payload)), given = Buffer.from(mac || '');
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString());
    return data.exp > Date.now() / 1000 ? data : null;
  } catch { return null; }
}

export function adminWallets() {
  return new Set(String(process.env.ADMIN_WALLETS || '').split(',').map(s => s.trim()).filter(Boolean));
}

export function userFor(wallet) {
  return { id: wallet, wallet, role: adminWallets().has(wallet) ? 'admin' : 'user', disabled: false };
}

function cookies(req) {
  const out = {};
  for (const part of (req.headers.get('cookie') || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export function sessionUser(req) {
  let token = cookies(req)[COOKIE];
  const header = req.headers.get('authorization');
  if (!token && header?.startsWith('Bearer ')) token = header.slice(7);
  if (!token) return null;
  const data = unseal(token);
  return data?.kind === 'session' && WALLET.test(data.wallet) ? userFor(data.wallet) : null;
}

export function challengeMessage(wallet, host, nonce, issuedAt) {
  return `${host} wants you to sign in to Kydos with your Solana wallet.\n\nThis request will not trigger a transaction or cost any SOL.\n\nWallet: ${wallet}\nNonce: ${nonce}\nIssued At: ${issuedAt}`;
}

export function createChallenge(wallet, host) {
  if (!WALLET.test(wallet || '')) throw fail('A valid Solana wallet address is required.');
  const nonce = randomBytes(12).toString('hex'), issuedAt = new Date().toISOString();
  const message = challengeMessage(wallet, host, nonce, issuedAt);
  const token = seal({ kind: 'challenge', wallet, message, exp: Math.floor(Date.now() / 1000) + CHALLENGE_SECONDS });
  return { message, token };
}

export function verifyChallenge({ wallet, token, signature }) {
  const challenge = unseal(token);
  if (!challenge || challenge.kind !== 'challenge' || challenge.wallet !== wallet) throw fail('Sign-in request expired. Try again.', 401);
  let sig, key;
  try { sig = bs58.decode(signature); key = bs58.decode(wallet); } catch { throw fail('Invalid signature encoding.', 401); }
  if (sig.length !== 64 || key.length !== 32) throw fail('Invalid signature.', 401);
  if (!nacl.sign.detached.verify(new TextEncoder().encode(challenge.message), sig, key)) throw fail('Signature does not match this wallet.', 401);
  return seal({ kind: 'session', wallet, exp: Math.floor(Date.now() / 1000) + SESSION_SECONDS });
}

export function sessionCookie(token, req) {
  const secure = new URL(req.url).protocol === 'https:' ? '; Secure' : '';
  return token
    ? `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_SECONDS}${secure}`
    : `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`;
}
