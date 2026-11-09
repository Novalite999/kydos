// Base44-compatible entity store on Postgres JSONB.
// Supports the query shapes the app uses: equality, $in/$nin, $gt/$gte/$lt/$lte,
// $ne, $regex (+$options 'i'), $exists, $or/$and, and '-field' sort strings.
import { ensureSchema, sql } from './db.js';

const COLUMNS = { id: 'id', created_date: 'created_date', updated_date: 'updated_date', created_by: 'created_by' };
const SYSTEM = new Set(Object.keys(COLUMNS));
const FIELD = /^[A-Za-z0-9_]{1,64}$/;
const MAX_LIMIT = 5000;

const bad = message => Object.assign(new Error(message), { status: 400 });
const isPlainObject = value => value !== null && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date);

export function toRow(record) {
  if (!record) return null;
  const iso = value => (value instanceof Date ? value.toISOString() : value);
  return { ...record.data, id: record.id, created_date: iso(record.created_date), updated_date: iso(record.updated_date), created_by: record.created_by ?? null };
}

function cleanData(input) {
  if (!isPlainObject(input)) throw bad('Record must be an object.');
  const out = {};
  for (const [key, value] of Object.entries(input)) {
    if (SYSTEM.has(key) || value === undefined) continue;
    if (!FIELD.test(key)) throw bad(`Invalid field name: ${key}`);
    out[key] = value;
  }
  return out;
}

class Query {
  constructor(params) { this.params = params; }
  param(value) { this.params.push(value); return `$${this.params.length}`; }
  json(value) { return `${this.param(JSON.stringify(value))}::jsonb`; }

  where(filter) {
    if (filter == null) return 'TRUE';
    if (!isPlainObject(filter)) throw bad('Filter must be an object.');
    const parts = [];
    for (const [key, value] of Object.entries(filter)) {
      if (key === '$or' || key === '$and') {
        if (!Array.isArray(value) || !value.length) throw bad(`${key} needs a non-empty array.`);
        parts.push(`(${value.map(item => `(${this.where(item)})`).join(key === '$or' ? ' OR ' : ' AND ')})`);
        continue;
      }
      if (!FIELD.test(key)) throw bad(`Invalid filter field: ${key}`);
      parts.push(this.field(key, value));
    }
    return parts.length ? parts.join(' AND ') : 'TRUE';
  }

  field(key, condition) {
    const column = COLUMNS[key];
    const ops = isPlainObject(condition) && Object.keys(condition).some(op => op.startsWith('$')) ? condition : { $eq: condition };
    const parts = [];
    for (const [op, value] of Object.entries(ops)) {
      if (op === '$options') continue;
      parts.push(column ? this.columnOp(column, op, value, ops) : this.dataOp(key, op, value, ops));
    }
    return parts.join(' AND ');
  }

  columnOp(column, op, value, ops) {
    const cast = column.endsWith('_date') ? '::timestamptz' : '::text';
    const cmp = { $gt: '>', $gte: '>=', $lt: '<', $lte: '<=' }[op];
    if (op === '$eq') return value === null ? `${column} IS NULL` : `${column} = ${this.param(String(value))}${cast}`;
    if (op === '$ne') return value === null ? `${column} IS NOT NULL` : `${column} IS DISTINCT FROM ${this.param(String(value))}${cast}`;
    if (op === '$in' || op === '$nin') {
      if (!Array.isArray(value)) throw bad(`${op} needs an array.`);
      const test = `${column} = ANY(${this.param(value.map(String))}${cast}[])`;
      return op === '$in' ? test : `NOT (${test})`;
    }
    if (cmp) return `${column} ${cmp} ${this.param(String(value))}${cast}`;
    if (op === '$exists') return value ? `${column} IS NOT NULL` : `${column} IS NULL`;
    if (op === '$regex') return `${column}::text ${String(ops.$options || '').includes('i') ? '~*' : '~'} ${this.param(pgRegex(value))}`;
    throw bad(`Unsupported operator ${op}`);
  }

  dataOp(key, op, value, ops) {
    let cached;
    const usesPath = !['$eq', '$ne'].includes(op) || value === null;
    if (usesPath && op !== '$regex') cached = `(data -> ${this.param(key)}::text)`;
    const path = cached;
    const cmp = { $gt: '>', $gte: '>=', $lt: '<', $lte: '<=' }[op];
    if (op === '$eq') return value === null ? `(${path} IS NULL OR ${path} = 'null'::jsonb)` : `data @> ${this.json({ [key]: value })}`;
    if (op === '$ne') return value === null ? `(${path} IS NOT NULL AND ${path} <> 'null'::jsonb)` : `NOT (data @> ${this.json({ [key]: value })})`;
    if (op === '$in' || op === '$nin') {
      if (!Array.isArray(value)) throw bad(`${op} needs an array.`);
      const test = `(${path} IS NOT NULL AND jsonb_typeof(${path}) <> 'array' AND ${this.json(value)} @> ${path})`;
      return op === '$in' ? test : `NOT ${test}`;
    }
    if (cmp) return `${path} ${cmp} ${this.json(value)}`;
    if (op === '$exists') return value ? `${path} IS NOT NULL` : `${path} IS NULL`;
    if (op === '$regex') return `(data ->> ${this.param(key)}::text) ${String(ops.$options || '').includes('i') ? '~*' : '~'} ${this.param(pgRegex(value))}`;
    throw bad(`Unsupported operator ${op}`);
  }

  order(sort) {
    if (!sort) return 'created_date DESC, id DESC';
    if (typeof sort !== 'string') throw bad('Sort must be a string.');
    const desc = sort.startsWith('-'), key = desc ? sort.slice(1) : sort.replace(/^\+/, '');
    if (!FIELD.test(key)) throw bad(`Invalid sort field: ${key}`);
    const dir = desc ? 'DESC' : 'ASC';
    const expression = COLUMNS[key] || `data -> ${this.param(key)}::text`;
    return `${expression} ${dir} NULLS LAST, id ${dir}`;
  }
}

// JavaScript's \b word boundary is \y in PostgreSQL regular expressions.
function pgRegex(pattern) {
  if (typeof pattern !== 'string' || pattern.length > 200) throw bad('Invalid $regex.');
  return pattern.replace(/\\b/g, '\\y');
}

const limitOf = limit => {
  const n = Number(limit);
  return Number.isFinite(n) && n > 0 ? Math.min(Math.floor(n), MAX_LIMIT) : 1000;
};

export function entityStore(type, { userId = null } = {}) {
  const run = async (text, params) => { await ensureSchema(); return sql().query(text, params); };

  const filter = async (query, sort, limit, skip) => {
    const params = [type], q = new Query(params);
    const where = q.where(query), order = q.order(sort);
    const lim = q.param(limitOf(limit)), off = q.param(Math.max(0, Math.floor(Number(skip) || 0)));
    const rows = await run(`SELECT * FROM entities WHERE type = $1 AND ${where} ORDER BY ${order} LIMIT ${lim}::int OFFSET ${off}::int`, params);
    return rows.map(toRow);
  };

  return {
    filter,
    list: (sort, limit, skip) => filter({}, sort, limit, skip),
    async get(id) {
      const [row] = await run('SELECT * FROM entities WHERE type = $1 AND id = $2', [type, String(id)]);
      if (!row) throw Object.assign(new Error(`${type} ${id} not found`), { status: 404 });
      return toRow(row);
    },
    async create(data) {
      const [row] = await run('INSERT INTO entities (type, data, created_by) VALUES ($1, $2::jsonb, $3) RETURNING *', [type, JSON.stringify(cleanData(data)), userId]);
      return toRow(row);
    },
    async bulkCreate(items) {
      if (!Array.isArray(items)) throw bad('bulkCreate needs an array.');
      if (!items.length) return [];
      const rows = await run(
        `INSERT INTO entities (type, data, created_by) SELECT $1, value, $3 FROM jsonb_array_elements($2::jsonb) RETURNING *`,
        [type, JSON.stringify(items.map(cleanData)), userId]);
      return rows.map(toRow);
    },
    async update(id, patch) {
      const [row] = await run('UPDATE entities SET data = data || $3::jsonb, updated_date = now() WHERE type = $1 AND id = $2 RETURNING *', [type, String(id), JSON.stringify(cleanData(patch))]);
      if (!row) throw Object.assign(new Error(`${type} ${id} not found`), { status: 404 });
      return toRow(row);
    },
    // Applies a different patch to each row in one statement: [{ id, ...fields }].
    async bulkUpdate(items) {
      if (!Array.isArray(items)) throw bad('bulkUpdate needs an array.');
      const patches = items.map(item => {
        if (!item?.id) throw bad('bulkUpdate rows need an id.');
        return { id: String(item.id), patch: cleanData(item) };
      });
      if (!patches.length) return [];
      const rows = await run(
        `UPDATE entities e SET data = e.data || (p.value -> 'patch'), updated_date = now()
           FROM jsonb_array_elements($2::jsonb) p
          WHERE e.type = $1 AND e.id = p.value ->> 'id' RETURNING e.*`,
        [type, JSON.stringify(patches)]);
      return rows.map(toRow);
    },
    async delete(id) {
      await run('DELETE FROM entities WHERE type = $1 AND id = $2', [type, String(id)]);
      return { id, deleted: true };
    },
    async deleteMany(query) {
      const params = [type], where = new Query(params).where(query);
      if (where === 'TRUE') throw bad('deleteMany needs a filter.');
      const rows = await run(`DELETE FROM entities WHERE type = $1 AND ${where} RETURNING id`, params);
      return { deleted: rows.length };
    },
    async changes(since, limit = 200) {
      const rows = await run('SELECT * FROM entities WHERE type = $1 AND updated_date > $2::timestamptz ORDER BY updated_date ASC LIMIT $3::int', [type, since, Math.min(limit, 500)]);
      return rows.map(toRow);
    },
  };
}

// Service-role access for server functions: every entity, no user rules.
export function serviceEntities(userId = null) {
  return new Proxy({}, { get: (_, name) => (typeof name === 'string' ? entityStore(name, { userId }) : undefined) });
}
