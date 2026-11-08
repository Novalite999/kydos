// Who may read and write each entity from the browser. Server functions use the
// service-role store and bypass these rules.
import { entityStore } from './entities.js';

const fail = (message, status = 403) => Object.assign(new Error(message), { status });

const SOCIAL = {
  Post: { owner: 'author_id', counters: ['like_count', 'reply_count', 'repost_count'], limits: { body: 2000, image_url: 2048, author_handle: 40, author_avatar: 2048 } },
  PostLike: { owner: 'user_id', unique: ['user_id', 'post_id'] },
  Follow: { owner: 'follower_id', unique: ['follower_id', 'followee_id'] },
  Profile: { owner: 'user_id', unique: ['user_id'], limits: { handle: 20, bio: 300, avatar_url: 2048, banner_url: 2048 } },
};
const PUBLIC_READ = new Set([...Object.keys(SOCIAL), 'SolanaTrade', 'JupiterCandle', 'Token']);
const ADMIN_ONLY = new Set(['AstraAuditIssue', 'AstraContinuityState', 'AstraConversation', 'AstraMemory', 'AstraMessage', 'AstraReference']);

export function canRead(type, user) {
  if (PUBLIC_READ.has(type)) return true;
  if (ADMIN_ONLY.has(type)) return user?.role === 'admin';
  return false;
}

function checkLimits(rule, data) {
  for (const [field, max] of Object.entries(rule.limits || {})) {
    if (data[field] != null && (typeof data[field] !== 'string' || data[field].length > max)) throw fail(`${field} is too long (max ${max}).`, 400);
  }
}

// Returns the store a signed-in user may write through, enforcing ownership.
export function writableStore(type, user) {
  if (!user) throw fail('Sign in with your wallet first.', 401);
  const store = entityStore(type, { userId: user.id });
  if (ADMIN_ONLY.has(type)) {
    if (user.role !== 'admin') throw fail('Administrator required.');
    return store;
  }
  const rule = SOCIAL[type];
  if (!rule) throw fail(`${type} cannot be changed from the browser.`);
  const isAdmin = user.role === 'admin';

  const ownerCheck = async id => {
    const row = await store.get(id);
    return { row, owns: row[rule.owner] === user.id || isAdmin };
  };

  return {
    async create(data) {
      if (data?.[rule.owner] !== user.id) throw fail(`${rule.owner} must be your connected wallet.`);
      checkLimits(rule, data);
      if (rule.unique) {
        const [existing] = await store.filter(Object.fromEntries(rule.unique.map(k => [k, data[k]])), null, 1);
        if (existing) return existing;
      }
      return store.create(data);
    },
    async update(id, patch) {
      const { row, owns } = await ownerCheck(id);
      if (!owns) {
        const keys = Object.keys(patch || {});
        if (!rule.counters || !keys.length || !keys.every(k => rule.counters.includes(k))) throw fail('You can only edit your own records.');
        // Counters may only move by one step per request.
        for (const k of keys) if (Math.abs(Number(patch[k]) - Number(row[k] || 0)) > 1 || Number(patch[k]) < 0) throw fail('Invalid counter change.', 400);
      }
      if (patch && rule.owner in patch && patch[rule.owner] !== row[rule.owner]) throw fail('Owner cannot be changed.');
      checkLimits(rule, patch || {});
      return store.update(id, patch);
    },
    async delete(id) {
      const { owns } = await ownerCheck(id);
      if (!owns) throw fail('You can only delete your own records.');
      return store.delete(id);
    },
  };
}
