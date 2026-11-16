(function () {
  'use strict';
  var ENDPOINT = '/api/timeline';
  var REFRESH_MS = 5 * 60 * 1000;
  var PAST_VISIBLE = 4;

  var CATS = [['all','All'],['heroes','Heroes'],['pets','Pets'],['kvk','KvK'],
              ['battles','Battles'],['truegold','Truegold'],['masters','Masters'],['other','Other']];
  var COLORS = {heroes:'var(--blue)',pets:'var(--teal)',kvk:'var(--red)',battles:'var(--plum)',
                truegold:'var(--sun)',masters:'var(--leaf)',other:'var(--mut)'};

  // Optional display-name overrides (API key -> label)
  var LABELS = {
    'first-hall-of-governors-hog':'First Hall of Governors (HoG)',
    'first-kvk-prep-starts':'First KvK Preparation Starts',
    'first-kvk-castle-battle':'First KvK Castle Battle',
    'first-alliance-brawl':'First Alliance Brawl',
    'first-flamedragon-tyrant-battle':'First Flamedragon Tyrant Battle',
    'governor-gear-infusion':'Governor Gear Infusion',
    'gov-gear-material-exchange-unlocks':'Governor Gear Material Exchange',
    'gov-charm-material-exchange-unlocked':'Governor Charm Material Exchange',
    '4th-master-unlocked':'4th Master Unlocked',
    '5th-and-6th-masters-unlocked':'5th & 6th Masters Unlocked',
    '7th-and-8th-masters-unlocked':'7th & 8th Masters Unlocked',
    '9th-and-10th-masters-unlocked':'9th & 10th Masters Unlocked',
    'masters-unlocked':'Masters Unlocked'
  };

  var root = document.getElementById('tl-root');
  var foot = document.getElementById('tl-foot');
  var panel = document.getElementById('p-timeline');
  if (!root || !panel) return;

  var state = {items:null, filter:'all', showAllPast:false, error:null, updated:null, started:false, created:null};

  function esc(s){return String(s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]});}
  function pad(n){return n<10?'0'+n:''+n;}

  function categorize(k){
    if(/kvk/.test(k)) return 'kvk';
    if(/truegold/.test(k)) return 'truegold';
    if(/master/.test(k)) return 'masters';
    if(/hero/.test(k)) return 'heroes';
    if(/pet/.test(k)) return 'pets';
    if(/battle|brawl/.test(k)) return 'battles';
    return 'other';
  }
  function label(k){
    if(LABELS[k]) return LABELS[k];
    var m = k.match(/^gen(\d+)-(heroes|pets)$/);
    if(m) return 'Generation '+m[1]+' '+(m[2]==='heroes'?'Heroes':'Pets');
    m = k.match(/^truegold-(\d+)$/);
    if(m) return 'Truegold '+m[1];
    return k.split('-').map(function(w){return w.charAt(0).toUpperCase()+w.slice(1);}).join(' ');
  }
  function catName(c){for(var i=0;i<CATS.length;i++) if(CATS[i][0]===c) return CATS[i][1]; return c;}

  function normalise(json){
    if(!json || !json.success || !json.result || !json.result.unlocks) throw new Error('Unexpected data format');
    var r = json.result, out = [];
    if(r.createdDate) out.push({key:'kingdom-created',title:'Kingdom Created',date:r.createdDate,cat:'other'});
    Object.keys(r.unlocks).forEach(function(k){ out.push({key:k,title:label(k),date:r.unlocks[k],cat:categorize(k)}); });
    out.forEach(function(i){ i.ts = Date.parse(i.date+'T00:00:00Z'); });
    out = out.filter(function(i){return !isNaN(i.ts);});
    out.sort(function(a,b){return a.ts-b.ts || a.title.localeCompare(b.title);});
    return {items:out, created:r.createdDate};
  }

  function fmtDate(ts){
    return new Date(ts).toLocaleDateString('en-GB',{weekday:'short',day:'numeric',month:'short',year:'numeric',timeZone:'UTC'});
  }
  function shortCount(ms){
    var s=Math.max(0,Math.floor(ms/1000)), d=Math.floor(s/86400), h=Math.floor(s%86400/3600), m=Math.floor(s%3600/60);
    return d>=1 ? d+'d '+h+'h' : h+'h '+pad(m)+'m '+pad(s%60)+'s';
  }
  function clockHtml(ms){
    var s=Math.max(0,Math.floor(ms/1000));
    var p=[['days',Math.floor(s/86400)],['hrs',Math.floor(s/3600)%24],['min',Math.floor(s/60)%60],['sec',s%60]];
    return p.map(function(x){return '<div><b>'+pad(x[1])+'</b><small>'+x[0]+'</small></div>';}).join('');
  }

  function load(){
    state.error = null;
    if(!state.items) render();
    return fetch(ENDPOINT,{cache:'no-store'})
      .then(function(r){ if(!r.ok) throw new Error('Server responded '+r.status); return r.json(); })
      .then(function(j){
        var n = normalise(j);
        state.items = n.items; state.created = n.created; state.updated = new Date(); state.error = null;
        render();
      })
      .catch(function(e){ state.error = e.message || 'Could not load timeline'; render(); });
  }

  function card(i,kind,cur,nxt,now){
    var isCur = cur && i.key===cur.key, isNext = nxt && i.key===nxt.key;
    var cls = 'tl-item'+(kind==='past'?' tl-past':'')+(isCur?' tl-cur':'')+(isNext?' tl-next':'');
    var h = '<div class="'+cls+'" style="--c:'+COLORS[i.cat]+'">';
    h += '<b>'+esc(i.title)+'</b>';
    if(isCur) h += '<span class="tag p">Current</span>';
    if(isNext) h += '<span class="tag open">Next</span>';
    h += '<span class="tag">'+esc(catName(i.cat))+'</span>';
    h += '<time>'+fmtDate(i.ts)+'</time>';
    if(kind==='up') h += '<span class="tl-in">in <span class="tl-cd" data-ts="'+i.ts+'">'+shortCount(i.ts-now)+'</span></span>';
    return h+'</div>';
  }

  function render(){
    if(!state.items){
      root.innerHTML = state.error
        ? '<p class="tl-err">Couldn’t load the timeline ('+esc(state.error)+').</p><button class="code" type="button" data-act="retry">Try again</button>'
        : '<p class="note">Loading timeline…</p>';
      foot.textContent = '';
      return;
    }
    var now = Date.now(), all = state.items;
    var pastAll = all.filter(function(i){return i.ts<=now;});
    var upAll = all.filter(function(i){return i.ts>now;});
    var cur = pastAll[pastAll.length-1] || null, nxt = upAll[0] || null;

    var h = '';
    if(state.error) h += '<p class="tl-err">Couldn’t refresh just now ('+esc(state.error)+'). Showing the last loaded data.</p>';

    var day = state.created ? Math.floor((now-Date.parse(state.created+'T00:00:00Z'))/864e5)+1 : null;
    h += '<div class="hero"><div class="banner">';
    if(nxt){
      h += '<h2>Up next: '+esc(nxt.title)+'</h2><div class="note" style="color:#fff;opacity:.9">'+fmtDate(nxt.ts)+' · 00:00 UTC</div>';
      h += '<div class="clock" id="tl-clock" data-ts="'+nxt.ts+'">'+clockHtml(nxt.ts-now)+'</div>';
    } else {
      h += '<h2>All milestones reached</h2>';
    }
    h += '</div><div class="side">';
    h += '<div class="mini"><h3>Current stage</h3><p>'+(cur?esc(cur.title):'Not started')+'</p>'+(cur?'<span>Since '+fmtDate(cur.ts)+'</span>':'')+'</div>';
    if(day) h += '<div class="mini"><h3>Kingdom age</h3><p>Day '+day+'</p><span>Opened '+fmtDate(Date.parse(state.created+'T00:00:00Z'))+'</span></div>';
    h += '</div></div>';

    h += '<div class="tl-filters">';
    CATS.forEach(function(c){
      var n = c[0]==='all' ? all.length : all.filter(function(i){return i.cat===c[0];}).length;
      if(c[0]!=='all' && n===0) return;
      h += '<button class="code'+(state.filter===c[0]?' on':'')+'" type="button" data-filter="'+c[0]+'">'+c[1]+'<b>'+n+'</b></button>';
    });
    h += '</div>';

    function pass(i){return state.filter==='all' || i.cat===state.filter;}
    var past = pastAll.filter(pass), up = upAll.filter(pass), hidden = 0;
    if(!state.showAllPast && past.length>PAST_VISIBLE){ hidden = past.length-PAST_VISIBLE; past = past.slice(-PAST_VISIBLE); }

    if(hidden) h += '<button class="code" type="button" data-act="more" style="margin-bottom:10px">Show '+hidden+' earlier milestone'+(hidden>1?'s':'')+'</button>';
    past.forEach(function(i){ h += card(i,'past',cur,nxt,now); });
    h += '<div class="tl-now">Now</div>';
    if(!up.length) h += '<p class="note">No upcoming milestones'+(state.filter==='all'?'':' in this category')+'.</p>';
    up.forEach(function(i){ h += card(i,'up',cur,nxt,now); });

    root.innerHTML = h;
    foot.textContent = state.updated
      ? 'Updated '+state.updated.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})+' · refreshes automatically · milestone dates are UTC · data from Kingshot Optimizer'
      : '';
  }

  // Click handling
  root.addEventListener('click',function(e){
    var f = e.target.closest('[data-filter]');
    if(f){ state.filter = f.getAttribute('data-filter'); render(); return; }
    var a = e.target.closest('[data-act]');
    if(!a) return;
    if(a.getAttribute('data-act')==='more'){ state.showAllPast = true; render(); }
    if(a.getAttribute('data-act')==='retry'){ load(); }
  });

  // Live countdowns (only while the tab is open)
  setInterval(function(){
    if(!state.items || panel.hidden) return;
    var now = Date.now(), reached = false;
    var clock = document.getElementById('tl-clock');
    if(clock){
      var d = Number(clock.getAttribute('data-ts')) - now;
      if(d<=0) reached = true; else clock.innerHTML = clockHtml(d);
    }
    var cds = root.querySelectorAll('.tl-cd');
    for(var i=0;i<cds.length;i++){
      var x = Number(cds[i].getAttribute('data-ts')) - now;
      if(x<=0) reached = true; else cds[i].textContent = shortCount(x);
    }
    if(reached) render();
  },1000);

  // Load lazily when the Timeline tab is opened, then refresh automatically
  function onRoute(){
    if(location.hash !== '#timeline') return;
    if(!state.started){ state.started = true; load(); setInterval(function(){ if(!panel.hidden) load(); }, REFRESH_MS); }
    else if(!state.updated || Date.now()-state.updated.getTime() > 60000){ load(); }
  }
  addEventListener('hashchange', onRoute);
  onRoute();
})();
