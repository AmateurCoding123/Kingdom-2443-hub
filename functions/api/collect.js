// Kingdom 2443 nightly collector.
// Saves today's power for every member of the top 100 alliances.
// Safe to call as many times as you like: it only fetches what is still missing today,
// a few alliances per call, and reports how many are left ("remaining").
const KINGDOM = 2443;
const ALLIANCE_LIST = "https://mightpulse.com/api/kingdoms/" + KINGDOM + "?alliances=100";
const ALLIANCE_API = "https://api.mightpulse.com/v1/alliances/" + KINGDOM + "/";
const TABLE = "kingdom_player_snapshots";
const LOG = "kingdom_collect_log";
const KEEP_DAYS = 90;
const DAY = 86400000;
const BATCH = 3; // alliances per call, kept small so each call stays light

function dayString(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

function pick(obj, keys) {
  for (const k of keys) {
    const v = obj ? obj[k] : undefined;
    if (v !== undefined && v !== null && v !== "") return v;
  }
  return null;
}

function parseMember(item, tag) {
  const p = (item && item.player) || item || {};
  const id = pick(p, ["governor_id", "fid", "uid", "id"]) ?? pick(item, ["governor_id", "fid", "uid", "id"]);
  const name = pick(p, ["nick_name", "nickname", "player_name", "name"]) ?? pick(item, ["nick_name", "nickname", "player_name", "name"]);
  let power = pick(p, ["power", "might", "total_power"]) ?? pick(item, ["power", "might", "total_power"]);
  if (power && typeof power === "object") power = power.value ?? power.total ?? power.amount;
  power = Number(String(power).replace(/,/g, ""));
  if (!name || !Number.isFinite(power)) return null;
  const clean = String(name).trim();
  if (!clean || clean.toLowerCase() === "unknown" || clean.length > 100) return null;
  return {
    id: id !== null && id !== undefined ? String(id) : "n:" + tag + ":" + clean,
    name: clean,
    alliance: tag,
    power: Math.round(power)
  };
}

async function ensureTables(db) {
  await db.batch([
    db.prepare(
      "CREATE TABLE IF NOT EXISTS " + TABLE +
      " (snap_date TEXT NOT NULL, player_id TEXT NOT NULL, player_name TEXT NOT NULL, alliance TEXT, power INTEGER NOT NULL, PRIMARY KEY (snap_date, player_id))"
    ),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_kps_date_power ON " + TABLE + " (snap_date, power)"),
    db.prepare(
      "CREATE TABLE IF NOT EXISTS " + LOG +
      " (snap_date TEXT NOT NULL, alliance_tag TEXT NOT NULL, PRIMARY KEY (snap_date, alliance_tag))"
    )
  ]);
}

export async function onRequest({ request, env }) {
  if (request.method !== "GET") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }
  const db = env.DB;
  if (!db) {
    return Response.json({ error: "Database not linked", details: "Add a D1 binding named DB to this project." }, { status: 500 });
  }
  // The MightPulse API key is stored as a secret in this project.
  const keyName = Object.keys(env).find(k => /might/i.test(k) && typeof env[k] === "string");
  if (!keyName) {
    return Response.json({ error: "No MightPulse key", details: "Add a secret named MIGHTPULSE_API_KEY to this project." }, { status: 500 });
  }

  try {
    await ensureTables(db);
    const today = dayString(Date.now());

    // First call of the day: clear anything an older version saved earlier today, and tidy old days.
    const started = await db.prepare("SELECT 1 AS x FROM " + LOG + " WHERE snap_date = ? LIMIT 1").bind(today).first();
    if (!started) {
      const oldest = dayString(Date.now() - KEEP_DAYS * DAY);
      await db.batch([
        db.prepare("DELETE FROM " + TABLE + " WHERE snap_date = ?").bind(today),
        db.prepare("DELETE FROM " + TABLE + " WHERE snap_date < ?").bind(oldest),
        db.prepare("DELETE FROM " + LOG + " WHERE snap_date < ?").bind(oldest),
        db.prepare("INSERT OR IGNORE INTO " + LOG + " (snap_date, alliance_tag) VALUES (?, '__started__')").bind(today)
      ]);
    }

    // Which alliances to collect: the top 100 by power.
    const listRes = await fetch(ALLIANCE_LIST, {
      headers: { Accept: "application/json", "user-agent": "Kingdom2443-Hub" },
      signal: AbortSignal.timeout(20000)
    });
    if (!listRes.ok) throw new Error("Alliance list HTTP " + listRes.status);
    const listData = await listRes.json();
    const tags = [...new Set((Array.isArray(listData.alliances) ? listData.alliances : []).map(a => a.abbr).filter(Boolean))];
    if (!tags.length) throw new Error("No alliances found in the MightPulse list");

    const doneRows = await db.prepare("SELECT alliance_tag FROM " + LOG + " WHERE snap_date = ?").bind(today).all();
    const done = new Set((doneRows.results || []).map(r => r.alliance_tag));
    const pending = tags.filter(t => !done.has(t));
    const batch = pending.slice(0, BATCH);

    // Fetch this call's alliances in parallel. MightPulse can take up to ~90 seconds on a stale alliance.
    const results = await Promise.all(batch.map(async tag => {
      try {
        const r = await fetch(ALLIANCE_API + encodeURIComponent(tag) + "?include=info,members_full", {
          headers: { Accept: "application/json", Authorization: "Bearer " + env[keyName] },
          signal: AbortSignal.timeout(100000)
        });
        if (!r.ok) throw new Error("HTTP " + r.status);
        const data = await r.json();
        const list = Array.isArray(data.members_full) ? data.members_full : data.members;
        if (!Array.isArray(list)) throw new Error("no member list");
        const byId = new Map();
        for (const item of list) {
          const m = parseMember(item, tag);
          if (m) byId.set(m.id, m);
        }
        return { tag, members: [...byId.values()] };
      } catch (e) {
        return { tag, error: tag + ": " + e.message };
      }
    }));

    const insert = db.prepare(
      "INSERT OR REPLACE INTO " + TABLE + " (snap_date, player_id, player_name, alliance, power) VALUES (?, ?, ?, ?, ?)"
    );
    const errors = [];
    let saved = 0;
    for (const res of results) {
      if (res.error) { errors.push(res.error); continue; }
      const statements = res.members.map(m => insert.bind(today, m.id, m.name, m.alliance, m.power));
      for (let i = 0; i < statements.length; i += 50) {
        await db.batch(statements.slice(i, i + 50));
      }
      await db.prepare("INSERT OR IGNORE INTO " + LOG + " (snap_date, alliance_tag) VALUES (?, ?)").bind(today, res.tag).run();
      saved++;
    }

    const remaining = pending.length - saved;
    if (remaining === 0) {
      await db.prepare("INSERT OR IGNORE INTO " + LOG + " (snap_date, alliance_tag) VALUES (?, '__complete__')").bind(today).run();
    }

    return Response.json(
      { today, total: tags.length, saved, remaining, errors },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    return Response.json({ error: "Request failed", details: error.message }, { status: 500 });
  }
                                      }
