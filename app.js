import { CLOSURES, EARLY_CLOSES } from './holidays.js';

const MARKETS = [
  { id:'nasdaq', name:'NASDAQ', ticker:'NDX / QQQ', tz:'America/New_York', open:[9,30], close:[16,0], pre:[4,0], group:'US' },
  { id:'nyse', name:'NYSE', ticker:'S&P 500 / SPY', tz:'America/New_York', open:[9,30], close:[16,0], pre:[4,0], group:'US' },
  { id:'cme', name:'CME Futures', ticker:'ES / NQ / RTY', tz:'America/Chicago', open:[17,0], close:[16,0], group:'US', cme:true },
  { id:'lse', name:'London Stock Exchange', ticker:'FTSE 100', tz:'Europe/London', open:[8,0], close:[16,30], group:'EU' },
  { id:'xetra', name:'Frankfurt / XETRA', ticker:'DAX', tz:'Europe/Berlin', open:[9,0], close:[17,30], group:'EU' },
  { id:'eurex', name:'Eurex Futures', ticker:'FDAX / FESX / BUND', tz:'Europe/Berlin', open:[8,0], close:[22,0], group:'EU' },
  { id:'tse', name:'Tokyo Stock Exchange', ticker:'Nikkei 225', tz:'Asia/Tokyo', open:[9,0], close:[15,30], lunch:[11,30], lunchEnd:[12,30], group:'ASIA' },
  { id:'hkex', name:'Hong Kong Exchange', ticker:'Hang Seng', tz:'Asia/Hong_Kong', open:[9,30], close:[16,0], lunch:[12,0], lunchEnd:[13,0], group:'ASIA' },
  { id:'sse', name:'Shanghai / Shenzhen', ticker:'CSI 300', tz:'Asia/Shanghai', open:[9,30], close:[15,0], lunch:[11,30], lunchEnd:[13,0], group:'ASIA' },
  { id:'asx', name:'ASX', ticker:'ASX 200', tz:'Australia/Sydney', open:[10,0], close:[16,0], group:'ASIA' },
  { id:'sgx', name:'Singapore Exchange', ticker:'SGX / STI', tz:'Asia/Singapore', open:[9,0], close:[17,0], lunch:[12,0], lunchEnd:[13,0], group:'ASIA' },
  { id:'crypto', name:'Crypto (BTC/ETH)', ticker:'BTC · ETH · SOL', tz:'UTC', open:[0,0], close:[23,59], alwaysOn:true, group:'CRYPTO' },
];

const FX_PAIRS = ['EUR/USD','GBP/USD','USD/JPY','AUD/USD','USD/CHF','USD/CAD','NZD/USD','DXY'];
const COUNTDOWN_KEYS = ['nasdaq','lse','xetra','tse','hkex'];
const DAY = 864e5;

// ── time core ────────────────────────────────────────────────────────────────

const _dtf = new Map();
function dtf(tz, opts) {
  const k = tz + '|' + Object.keys(opts).join(',') + Object.values(opts).join(',');
  let f = _dtf.get(k);
  if (!f) { f = new Intl.DateTimeFormat('en-US', { timeZone: tz, ...opts }); _dtf.set(k, f); }
  return f;
}
const P_OPTS = { hourCycle:'h23', weekday:'short', year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', second:'2-digit' };
const WD = { Sun:0, Mon:1, Tue:2, Wed:3, Thu:4, Fri:5, Sat:6 };

function parts(tz, ms = Date.now()) {
  const p = dtf(tz, P_OPTS).formatToParts(ms);
  const g = k => p.find(x => x.type === k)?.value;
  return { y:+g('year'), mo:+g('month'), d:+g('day'), h:+g('hour'), mi:+g('minute'), s:+g('second'), wd: WD[g('weekday')] };
}

function offsetMs(tz, date) {
  const q = parts(tz, date.getTime());
  return Date.UTC(q.y, q.mo - 1, q.d, q.h, q.mi, q.s) - date.getTime();
}

function zonedTimeToUtc(y, mo, d, h, mi, tz) {
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  const o1 = offsetMs(tz, new Date(guess));
  const t = guess - o1;
  const o2 = offsetMs(tz, new Date(t));
  return o2 === o1 ? t : guess - o2;
}

const iso = p => `${p.y}-${String(p.mo).padStart(2,'0')}-${String(p.d).padStart(2,'0')}`;
const pad = n => String(n).padStart(2,'0');
const isWeekend = wd => wd === 0 || wd === 6;
const closeOf = (m, d) => EARLY_CLOSES[m.id]?.get(d) ?? m.close;
const isClosedDay = (m, d) => CLOSURES[m.id]?.has(d) ?? false;

const USER_TZ = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

// ── status ───────────────────────────────────────────────────────────────────

function getStatus(m, now = Date.now()) {
  if (m.alwaysOn) return 'open';
  const p = parts(m.tz, now);
  const mins = p.h * 60 + p.mi;
  const d = iso(p);

  if (m.cme) {
    if (p.wd === 6) return 'closed';
    if (p.wd === 5 && mins >= 960) return 'closed';
    if (p.wd === 0 && mins < 1020) return 'closed';
    if (isClosedDay(m, d)) return 'holiday';
    if (mins >= 960 && mins < 1020) return 'break';
    return 'open';
  }

  if (isWeekend(p.wd)) return 'closed';
  if (isClosedDay(m, d)) return 'holiday';

  const c = closeOf(m, d);
  if (m.lunch) {
    const ls = m.lunch[0]*60 + m.lunch[1], le = m.lunchEnd[0]*60 + m.lunchEnd[1];
    if (mins >= ls && mins < le) return 'break';
  }
  const o = m.open[0]*60 + m.open[1], cl = c[0]*60 + c[1];
  if (m.pre) {
    const ps = m.pre[0]*60 + m.pre[1];
    if (mins >= ps && mins < o) return 'pre';
  }
  return mins >= o && mins < cl ? 'open' : 'closed';
}

// ── next events ──────────────────────────────────────────────────────────────

function nextOpenMs(m, now = Date.now()) {
  if (m.alwaysOn) return now;
  for (let i = 0; i < 14; i++) {
    const p = parts(m.tz, now + i * DAY);
    const d = iso(p);
    if (m.cme) {
      if (![0,1,2,3,4].includes(p.wd) || isClosedDay(m, d)) continue;
      const t = zonedTimeToUtc(p.y, p.mo, p.d, 17, 0, m.tz);
      if (t > now) return t;
      continue;
    }
    if (isWeekend(p.wd) || isClosedDay(m, d)) continue;
    const t = zonedTimeToUtc(p.y, p.mo, p.d, m.open[0], m.open[1], m.tz);
    if (t > now) return t;
  }
  return null;
}

function nextCloseMs(m, now = Date.now()) {
  if (m.alwaysOn) return null;
  let p = parts(m.tz, now);
  if (m.cme) {
    const mins = p.h * 60 + p.mi;
    if (mins >= 960) p = parts(m.tz, now + DAY);
    return zonedTimeToUtc(p.y, p.mo, p.d, 16, 0, m.tz);
  }
  let c = closeOf(m, iso(p));
  let t = zonedTimeToUtc(p.y, p.mo, p.d, c[0], c[1], m.tz);
  if (t <= now) {
    for (let i = 1; i < 14; i++) {
      const q = parts(m.tz, now + i * DAY);
      if (isWeekend(q.wd) || isClosedDay(m, iso(q))) continue;
      c = closeOf(m, iso(q));
      t = zonedTimeToUtc(q.y, q.mo, q.d, c[0], c[1], m.tz);
      break;
    }
  }
  return t;
}

function lastOpenMs(m, now = Date.now()) {
  if (m.alwaysOn) return now;
  for (let i = 0; i < 14; i++) {
    const p = parts(m.tz, now - i * DAY);
    if (m.cme) {
      if (![0,1,2,3,4].includes(p.wd) || isClosedDay(m, iso(p))) continue;
      const t = zonedTimeToUtc(p.y, p.mo, p.d, 17, 0, m.tz);
      if (t <= now) return t;
      continue;
    }
    if (isWeekend(p.wd) || isClosedDay(m, iso(p))) continue;
    const t = zonedTimeToUtc(p.y, p.mo, p.d, m.open[0], m.open[1], m.tz);
    if (t <= now) return t;
  }
  return null;
}

function nextBreakEndMs(m, now = Date.now()) {
  const p = parts(m.tz, now);
  if (m.cme) return zonedTimeToUtc(p.y, p.mo, p.d, 17, 0, m.tz);
  if (!m.lunch) return null;
  return zonedTimeToUtc(p.y, p.mo, p.d, m.lunchEnd[0], m.lunchEnd[1], m.tz);
}

function nextEvent(m, now = Date.now()) {
  const s = getStatus(m, now);
  if (s === 'open') return { label:'CLOSES IN', ms: nextCloseMs(m, now) };
  if (s === 'break') return { label:'REOPENS IN', ms: nextBreakEndMs(m, now) };
  if (s === 'pre') return { label:'OPENS IN', ms: nextOpenMs(m, now) };
  return { label:'OPENS IN', ms: nextOpenMs(m, now) };
}

// ── formatting ───────────────────────────────────────────────────────────────

function split(ms) {
  if (ms == null) return '—';
  ms = Math.max(0, ms);
  const d = Math.floor(ms / DAY);
  const h = Math.floor((ms % DAY) / 3600e3);
  const mi = Math.floor((ms % 3600e3) / 60e3);
  const s = Math.floor((ms % 60e3) / 1000);
  if (d > 0) return `${d}d ${pad(h)}h ${pad(mi)}m`;
  if (h > 0) return `${h}h ${pad(mi)}m`;
  return `${pad(mi)}m ${pad(s)}s`;
}

function localLabel(m, h, mi) {
  const today = parts(USER_TZ);
  const mk = parts(m.tz);
  const utc = zonedTimeToUtc(mk.y, mk.mo, mk.d, h, mi, m.tz);
  const u = parts(USER_TZ, utc);
  const dd = Math.round((Date.UTC(u.y,u.mo-1,u.d) - Date.UTC(today.y,today.mo-1,today.d)) / DAY);
  const suf = dd > 0 ? ` +${dd}d` : dd < 0 ? ` ${dd}d` : '';
  return `${pad(u.h)}:${pad(u.mi)}<small>${suf}</small>`;
}

// ── dom refs ─────────────────────────────────────────────────────────────────

const $ = id => document.getElementById(id);
const grid = $('markets-grid');
const strip = $('countdown-strip');
const emptyState = $('empty-state');
const emptyNext = $('empty-next');
const announcer = $('announcer');
const cardRefs = new Map();
const cdRefs = new Map();
const prevStatus = new Map();
let lastOrder = '';
let hideClosed = read('hideClosed') === '1';
let kzOn = read('kzVisible') === '1';
let theme = read('theme');

function read(k) { try { return localStorage.getItem(k); } catch { return null; } }
function write(k, v) { try { localStorage.setItem(k, v); } catch {} }

// ── build ────────────────────────────────────────────────────────────────────

function buildCards() {
  const frag = document.createDocumentFragment();
  for (const m of MARKETS) {
    const el = document.createElement('article');
    el.className = 'market-card';
    el.dataset.id = m.id;
    if (m.alwaysOn) {
      el.innerHTML = `<div class="card-top"><div><div class="market-name">${m.name}</div><div class="market-ticker">${m.ticker}</div></div><div class="status-badge open">OPEN 24/7</div></div>
        <div class="card-times"><div class="time-block"><div class="time-label">HOURS</div><div class="time-val highlight">24 / 7 / 365</div></div><div class="time-block"><div class="time-label">CLOSES</div><div class="time-val">NEVER</div></div></div>
        <div class="card-bottom"><div class="next-event">ALWAYS ACTIVE</div></div>
        <div class="session-progress"><div class="session-progress-fill" style="width:100%"></div></div>`;
    } else {
      el.innerHTML = `<div class="card-top"><div><div class="market-name">${m.name}</div><div class="market-ticker">${m.ticker}</div></div><div class="status-badge closed">CLOSED</div></div>
        <div class="card-times"><div class="time-block"><div class="time-label">OPEN (YOUR TIME)</div><div class="time-val tv-open">—</div></div><div class="time-block"><div class="time-label">CLOSE (YOUR TIME)</div><div class="time-val tv-close">—</div></div></div>
        <div class="card-bottom"><div class="next-event"><span class="ne-label"></span> <span class="ne-val"></span></div></div>
        <div class="session-progress"><div class="session-progress-fill"></div></div>`;
    }
    cardRefs.set(m.id, {
      el,
      badge: el.querySelector('.status-badge'),
      open: el.querySelector('.tv-open'),
      close: el.querySelector('.tv-close'),
      neLabel: el.querySelector('.ne-label'),
      neVal: el.querySelector('.ne-val'),
      fill: el.querySelector('.session-progress-fill'),
    });
    frag.appendChild(el);
  }
  grid.appendChild(frag);
}

function buildCountdowns() {
  const frag = document.createDocumentFragment();
  for (const id of COUNTDOWN_KEYS) {
    const m = MARKETS.find(x => x.id === id);
    const el = document.createElement('div');
    el.className = 'countdown-item';
    el.dataset.id = id;
    el.innerHTML = `<div class="countdown-dot closed"></div><div><div class="countdown-label"></div><div class="countdown-val"></div></div>`;
    cdRefs.set(id, { el, dot: el.querySelector('.countdown-dot'), label: el.querySelector('.countdown-label'), val: el.querySelector('.countdown-val'), name: m.name });
    frag.appendChild(el);
  }
  strip.appendChild(frag);
}

function buildForex() {
  const row = $('forex-row');
  row.innerHTML = FX_PAIRS.map(p => `<div class="forex-cell"><div class="fx-pair">${p}</div></div>`).join('');
}

// ── paint ────────────────────────────────────────────────────────────────────

const LABEL = { open:'OPEN', closed:'CLOSED', pre:'PRE-MKT', break:'BREAK', holiday:'HOLIDAY' };

function paintCard(m, now) {
  const r = cardRefs.get(m.id);
  const s = getStatus(m, now);

  r.el.className = `market-card ${s}`;
  r.badge.className = `status-badge ${s}`;
  r.badge.textContent = LABEL[s];

  if (m.alwaysOn) { r.el.hidden = false; return; }

  r.open.innerHTML = localLabel(m, m.open[0], m.open[1]);
  const c = closeOf(m, iso(parts(m.tz, now)));
  r.close.innerHTML = localLabel(m, c[0], c[1]);
  r.open.classList.toggle('highlight', s === 'open');

  const ev = nextEvent(m, now);
  r.neLabel.textContent = ev.label;
  r.neVal.textContent = split(ev.ms != null ? ev.ms - now : null);

  let pct = 0;
  if (s === 'open') {
    const a = lastOpenMs(m, now), b = nextCloseMs(m, now);
    if (a != null && b != null && b > a) pct = Math.min(100, ((now - a) / (b - a)) * 100);
  }
  r.fill.style.width = `${pct.toFixed(1)}%`;

  r.el.hidden = hideClosed && s === 'closed';

  const prev = prevStatus.get(m.id);
  if (prev && prev !== s) announce(`${m.name} ${LABEL[s].toLowerCase()}`);
  prevStatus.set(m.id, s);
}

function paintCountdowns(now) {
  const items = COUNTDOWN_KEYS.map(id => {
    const m = MARKETS.find(x => x.id === id);
    const s = getStatus(m, now);
    const ev = nextEvent(m, now);
    return { id, name: m.name, open: s === 'open', ms: ev.ms, label: ev.label };
  }).sort((a, b) => (a.ms ?? Infinity) - (b.ms ?? Infinity) || a.name.localeCompare(b.name));

  const order = items.map(i => i.id).join(',');
  if (order !== lastOrder) {
    lastOrder = order;
    for (const i of items) strip.appendChild(cdRefs.get(i.id).el);
  }

  for (const i of items) {
    const r = cdRefs.get(i.id);
    r.dot.className = `countdown-dot ${i.open ? 'open' : 'closed'}`;
    r.label.textContent = `${i.name} · ${i.label}`;
    const rem = i.ms != null ? i.ms - now : null;
    r.val.textContent = split(rem);
    r.val.classList.toggle('urgent', !i.open && rem != null && rem < 18e5);
  }
}

function paintSessionBar(now) {
  const tl = $('session-timeline');
  tl.querySelectorAll('.session-block').forEach(n => n.remove());
  const needle = $('time-needle');
  const utcH = (now % DAY) / 36e5;
  needle.style.left = `${(utcH / 24) * 100}%`;

  const toUTC = (tz, h, mi) => {
    const p = parts(tz);
    return ((zonedTimeToUtc(p.y, p.mo, p.d, h, mi, tz) % DAY) / 36e5 + 24) % 24;
  };
  const ny = MARKETS.find(m => m.id === 'nasdaq');
  const tk = MARKETS.find(m => m.id === 'tse');

  const blocks = [
    { label:'ASIA',   start: toUTC(tk.tz, tk.open[0], tk.open[1]),  end: toUTC(tk.tz, tk.close[0], tk.close[1]), cls:'asia' },
    { label:'LONDON', start: toUTC('Europe/London', 8, 0),          end: toUTC('Europe/London', 16, 30),         cls:'europe' },
    { label:'US PRE', start: toUTC(ny.tz, 4, 0),                    end: toUTC(ny.tz, 9, 30),                    cls:'us', pre:true },
    { label:'US',     start: toUTC(ny.tz, 9, 30),                   end: toUTC(ny.tz, 16, 0),                    cls:'us' },
    { label:'LDN/US', start: toUTC(ny.tz, 9, 30),                   end: toUTC('Europe/London', 16, 30),         cls:'overlap' },
  ];

  for (const b of blocks) {
    if (b.end <= b.start) continue;
    const d = document.createElement('div');
    d.className = `session-block ${b.cls} ${utcH >= b.start && utcH < b.end ? 'active' : 'inactive'}${b.pre ? ' pre-market' : ''}`;
    d.style.left = `${(b.start / 24) * 100}%`;
    d.style.width = `${((b.end - b.start) / 24) * 100}%`;
    if (!b.pre && b.end - b.start > 2) d.textContent = b.label;
    tl.insertBefore(d, needle);
  }

  // ruler, rebuilt only when geometry changes
  $('time-ruler').innerHTML = [0,3,6,9,12,15,18,21,24].map(h => {
    const u = parts(USER_TZ, Date.UTC(parts(USER_TZ).y, parts(USER_TZ).mo - 1, parts(USER_TZ).d, h % 24));
    return `<div class="time-ruler-tick"><span class="time-ruler-utc">${pad(h % 24)}:00</span><span class="time-ruler-local">${pad(u.h)}:${pad(u.mi)}</span></div>`;
  }).join('');
}

function killZones() {
  const toUTC = (h, mi) => {
    const p = parts('America/New_York');
    return ((zonedTimeToUtc(p.y, p.mo, p.d, h, mi, 'America/New_York') % DAY) / 36e5 + 24) % 24;
  };
  const s = toUTC(20, 0);
  const zones = [
    { a: toUTC(2, 0), b: toUTC(5, 0) },
    { a: toUTC(7, 0), b: toUTC(10, 0) },
    { a: toUTC(10, 0), b: toUTC(12, 0) },
    s + 4 <= 24 ? { a: s, b: s + 4 } : { a: s, b: 24 },
  ];
  if (s + 4 > 24) zones.push({ a: 0, b: s + 4 - 24 });
  return zones.filter(z => z.b > z.a);
}

function paintKillZones(now) {
  if (!kzOn) return;
  const row = $('kz-row');
  row.innerHTML = '';
  for (const z of killZones()) {
    const d = document.createElement('div');
    d.className = 'kz-block';
    d.style.left = `${(z.a / 24) * 100}%`;
    d.style.width = `${((z.b - z.a) / 24) * 100}%`;
    row.appendChild(d);
  }
  const n = document.createElement('div');
  n.className = 'kz-needle';
  n.style.left = `${(((now % DAY) / 36e5) / 24) * 100}%`;
  row.appendChild(n);
}

function paintEmptyState(now) {
  const visible = MARKETS.filter(m => !m.alwaysOn && !(hideClosed && getStatus(m, now) === 'closed'));
  const show = hideClosed && visible.length === 0;
  emptyState.hidden = !show;
  if (show) {
    const nx = MARKETS.filter(m => !m.alwaysOn)
      .map(m => ({ n: m.name, ms: nextOpenMs(m, now) }))
      .filter(x => x.ms != null).sort((a, b) => a.ms - b.ms)[0];
    emptyNext.textContent = nx ? `Next open: ${nx.n} in ${split(nx.ms - now)}` : '—';
  }
}

function paintClock(now) {
  const d = new Date(now);
  $('local-time').textContent = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  const dw = ['SUN','MON','TUE','WED','THU','FRI','SAT'][d.getDay()];
  const mo = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'][d.getMonth()];
  $('local-date').textContent = `${dw} ${pad(d.getDate())} ${mo} ${d.getFullYear()}`;
  const off = -d.getTimezoneOffset();
  $('local-tz').textContent = `${USER_TZ} · UTC${off >= 0 ? '+' : '-'}${pad(Math.floor(Math.abs(off) / 60))}:${pad(Math.abs(off) % 60)}`;
  $('last-update').textContent = `LAST UPDATE: ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

// ── loop ─────────────────────────────────────────────────────────────────────

let timer;
function tick() {
  const now = Date.now();
  paintClock(now);
  for (const m of MARKETS) paintCard(m, now);
  paintCountdowns(now);
  paintKillZones(now);
  paintEmptyState(now);
}

let structCount = 0;
function loop() {
  tick();
  if (++structCount % 30 === 0) paintSessionBar(Date.now());
  const delay = 1000 - (Date.now() % 1000) + 10;
  timer = setTimeout(loop, delay);
}

function announce(msg) {
  announcer.textContent = msg;
}

// ── controls ─────────────────────────────────────────────────────────────────

function setKz(on) {
  kzOn = on;
  const row = $('kz-row');
  row.hidden = !on;
  $('kz-pip').classList.toggle('on', on);
  $('kz-key-item').hidden = !on;
  $('session-timeline').classList.toggle('kz-active', on);
  $('kz-toggle').setAttribute('aria-checked', String(on));
  write('kzVisible', on ? '1' : '0');
  paintKillZones(Date.now());
}

function setHideClosed(on) {
  hideClosed = on;
  $('hide-closed-pip').classList.toggle('on', on);
  $('hide-closed').setAttribute('aria-checked', String(on));
  write('hideClosed', on ? '1' : '0');
  tick();
}

function setTheme(light) {
  theme = light ? 'light' : 'dark';
  document.body.classList.toggle('light', light);
  $('toggle-track').classList.toggle('on', light);
  $('theme-toggle').setAttribute('aria-checked', String(light));
  document.querySelector('meta[name="theme-color"]').content = light ? '#f4f6f9' : '#0a0c0f';
  write('theme', theme);
}

// ── init ─────────────────────────────────────────────────────────────────────

buildCards();
buildCountdowns();
buildForex();

$('kz-toggle').addEventListener('click', () => setKz(!kzOn));
$('hide-closed').addEventListener('click', () => setHideClosed(!hideClosed));
$('theme-toggle').addEventListener('click', () => setTheme(theme !== 'light'));

document.addEventListener('visibilitychange', () => {
  if (document.hidden) { clearTimeout(timer); }
  else { paintSessionBar(Date.now()); loop(); }
});

if (theme === 'light') setTheme(true);
setHideClosed(hideClosed);
setKz(kzOn);

paintSessionBar(Date.now());
loop();