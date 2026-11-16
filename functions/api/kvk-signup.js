const json = (d, s = 200) => new Response(JSON.stringify(d), {
  status: s,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
});

function same(a, b) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

const isAdmin = (req, env) => {
  const pw = req.headers.get('X-Admin-Password') || '';
  return !!env.ADMIN_PASSWORD && same(pw, env.ADMIN_PASSWORD);
};

async function sha(s) {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');
}

const clean = (s, max) =>
  String(s == null ? '' : s)
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);

const MAX_PER_HOUR = 10;

const SQL_LIST_PUBLIC =
  'SELECT name, alliance, created_at ' +
  'FROM kvk_signups WHERE kvk = ?1 ' +
  'ORDER BY id DESC LIMIT 3000';

const SQL_LIST_ADMIN =
  'SELECT id, name, alliance, gov_id, created_at ' +
  'FROM kvk_signups WHERE kvk = ?1 ' +
  'ORDER BY id DESC LIMIT 3000';

const SQL_RECENT =
  'SELECT COUNT(*) AS n FROM kvk_signups ' +
  'WHERE ip_hash = ?1 ' +
  "AND created_at > datetime('now','-1 hour')";

const SQL_INSERT =
  'INSERT INTO kvk_signups ' +
  '(kvk, name, name_lower, alliance, gov_id, ip_hash) ' +
  'VALUES (?1, ?2, ?3, ?4, ?5, ?6)';

const SQL_DELETE = 'DELETE FROM kvk_signups WHERE id = ?1';

export async function onRequest(context) {
  const { request, env } = context;
  if (!env.DB) return json({ error: 'Signup database is not set up yet.' }, 500);

  try {
    if (request.method === 'GET') {
      const url = new URL(request.url);
      const kvk = parseInt(url.searchParams.get('kvk'), 10);
      if (!Number.isInteger(kvk) || kvk < 1 || kvk > 9999) {
        return json({ error: 'Bad KvK number' }, 400);
      }

      let admin = false;
      if (request.headers.get('X-Admin-Password')) {
        if (!isAdmin(request, env)) return json({ error: 'Unauthorized' }, 401);
        admin = true;
      }
      const sql = admin ? SQL_LIST_ADMIN : SQL_LIST_PUBLIC;
      const { results } = await env.DB.prepare(sql).bind(kvk).all();
      return json({ kvk, admin, rows: results });
    }

    if (request.method === 'POST') {
      let b;
      try { b = await request.json(); } catch (e) { return json({ error: 'Bad request' }, 400); }
      if (b.website) return json({ ok: true }); // honeypot: bots fill this in

      const kvk = parseInt(b.kvk, 10);
      const name = clean(b.name, 30);
      const alliance = clean(b.alliance, 12);
      const gov = clean(b.govId, 15);

      if (!Number.isInteger(kvk) || kvk < 1 || kvk > 9999) {
        return json({ error: 'Bad KvK number' }, 400);
      }
      if (name.length < 2) return json({ error: 'Please enter your player name.' }, 400);
      if (!alliance) return json({ error: 'Please choose your alliance.' }, 400);
      if (gov && !/^\d{4,15}$/.test(gov)) {
        return json({ error: 'Governor ID should be numbers only (or leave it blank).' }, 400);
      }

      const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
      const ipHash = (await sha(ip + ':kvk')).slice(0, 32);

      const recent = await env.DB.prepare(SQL_RECENT).bind(ipHash).first();
      if (recent && recent.n >= MAX_PER_HOUR) {
        return json({ error: 'Too many signups from your connection. Try again later.' }, 429);
      }

      try {
        await env.DB.prepare(SQL_INSERT)
          .bind(kvk, name, name.toLowerCase(), alliance, gov || null, ipHash)
          .run();
      } catch (e) {
        const m = String(e && e.message);
        if (m.indexOf('gov_id') !== -1) {
          return json({ error: 'That Governor ID is already signed up.' }, 409);
        }
        if (m.indexOf('UNIQUE') !== -1) {
          return json({ error: 'That name is already signed up for this KvK.' }, 409);
        }
        throw e;
      }
      return json({ ok: true });
    }

    if (request.method === 'DELETE') {
      if (!isAdmin(request, env)) return json({ error: 'Unauthorized' }, 401);
      let b;
      try { b = await request.json(); } catch (e) { return json({ error: 'Bad request' }, 400); }
      const id = parseInt(b.id, 10);
      if (!Number.isInteger(id)) return json({ error: 'Bad id' }, 400);
      await env.DB.prepare(SQL_DELETE).bind(id).run();
      return json({ ok: true });
    }

    return json({ error: 'Method not allowed' }, 405);
  } catch (err) {
    return json({ error: 'Server error' }, 500);
  }
}
