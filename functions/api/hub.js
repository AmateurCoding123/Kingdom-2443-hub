// Kingdom 2443 hub: fetches kingshot.net + MightPulse data, merges it, caches for 5 minutes.
const KINGDOM = 2443;
const KS = 'https://kingshot.net/api';
const MP = 'https://mightpulse.com/api/kingdoms/' + KINGDOM + '?alliances=20';

async function getJson(url) {
  try {
    const r = await fetch(url, { headers: { 'user-agent': 'Kingdom2443-Hub' } });
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

  const [events, tracker, codes, mp] = await Promise.all([
    getJson(KS + '/events?week=1&kingdom=' + KINGDOM),
    getJson(KS + '/kingdom-tracker?kingdomId=' + KINGDOM),
    getJson(KS + '/gift-codes'),
    getJson(MP),
  ]);

  const alliances = mp && Array.isArray(mp.alliances)
    ? mp.alliances.slice(0, 20).map(a => ({
        rank: a.rank, tag: a.abbr, name: a.name, leader: a.leader_name,
        members: a.member_count, max: a.member_max, power: a.power,
        language: a.language_label,
      }))
    : [];

  const res = new Response(JSON.stringify({ events, tracker, codes, alliances }), {
    headers: {
      'content-type': 'application/json',
      'cache-control': 'public, max-age=300',
    },
  });
  if (events) context.waitUntil(cache.put(key, res.clone()));
  return res;
}
