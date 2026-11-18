// Kingdom 2443 player power growth.
// Saves a snapshot of the top players' power once a day (the first time the page
// is opened that day) and compares live power with an earlier saved day.
const KINGDOM = 2443;
const SOURCE = "https://mightpulse.com/api/kingdoms/" + KINGDOM + "?players=200";
const TABLE = "kingdom_player_snapshots";
const KEEP_DAYS = 90;
const DAY = 86400000;

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

function findPlayers(data) {
  if (Array.isArray(data)) return data;
  if (!data || typeof data !== "object") return [];
  const names = ["players", "governors", "top_players", "personal_power"];
  for (const k of names) if (Array.isArray(data[k])) return data[k];
  for (const v of Object.values(data)) {
    if (v && typeof v === "object" && !Array.isArray(v)) {
      for (const k of names) if (Array.isArray(v[k])) return v[k];
    }
  }
  return [];
}

function parsePlayer(item) {
  const p = (item && item.player) || item || {};
  const id = pick(p, ["governor_id", "fid", "gov_id", "uid", "id"]);
  const name = pick(p, ["nick_name", "nickname", "player_name", "governor_name", "name"]);
  let power = pick(p, ["power", "might", "score"]);
  if (power && typeof power === "object") power = power.value ?? power.total ?? power.amount;
  power = Number(String(power).replace(/,/g, ""));
  if ((id === null && name === null) || !Number.isFinite(power)) return null;
  let alliance = pick(p, ["alliance_abbr", "abbr", "alliance_tag", "alliance"]);
  if (alliance && typeof alliance === "object") alliance = alliance.abbr || alliance.tag || alliance.name;
  return {
    id: String(id ?? name),
    name: String(name ?? id),
    alliance: alliance ? String(alliance) : "",
    power: Math.round(power)
  };
}

export async function onRequest({ request, env }) {
  if (request.method !== "GET") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }
  const db = env.DB;
  if (!db) {
    return Response.json(
      { error: "Database not linked", details: "Add a D1 binding named DB to this project, then redeploy." },
      { status: 500 }
    );
  }
  try {
    const params = new URL(request.url).searchParams;
    const asked = Number(params.get("days"));
    const days = [1, 7, 30].includes(asked) ? asked : 1;

    // Creates the table the first time; does nothing after that.
    await db.prepare(
      "CREATE TABLE IF NOT EXISTS " + TABLE +
      " (snap_date TEXT NOT NULL, player_id TEXT NOT NULL, player_name TEXT NOT NULL, alliance TEXT, power INTEGER NOT NULL, PRIMARY KEY (snap_date, player_id))"
    ).run();

    // Live data from MightPulse.
    const response = await fetch(SOURCE, {
      headers: { Accept: "application/json", "user-agent": "Kingdom2443-Hub" },
      signal: AbortSignal.timeout(25000)
    });
    if (!response.ok) throw new Error("MightPulse HTTP " + response.status);
    const data = await response.json();
    const raw = findPlayers(data);
    const byId = new Map();
    for (const item of raw) {
      const p = parsePlayer(item);
      if (p) byId.set(p.id, p);
    }
    const live = [...byId.values()].sort((a, b) => b.power - a.power);
    if (!live.length) {
      const keys = data && typeof data === "object" ? Object.keys(data).join(", ") : typeof data;
      const first = raw[0] && typeof raw[0] === "object" ? Object.keys(raw[0]).join(", ") : "none";
      throw new Error("No players found. Top-level keys: " + keys + ". Fields on first player: " + first);
    }

    // Save today's snapshot once (the first time the page is opened each day).
    const today = dayString(Date.now());
    const have = await db.prepare("SELECT COUNT(*) AS n FROM " + TABLE + " WHERE snap_date = ?").bind(today).first();
    if (!have || !have.n) {
      const insert = db.prepare(
        "INSERT OR REPLACE INTO " + TABLE + " (snap_date, player_id, player_name, alliance, power) VALUES (?, ?, ?, ?, ?)"
      );
      for (let i = 0; i < live.length; i += 50) {
        await db.batch(live.slice(i, i + 50).map(p => insert.bind(today, p.id, p.name, p.alliance, p.power)));
      }
      await db.prepare("DELETE FROM " + TABLE + " WHERE snap_date < ?")
        .bind(dayString(Date.now() - KEEP_DAYS * DAY)).run();
    }

    // Choose the earlier day to compare against.
    const datesResult = await db.prepare("SELECT DISTINCT snap_date FROM " + TABLE + " ORDER BY snap_date ASC").all();
    const dates = (datesResult.results || []).map(r => r.snap_date);
    const earlier = dates.filter(d => d < today);
    const target = dayString(Date.now() - days * DAY);
    const atOrBefore = earlier.filter(d => d <= target);
    const baselineDate = atOrBefore.length
      ? atOrBefore[atOrBefore.length - 1]
      : (earlier.length ? earlier[0] : null);

    const baseline = new Map();
    if (baselineDate) {
      const rows = await db.prepare("SELECT player_id, power FROM " + TABLE + " WHERE snap_date = ?")
        .bind(baselineDate).all();
      for (const r of rows.results || []) baseline.set(r.player_id, r.power);
    }

    const members = live.map((p, i) => {
      const base = { id: p.id, name: p.name, alliance: p.alliance, power: p.power, rank: i + 1 };
      if (!baselineDate) return { ...base, status: "none" };
      const before = baseline.get(p.id);
      if (before === undefined) return { ...base, status: "new" };
      const change = p.power - before;
      return {
        ...base,
        change,
        pct: before > 0 ? (change / before) * 100 : 0,
        status: change === 0 ? "flat" : (change > 0 ? "up" : "down")
      };
    });

    return Response.json({
      today,
      requestedDays: days,
      baselineDate,
      snapshotDays: dates.length,
      count: members.length,
      members
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({ error: "Request failed", details: error.message }, { status: 500 });
  }
                                                                               }
