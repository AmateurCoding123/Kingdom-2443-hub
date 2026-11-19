// Kingdom 2443 player power growth (leadership only).
// Reads the nightly snapshots saved by /api/collect (members of the top 100 alliances)
// and compares the latest saved day with an earlier one.
//
// Query: days=1|7|30, view=power|growth|flat, tol=0|0.1|0.5|1, min=<power>, q=<search>, offset=<n>
// Header: x-leader-password (checked against the LEADER_PASSWORD secret, or ADMIN_PASSWORD if that is not set)
const TABLE = "kingdom_player_snapshots";
const LOG = "kingdom_collect_log";
const DAY = 86400000;
const PAGE = 100;

const json = (d, s = 200) => Response.json(d, { status: s, headers: { "Cache-Control": "no-store" } });

function dayString(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

function same(a, b) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

export async function onRequest({ request, env }) {
  if (request.method !== "GET") return json({ error: "Method not allowed" }, 405);

  const secret = env.LEADER_PASSWORD || env.ADMIN_PASSWORD;
  if (!secret) {
    return json({ error: "No password set", details: "Add a secret named LEADER_PASSWORD to this project." }, 500);
  }
  if (!same(request.headers.get("x-leader-password") || "", secret)) {
    return json({ error: "Wrong password" }, 401);
  }

  const db = env.DB;
  if (!db) {
    return json({ error: "Database not linked", details: "Add a D1 binding named DB to this project, then redeploy." }, 500);
  }

  try {
    const params = new URL(request.url).searchParams;
    const asked = Number(params.get("days"));
    const days = [1, 7, 30].includes(asked) ? asked : 1;
    const view = ["power", "growth", "flat"].includes(params.get("view")) ? params.get("view") : "power";
    const tol = Math.max(0, Number(params.get("tol")) || 0);
    const min = Math.max(0, Number(params.get("min")) || 0);
    const q = (params.get("q") || "").trim().toLowerCase();
    const offset = Math.max(0, Math.floor(Number(params.get("offset")) || 0));

    await db.batch([
      db.prepare(
        "CREATE TABLE IF NOT EXISTS " + TABLE +
        " (snap_date TEXT NOT NULL, player_id TEXT NOT NULL, player_name TEXT NOT NULL, alliance TEXT, power INTEGER NOT NULL, PRIMARY KEY (snap_date, player_id))"
      ),
      db.prepare(
        "CREATE TABLE IF NOT EXISTS " + LOG +
        " (snap_date TEXT NOT NULL, alliance_tag TEXT NOT NULL, PRIMARY KEY (snap_date, alliance_tag))"
      )
    ]);

    const datesResult = await db.prepare("SELECT DISTINCT snap_date FROM " + TABLE + " ORDER BY snap_date ASC").all();
    const dates = (datesResult.results || []).map(r => r.snap_date);
    const empty = { latestDate: null, baselineDate: null, snapshotDays: dates.length, summary: null, members: [], hasMore: false, total: 0 };
    if (!dates.length) return json(empty);

    // Latest day: the newest one the collector finished. If none has finished yet, the newest with any data.
    const complete = await db.prepare(
      "SELECT snap_date FROM " + LOG + " WHERE alliance_tag = '__complete__' ORDER BY snap_date DESC LIMIT 1"
    ).first();
    const latestDate = complete && dates.includes(complete.snap_date) ? complete.snap_date : dates[dates.length - 1];

    // Comparison day: the newest saved day at or before (latest - days), else the oldest earlier day.
    const earlier = dates.filter(d => d < latestDate);
    const target = dayString(Date.parse(latestDate) - days * DAY);
    const atOrBefore = earlier.filter(d => d <= target);
    const baselineDate = atOrBefore.length ? atOrBefore[atOrBefore.length - 1] : (earlier.length ? earlier[0] : null);
    const snapshotDays = dates.filter(d => d <= latestDate).length;

    const latestRows = await db.prepare(
      "SELECT player_id, player_name, alliance, power FROM " + TABLE + " WHERE snap_date = ? ORDER BY power DESC"
    ).bind(latestDate).all();
    const baseline = new Map();
    if (baselineDate) {
      const rows = await db.prepare("SELECT player_id, power FROM " + TABLE + " WHERE snap_date = ?").bind(baselineDate).all();
      for (const r of rows.results || []) baseline.set(r.player_id, r.power);
    }

    // Every member, ranked by power across the whole kingdom.
    let all = (latestRows.results || []).map((r, i) => {
      const m = { id: r.player_id, name: r.player_name, alliance: r.alliance || "", power: r.power, rank: i + 1 };
      if (!baselineDate) return { ...m, status: "none" };
      const before = baseline.get(r.player_id);
      if (before === undefined) return { ...m, status: "new" };
      const change = r.power - before;
      return {
        ...m,
        change,
        pct: before > 0 ? (change / before) * 100 : 0,
        status: change === 0 ? "flat" : (change > 0 ? "up" : "down")
      };
    });

    const compared = m => m.status === "up" || m.status === "down" || m.status === "flat";
    const isFlat = m => compared(m) && (tol === 0 ? m.change === 0 : Math.abs(m.pct) < tol);

    if (min > 0) all = all.filter(m => m.power >= min);

    // Summary covers everyone above the minimum power (not narrowed by the search box).
    const withChange = all.filter(compared);
    const summary = {
      compared: withChange.length,
      total: withChange.reduce((s, m) => s + m.change, 0),
      growing: withChange.filter(m => m.change > 0).length,
      lowgrowth: withChange.filter(isFlat).length
    };

    let list = q
      ? all.filter(m => m.name.toLowerCase().includes(q) || m.alliance.toLowerCase().includes(q))
      : all;

    if (view === "growth") {
      // Biggest gain first; players with nothing to compare go last, by power.
      list = [...list].sort((a, b) => {
        const ca = compared(a), cb = compared(b);
        if (ca !== cb) return ca ? -1 : 1;
        return ca ? b.change - a.change || b.power - a.power : b.power - a.power;
      });
    } else if (view === "flat") {
      // Strongest sleepers first.
      list = list.filter(isFlat);
    }

    return json({
      latestDate,
      baselineDate,
      snapshotDays,
      requestedDays: days,
      summary,
      total: list.length,
      hasMore: offset + PAGE < list.length,
      members: list.slice(offset, offset + PAGE)
    });
  } catch (error) {
    return json({ error: "Request failed", details: error.message }, 500);
  }
}
