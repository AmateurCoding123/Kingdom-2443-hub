(function () {
  'use strict';
  var API = '/api/kvk-signup';
  var root = document.getElementById('kvk-root');
  var panel = document.getElementById('p-kvk');
  if (!root || !panel) return;

  var S = { kvk: null, kvkTs: null, alliances: [], rows: [], admin: null, query: '', started: false };
  var ui = {};

  function el(t, c, x) { var e = document.createElement(t); if (c) e.className = c; if (x != null) e.textContent = x; return e; }
  function pad(n) { return n < 10 ? '0' + n : '' + n; }
  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function lsDel(k) { try { localStorage.removeItem(k); } catch (e) {} }
  function ssGet(k) { try { return sessionStorage.getItem(k); } catch (e) { return null; } }
  function ssSet(k, v) { try { sessionStorage.setItem(k, v); } catch (e) {} }
  function ssDel(k) { try { sessionStorage.removeItem(k); } catch (e) {} }

  function fmtWhen(s) {
    var d = new Date(String(s).replace(' ', 'T') + 'Z');
    if (isNaN(d.getTime())) return '';
    return d.toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  }

  function addOpt(sel, value, text) { var o = el('option', null, text); o.value = value; sel.append(o); }
  function field(label, input, hint) {
    var l = el('label');
    l.append(document.createTextNode(label));
    if (hint) l.append(el('small', null, hint));
    l.append(input);
    return l;
  }
  function setMsg(node, text, kind) { node.textContent = text || ''; node.className = 'kvk-msg' + (kind ? ' ' + kind : ''); }

  // ---------- countdown ----------
  function tick() {
    if (!ui.clock || !S.kvkTs) return;
    var s = Math.max(0, Math.floor((S.kvkTs - Date.now()) / 1000));
    ui.title.textContent = s > 0 ? 'KvK #' + S.kvk + ' begins in' : 'KvK #' + S.kvk + ' is underway';
    var p = [['days', Math.floor(s / 86400)], ['hrs', Math.floor(s / 3600) % 24], ['min', Math.floor(s / 60) % 60], ['sec', s % 60]];
    ui.clock.replaceChildren();
    p.forEach(function (x) { var d = el('div'); d.append(el('b', null, pad(x[1])), el('small', null, x[0])); ui.clock.append(d); });
  }
  setInterval(function () { if (!panel.hidden) tick(); }, 1000);

  // ---------- data ----------
  function fetchRows() {
    var headers = {};
    if (S.admin) headers['X-Admin-Password'] = S.admin;
    return fetch(API + '?kvk=' + encodeURIComponent(S.kvk), { cache: 'no-store', headers: headers })
      .then(function (r) {
        if (r.status === 401 && S.admin) {
          S.admin = null; ssDel('kvk-admin'); setAdminUi();
          return fetchRows();
        }
        return r.json().then(function (j) {
          if (!r.ok) throw new Error(j && j.error ? j.error : 'Server responded ' + r.status);
          return j;
        });
      })
      .then(function (j) {
        if (!j) return;
        S.rows = j.rows || [];
        renderList();
      })
      .catch(function (e) {
        ui.list.replaceChildren(el('p', 'note', 'Could not load signups (' + (e.message || 'error') + ').'));
      });
  }

  // ---------- rendering ----------
  function renderList() {
    var rows = S.rows;
    ui.count.textContent = String(rows.length);

    // "your status"
    var me = lsGet('kvk-me-' + S.kvk);
    if (me) {
      var found = rows.some(function (r) { return r.name.toLowerCase() === me.toLowerCase(); });
      if (found) ui.me.textContent = 'Signed up: ' + me;
      else { lsDel('kvk-me-' + S.kvk); ui.me.textContent = 'Not yet'; }
    } else ui.me.textContent = 'Not yet';

    // alliance chips
    var counts = {};
    rows.forEach(function (r) { counts[r.alliance] = (counts[r.alliance] || 0) + 1; });
    var keys = Object.keys(counts).sort(function (a, b) { return counts[b] - counts[a]; }).slice(0, 8);
    ui.chips.replaceChildren();
    keys.forEach(function (k) {
      var c = el('div', 'chip', k);
      c.append(el('small', null, counts[k] + (counts[k] === 1 ? ' player' : ' players')));
      ui.chips.append(c);
    });

    // list
    var q = S.query.toLowerCase();
    var shown = rows.filter(function (r) {
      return !q || r.name.toLowerCase().indexOf(q) !== -1 || r.alliance.toLowerCase().indexOf(q) !== -1;
    });
    ui.list.replaceChildren();
    if (!rows.length) { ui.list.append(el('p', 'note', 'No one has signed up yet. Be the first!')); return; }
    if (!shown.length) { ui.list.append(el('p', 'note', 'No matches.')); return; }
    shown.forEach(function (r) {
      var row = el('div', 'row t-ALLIANCE');
      row.append(el('b', null, r.name), el('span', 'tag', r.alliance));
      if (S.admin && r.gov_id) row.append(el('span', 'tag p', 'ID ' + r.gov_id));
      row.append(el('time', null, fmtWhen(r.created_at)));
      if (S.admin) {
        var d = el('button', 'code kvk-del', 'Remove');
        d.type = 'button';
        d.onclick = function () { removeRow(r); };
        row.append(d);
      }
      ui.list.append(row);
    });
  }

  function removeRow(r) {
    if (!confirm('Remove ' + r.name + ' from the list?')) return;
    fetch(API, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json', 'X-Admin-Password': S.admin },
      body: JSON.stringify({ id: r.id })
    }).then(function (res) {
      if (!res.ok) throw new Error('fail');
      return fetchRows();
    }).catch(function () { alert('Could not remove that entry.'); });
  }

  function csvCell(v) {
    v = String(v == null ? '' : v);
    if (/^[=+\-@\t\r]/.test(v)) v = "'" + v;
    return '"' + v.replace(/"/g, '""') + '"';
  }
  function downloadCsv() {
    var lines = [['Name', 'Alliance', 'Governor ID', 'Signed up (UTC)'].map(csvCell).join(',')];
    S.rows.slice().reverse().forEach(function (r) {
      lines.push([r.name, r.alliance, r.gov_id, r.created_at].map(csvCell).join(','));
    });
    var blob = new Blob(['\ufeff' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'kvk-' + S.kvk + '-signups.csv';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  }

  function setAdminUi() {
    if (!ui.pw) return;
    var on = !!S.admin;
    ui.pw.hidden = on; ui.unlock.hidden = on;
    ui.csv.hidden = !on; ui.lock.hidden = !on;
  }

  function build() {
    root.replaceChildren();

    // banner + status
    var hero = el('div', 'hero'), banner = el('div', 'banner'), side = el('div', 'side');
    ui.title = el('h2', null, 'KvK #' + S.kvk + ' begins in');
    ui.clock = el('div', 'clock');
    banner.append(ui.title, ui.clock);
    var m1 = el('div', 'mini'); ui.count = el('p', null, '0'); m1.append(el('h3', null, 'Signed up'), ui.count);
    var m2 = el('div', 'mini'); ui.me = el('p', null, 'Not yet'); m2.append(el('h3', null, 'Your status'), ui.me);
    side.append(m1, m2); hero.append(banner, side); root.append(hero);

    // form
    root.append(el('h3', 'kvk-h', 'Sign up for KvK #' + S.kvk));
    var form = el('form', 'kvk-form');
    form.setAttribute('autocomplete', 'off');

    ui.name = el('input'); ui.name.type = 'text'; ui.name.maxLength = 30; ui.name.required = true;
    ui.name.placeholder = 'Your in-game name'; ui.name.name = 'player-name';

    ui.ally = el('select');
    addOpt(ui.ally, '', 'Select your alliance...');
    S.alliances.forEach(function (a) { if (a && a.tag) addOpt(ui.ally, a.tag, '[' + a.tag + '] ' + a.name); });
    addOpt(ui.ally, 'None', 'No alliance');
    addOpt(ui.ally, 'Other', 'Other alliance (type the tag)');

    ui.other = el('input'); ui.other.type = 'text'; ui.other.maxLength = 10; ui.other.placeholder = 'e.g. ABC';
    ui.otherWrap = field('Alliance tag', ui.other);
    ui.otherWrap.hidden = true;
    ui.ally.onchange = function () { ui.otherWrap.hidden = ui.ally.value !== 'Other'; };

    ui.gid = el('input'); ui.gid.type = 'text'; ui.gid.inputMode = 'numeric'; ui.gid.maxLength = 15; ui.gid.placeholder = 'Optional';

    ui.hp = el('input', 'kvk-hp'); ui.hp.type = 'text'; ui.hp.tabIndex = -1; ui.hp.name = 'website';
    ui.hp.setAttribute('autocomplete', 'off'); ui.hp.setAttribute('aria-hidden', 'true');

    ui.go = el('button', 'kvk-go', 'Sign up'); ui.go.type = 'submit';
    ui.msg = el('div', 'kvk-msg'); ui.msg.setAttribute('role', 'status');

    form.append(
      field('Player name', ui.name),
      field('Alliance', ui.ally),
      ui.otherWrap,
      field('Governor ID', ui.gid, 'Optional. Only leaders can see it.'),
      ui.hp, ui.go, ui.msg
    );
    form.onsubmit = function (e) { e.preventDefault(); submit(); };
    root.append(form);

    // list
    root.append(el('h3', 'kvk-h', 'Who is signed up'));
    ui.chips = el('div', 'live');
    ui.search = el('input', 'kvk-search'); ui.search.type = 'search'; ui.search.placeholder = 'Search by name or alliance...';
    ui.search.style.margin = '12px 0';
    ui.search.oninput = function () { S.query = ui.search.value.trim(); renderList(); };
    ui.list = el('div');
    root.append(ui.chips, ui.search, ui.list);

    // leaders
    var tools = el('div', 'kvk-tools');
    ui.leadBtn = el('button', 'code', 'Leaders'); ui.leadBtn.type = 'button';
    ui.adminBox = el('div', 'kvk-form'); ui.adminBox.hidden = true;
    ui.pw = el('input'); ui.pw.type = 'password'; ui.pw.placeholder = 'Leader password'; ui.pw.autocomplete = 'off';
    ui.unlock = el('button', 'code', 'Unlock'); ui.unlock.type = 'button';
    ui.csv = el('button', 'code', 'Download CSV'); ui.csv.type = 'button';
    ui.lock = el('button', 'code', 'Lock'); ui.lock.type = 'button';
    ui.amsg = el('div', 'kvk-msg');
    ui.adminBox.append(ui.pw, ui.unlock, ui.csv, ui.lock, ui.amsg);
    tools.append(ui.leadBtn);
    root.append(tools, ui.adminBox);

    ui.leadBtn.onclick = function () { ui.adminBox.hidden = !ui.adminBox.hidden; };
    ui.unlock.onclick = function () {
      var pw = ui.pw.value;
      if (!pw) return;
      S.admin = pw; ssSet('kvk-admin', pw);
      fetchRows().then(function () {
        if (S.admin) { ui.pw.value = ''; setMsg(ui.amsg, 'Leader tools unlocked.', 'good'); setAdminUi(); }
        else setMsg(ui.amsg, 'That password was not accepted.', 'bad');
      });
    };
    ui.lock.onclick = function () { S.admin = null; ssDel('kvk-admin'); setAdminUi(); setMsg(ui.amsg, ''); fetchRows(); };
    ui.csv.onclick = downloadCsv;
    setAdminUi();
    tick();
  }

  function submit() {
    var name = ui.name.value.replace(/\s+/g, ' ').trim();
    var ally = ui.ally.value;
    if (ally === 'Other') ally = ui.other.value.trim().toUpperCase();
    var gid = ui.gid.value.trim();

    if (name.length < 2) return setMsg(ui.msg, 'Please enter your player name.', 'bad');
    if (!ally) return setMsg(ui.msg, ui.ally.value === 'Other' ? 'Please type your alliance tag.' : 'Please choose your alliance.', 'bad');
    if (gid && !/^\d{4,15}$/.test(gid)) return setMsg(ui.msg, 'Governor ID should be numbers only (or leave it blank).', 'bad');

    ui.go.disabled = true;
    setMsg(ui.msg, 'Signing you up...');
    fetch(API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kvk: S.kvk, name: name, alliance: ally, govId: gid, website: ui.hp.value })
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (!r.ok) throw new Error(j.error || 'Something went wrong. Please try again.');
        lsSet('kvk-me-' + S.kvk, name);
        setMsg(ui.msg, 'You are signed up. See you in the KvK!', 'good');
        ui.name.value = ''; ui.gid.value = ''; ui.other.value = ''; ui.ally.value = ''; ui.otherWrap.hidden = true;
        return fetchRows();
      });
    }).catch(function (e) {
      setMsg(ui.msg, e.message || 'Something went wrong. Please try again.', 'bad');
    }).then(function () { ui.go.disabled = false; });
  }

  // ---------- start ----------
  function showError(msg) {
    root.replaceChildren();
    root.append(el('p', 'note', 'Could not load KvK info (' + msg + ').'));
    var b = el('button', 'code', 'Try again'); b.type = 'button';
    b.onclick = start;
    root.append(b);
  }

  function start() {
    root.replaceChildren(el('p', 'note', 'Loading...'));
    S.admin = ssGet('kvk-admin');
    fetch('/api/hub', { cache: 'no-store' })
      .then(function (r) { if (!r.ok) throw new Error('Server responded ' + r.status); return r.json(); })
      .then(function (h) {
        var ev = h && h.events, k = ev && ev.kvk;
        if (!k || !Number.isInteger(k.eventNumber) || !k.timeLeft) throw new Error('no upcoming KvK found');
        S.kvk = k.eventNumber;
        S.kvkTs = Date.parse(ev.timestamp) + k.timeLeft.total;
        var list = (h.allianceList && h.allianceList.length) ? h.allianceList : (h.alliances || []);
        S.alliances = list.slice().sort(function (a, b) { return (a.rank || 0) - (b.rank || 0); });
        build();
        return fetchRows();
      })
      .catch(function (e) { showError(e.message || 'error'); });
  }

  function onRoute() {
    if (location.hash !== '#kvk' || S.started) return;
    S.started = true;
    start();
  }
  addEventListener('hashchange', onRoute);
  onRoute();

  setInterval(function () { if (!panel.hidden && S.kvk) fetchRows(); }, 60000);
})();
