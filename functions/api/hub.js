// Kingdom 2443 hub: fetches kingshot.net data, merges it, caches for 5 minutes.
const KINGDOM = 2443;
const BASE = 'https://kingshot.net/api';

async function get(path) {
  try {
    const r = await fetch(BASE + path, { headers: { 'user-agent': 'Kingdom2443-Hub' } });
    return r.ok ? await r.json() : null;
  } catch (e) {
    return null;
  }
}

export async function onRequest(context) {
  const cache = caches.default;
  const key = new Request(new URL('/api/hub', context.request.url).toString());
  const hit = await cache.match(key);
  if (hit) return hit;

  const [events, tracker, codes] = await Promise.all([
    get('/events?week=1&kingdom=' + KINGDOM),
    get('/kingdom-tracker?kingdomId=' + KINGDOM),
    get('/gift-codes'),
  ]);

  const res = new Response(JSON.stringify({ events, tracker, codes }), {
    headers: {
      'content-type': 'application/json',
      'cache-control': 'public, max-age=300',
    },
  });
  if (events) context.waitUntil(cache.put(key, res.clone()));
  return res;
}
