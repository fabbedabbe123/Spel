// Grottkrigarna – ett grottäventyr för 1–4 spelare.
// Värden kör hela spelet och skickar läget till kompisarna, som bara skickar sina knapptryck (se relay.js).
// Grottan slumpas fram från ett frö, så kartan behöver aldrig skickas – bara fröet.

(() => {
  const $ = id => document.getElementById(id);
  const canvas = $('game');
  const ctx = canvas.getContext('2d');
  const dark = document.createElement('canvas');
  const dctx = dark.getContext('2d');
  let CW = 0, CH = 0, DPR = 1;
  function resize() {
    DPR = window.devicePixelRatio || 1;
    CW = window.innerWidth;
    CH = window.innerHeight;
    canvas.width = dark.width = CW * DPR;
    canvas.height = dark.height = CH * DPR;
  }
  window.addEventListener('resize', resize);
  resize();

  // ---------- Inställningar ----------
  const DEFAULT_PORT = 7779;
  const TILE = 32, MW = 64, MH = 48;   // kartan är 64 × 48 rutor
  const LAST_FLOOR = 9;
  const VIEW_W = 960, VIEW_H = 640;    // alla ser lika stor del av grottan
  const LIGHT = 330;                   // hur långt ljuset runt en spelare når

  const CLASSES = {
    warrior: { name: 'Krigare',  icon: '⚔️', color: '#ffcf3f', hp: 150, spd: 155, cd: 0.42, acd: 6,
      desc: 'Hugger med svärd på nära håll.', special: 'Virvelhugg runt omkring dig' },
    ranger:  { name: 'Bågskytt', icon: '🏹', color: '#7cff6b', hp: 95,  spd: 178, cd: 0.32, acd: 5,
      desc: 'Skjuter snabba pilar.', special: 'Pilregn som går igenom fiender' },
    mage:    { name: 'Magiker',  icon: '🔥', color: '#5ef1ff', hp: 85,  spd: 160, cd: 0.36, acd: 7,
      desc: 'Skjuter magiska klot.', special: 'Eldklot som exploderar' },
    healer:  { name: 'Helare',   icon: '✨', color: '#f15bb5', hp: 110, spd: 162, cd: 0.4,  acd: 9,
      desc: 'Skjuter ljusstrålar.', special: 'Helar och återupplivar laget' },
  };
  const ENEMY = {
    slime:    { name: 'Slem',       r: 12, hp: 32, spd: 70,  dmg: 10, xp: 5,  color: '#7cff6b' },
    bat:      { name: 'Fladdermus', r: 9,  hp: 16, spd: 150, dmg: 6,  xp: 4,  color: '#c77dff' },
    skeleton: { name: 'Skelett',    r: 12, hp: 36, spd: 65,  dmg: 12, xp: 8,  color: '#e8ecff' },
    orc:      { name: 'Orch',       r: 15, hp: 80, spd: 85,  dmg: 18, xp: 12, color: '#ff8a5e' },
    boss:     { name: 'Boss',       r: 34, hp: 900, spd: 62, dmg: 22, xp: 160, color: '#ff5ea8' },
  };
  const BOSSES = {
    3: { name: 'Grottjätten',   color: '#ff8a5e', shot: 'rock' },
    6: { name: 'Skelettkungen', color: '#e8ecff', shot: 'bone' },
    9: { name: 'Draken',        color: '#ff5ea8', shot: 'flame' },
  };
  const ETYPES = ['slime', 'bat', 'skeleton', 'orc', 'boss'];
  const PKINDS = ['arrow', 'bolt', 'fire', 'light', 'bone', 'rock', 'flame'];
  const IKINDS = ['gold', 'potion', 'heart', 'chest', 'upgrade'];

  // ---------- Hjälpfunktioner ----------
  const rand = (a, b) => a + Math.random() * (b - a);
  const randInt = (a, b) => Math.floor(rand(a, b + 1));
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const r1 = v => Math.round(v * 10) / 10;
  const r2 = v => Math.round(v * 100) / 100;
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const angDiff = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));
  function load(key, fallback) {
    try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; }
  }
  function store(key, v) {
    try { localStorage.setItem(key, String(v)); } catch {}
  }
  // Slumptal från ett frö: samma frö ger samma grotta på alla datorer
  function rng(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  // ---------- Ljud (genereras, inga filer behövs) ----------
  let audio = null;
  let muted = load('grotta-muted', '0') === '1';
  function beep(freq, dur, type = 'square', vol = 0.05, slide = 0, delay = 0) {
    if (muted) return;
    try {
      audio = audio || new (window.AudioContext || window.webkitAudioContext)();
      const t = audio.currentTime + delay;
      const o = audio.createOscillator();
      const g = audio.createGain();
      o.type = type;
      o.frequency.setValueAtTime(freq, t);
      if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t + dur);
      g.gain.setValueAtTime(vol, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g).connect(audio.destination);
      o.start(t);
      o.stop(t + dur);
    } catch {}
  }
  const sfx = {
    swing: () => beep(300, 0.1, 'sawtooth', 0.04, -180),
    shoot: () => beep(900, 0.07, 'square', 0.025, -500),
    magic: () => beep(600, 0.12, 'sine', 0.05, 400),
    hit: () => beep(200, 0.05, 'square', 0.03, -80),
    kill: () => beep(140, 0.25, 'sawtooth', 0.05, -90),
    coin: () => { beep(988, 0.06, 'square', 0.03); beep(1319, 0.1, 'square', 0.03, 0, 0.06); },
    pickup: () => { beep(523, 0.1, 'sine', 0.06); beep(784, 0.14, 'sine', 0.06, 0, 0.08); },
    level: () => [523, 659, 784, 1047].forEach((f, i) => beep(f, 0.22, 'triangle', 0.07, 0, i * 0.1)),
    hurt: () => beep(180, 0.3, 'triangle', 0.09, -120),
    down: () => beep(300, 0.6, 'sawtooth', 0.06, -250),
    revive: () => [392, 523, 659].forEach((f, i) => beep(f, 0.18, 'sine', 0.07, 0, i * 0.09)),
    heal: () => { beep(660, 0.2, 'sine', 0.06, 300); beep(880, 0.25, 'sine', 0.05, 200, 0.1); },
    boom: () => beep(90, 0.45, 'sawtooth', 0.09, -60),
    stairs: () => [784, 659, 523, 392].forEach((f, i) => beep(f, 0.18, 'triangle', 0.06, 0, i * 0.1)),
    boss: () => { beep(70, 0.8, 'sawtooth', 0.09, 40); beep(55, 0.9, 'square', 0.05, 30, 0.1); },
    chest: () => [523, 659, 784, 988, 1175].forEach((f, i) => beep(f, 0.12, 'square', 0.035, 0, i * 0.06)),
  };

  // ---------- Speltillstånd ----------
  // state: menu | connecting | lobby | playing | paused | gameover | victory | error
  let state = 'menu';
  let mode = null; // 'solo' | 'host' | 'client'
  let myId = 0;
  let ws = null;
  let lanInfo = null;
  let players = [], enemies = [], projs = [], items = [];
  let floor = 0, seed = 0, dungeon = null, mapCanvas = null, explored = null;
  let team = { gold: 0, xp: 0, need: 60, lvl: 1 };
  let stairs = null;
  let descend = { n: 0, total: 0, t: 0 };
  let runTime = 0, endAt = 0;
  let particles = [], floaters = [], effects = [];
  let shake = 0;
  let netFx = [];
  let nextId = 1;
  let flow = null, flowTimer = 0, exploreTimer = 0;
  let bossAwake = false;
  let lastSent = '', lastSendAt = 0;

  // ---------- Grottgenerator ----------
  function makeDungeon(sd, fl) {
    const R = rng(sd);
    const ri = (a, b) => a + Math.floor(R() * (b - a + 1));
    const g = new Uint8Array(MW * MH).fill(1);
    const rooms = [];
    const overlaps = (x, y, w, h) => rooms.some(r => x < r.x + r.w + 2 && x + w + 2 > r.x && y < r.y + r.h + 2 && y + h + 2 > r.y);
    let big = null;
    // Bossvåningar får ett stort bossrum
    if (fl % 3 === 0) {
      for (let t = 0; t < 300 && !big; t++) {
        const w = 16, h = 12, x = ri(2, MW - w - 3), y = ri(2, MH - h - 3);
        if (!overlaps(x, y, w, h)) { big = { x, y, w, h }; rooms.push(big); }
      }
    }
    for (let t = 0; t < 500 && rooms.length < 12; t++) {
      const w = ri(6, 11), h = ri(5, 8), x = ri(1, MW - w - 2), y = ri(1, MH - h - 2);
      if (!overlaps(x, y, w, h)) rooms.push({ x, y, w, h });
    }
    for (const r of rooms) {
      r.cx = r.x + (r.w >> 1);
      r.cy = r.y + (r.h >> 1);
      for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) g[y * MW + x] = 0;
    }
    const d2 = (a, b) => (a.cx - b.cx) ** 2 + (a.cy - b.cy) ** 2;
    const others = rooms.filter(r => r !== big);
    let start = others[0];
    if (big) start = others.reduce((best, r) => (d2(r, big) > d2(best, big) ? r : best), others[0]);
    // Koppla ihop rummen i en kedja: alltid närmaste rum härnäst
    const chain = [start];
    const left = others.filter(r => r !== start);
    while (left.length) {
      const last = chain[chain.length - 1];
      let bi = 0;
      left.forEach((r, i) => { if (d2(r, last) < d2(left[bi], last)) bi = i; });
      chain.push(left.splice(bi, 1)[0]);
    }
    const carve = (x, y) => { if (x > 0 && y > 0 && x < MW - 1 && y < MH - 1) g[y * MW + x] = 0; };
    const corridor = (a, b) => {
      let x = a.cx, y = a.cy;
      const stepX = () => { while (x !== b.cx) { carve(x, y); carve(x, y + 1); x += Math.sign(b.cx - x); } };
      const stepY = () => { while (y !== b.cy) { carve(x, y); carve(x + 1, y); y += Math.sign(b.cy - y); } };
      if (R() < 0.5) { stepX(); stepY(); } else { stepY(); stepX(); }
      carve(x, y); carve(x + 1, y); carve(x, y + 1);
    };
    for (let i = 1; i < chain.length; i++) corridor(chain[i - 1], chain[i]);
    // Några extra gångar så att det blir rundor att springa
    for (let k = 0; k < 2 && chain.length > 3; k++) {
      const a = chain[ri(0, chain.length - 1)], b = chain[ri(0, chain.length - 1)];
      if (a !== b) corridor(a, b);
    }
    let end = chain[chain.length - 1];
    if (big) {
      const near = chain.reduce((best, r) => (d2(r, big) < d2(best, big) ? r : best), chain[0]);
      corridor(near, big);
      end = big;
    }
    return { g, rooms: big ? [...chain, big] : chain, start, end, boss: !!big };
  }

  const isWall = (tx, ty) => tx < 0 || ty < 0 || tx >= MW || ty >= MH || dungeon.g[ty * MW + tx] === 1;
  const wallAt = (px, py) => isWall(Math.floor(px / TILE), Math.floor(py / TILE));
  function blocked(x, y, r) {
    const k = r * 0.9;
    return wallAt(x - k, y - k) || wallAt(x + k, y - k) || wallAt(x - k, y + k) || wallAt(x + k, y + k);
  }
  // Flyttar en figur och låter den glida längs väggar
  function moveCircle(e, dx, dy) {
    if (!blocked(e.x + dx, e.y, e.r)) e.x += dx;
    if (!blocked(e.x, e.y + dy, e.r)) e.y += dy;
  }
  function los(ax, ay, bx, by) {
    const d = Math.hypot(bx - ax, by - ay);
    const steps = Math.ceil(d / 10);
    for (let i = 1; i < steps; i++) {
      if (wallAt(ax + (bx - ax) * i / steps, ay + (by - ay) * i / steps)) return false;
    }
    return true;
  }

  // Ritar hela kartan en gång till en egen bild, så den går snabbt att visa
  function buildMap() {
    const c = document.createElement('canvas');
    c.width = MW * TILE;
    c.height = MH * TILE;
    const m = c.getContext('2d');
    const R = rng(seed ^ 0x9e3779b9);
    m.fillStyle = '#07060f';
    m.fillRect(0, 0, c.width, c.height);
    const floorAt = (x, y) => !isWall(x, y);
    for (let y = 0; y < MH; y++) {
      for (let x = 0; x < MW; x++) {
        const px = x * TILE, py = y * TILE;
        if (floorAt(x, y)) {
          const v = R();
          m.fillStyle = v < 0.08 ? '#211b3f' : v < 0.55 ? '#1a1632' : '#18142e';
          m.fillRect(px, py, TILE, TILE);
          m.fillStyle = '#ffffff06';
          m.fillRect(px, py, TILE, 1);
          m.fillRect(px, py, 1, TILE);
          if (R() < 0.07) { m.fillStyle = '#2a2350'; m.fillRect(px + 4 + R() * 22, py + 4 + R() * 22, 3, 3); }
        } else {
          let near = false;
          for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (floorAt(x + dx, y + dy)) near = true;
          if (!near) continue;
          m.fillStyle = '#2a2350';
          m.fillRect(px, py, TILE, TILE);
          m.fillStyle = '#342c63';
          m.fillRect(px, py, TILE, 8);
          m.fillStyle = '#7a6be6';
          if (floorAt(x, y + 1)) m.fillRect(px, py + TILE - 3, TILE, 3);
          if (floorAt(x, y - 1)) m.fillRect(px, py, TILE, 2);
          if (floorAt(x - 1, y)) m.fillRect(px, py, 2, TILE);
          if (floorAt(x + 1, y)) m.fillRect(px + TILE - 2, py, 2, TILE);
        }
      }
    }
    return c;
  }

  function onNewMap() {
    mapCanvas = buildMap();
    explored = new Uint8Array(MW * MH);
    flow = null;
  }

  // Avståndskarta från spelarna (bredden-först), så monster hittar runt hörn
  function computeFlow() {
    flow = new Int16Array(MW * MH).fill(-1);
    const q = [];
    for (const p of players) {
      if (p.down) continue;
      const t = Math.floor(p.y / TILE) * MW + Math.floor(p.x / TILE);
      if (flow[t] !== 0) { flow[t] = 0; q.push(t); }
    }
    for (let i = 0; i < q.length; i++) {
      const t = q[i], x = t % MW, y = (t / MW) | 0, d = flow[t];
      if (d > 45) continue;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy, n = ny * MW + nx;
        if (!isWall(nx, ny) && flow[n] === -1) { flow[n] = d + 1; q.push(n); }
      }
    }
  }
  function flowDir(e) {
    if (!flow) return null;
    const tx = Math.floor(e.x / TILE), ty = Math.floor(e.y / TILE);
    const here = flow[ty * MW + tx];
    if (here <= 0) return null;
    let best = null, bd = here;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = tx + dx, ny = ty + dy;
        if (isWall(nx, ny) || (dx && dy && (isWall(tx + dx, ty) || isWall(tx, ty + dy)))) continue;
        const d = flow[ny * MW + nx];
        if (d >= 0 && d < bd) { bd = d; best = [nx, ny]; }
      }
    }
    if (!best) return null;
    return Math.atan2((best[1] + 0.5) * TILE - e.y, (best[0] + 0.5) * TILE - e.x);
  }

  // ---------- Effekter (körs lokalt och skickas till kompisarna) ----------
  function fx(ev) {
    runFx(ev);
    if (mode === 'host') netFx.push(ev);
  }
  function runFx(ev) {
    const forMe = ev.who === undefined || ev.who === myId;
    switch (ev.k) {
      case 'sfx': if (forMe && sfx[ev.n]) sfx[ev.n](); break;
      case 'boom':
        for (let i = 0; i < ev.n; i++) {
          const a = rand(0, Math.PI * 2), s = rand(30, ev.p);
          particles.push({ x: ev.x, y: ev.y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: rand(0.3, 0.8), max: 0.8, color: ev.c, size: rand(2, 4) });
        }
        break;
      case 'swing': effects.push({ type: 'swing', x: ev.x, y: ev.y, a: ev.a, r: ev.r, c: ev.c, life: 0.18, max: 0.18 }); break;
      case 'ring': effects.push({ type: 'ring', x: ev.x, y: ev.y, r: ev.r, c: ev.c, life: 0.4, max: 0.4 }); break;
      case 'float': floaters.push({ x: ev.x, y: ev.y, text: ev.text, c: ev.c || '#ffe066', life: ev.life || 1.1, size: ev.size || 15 }); break;
      case 'shake': if (forMe) shake = Math.max(shake, ev.a); break;
    }
  }
  const explode = (x, y, c, n = 16, p = 180) => fx({ k: 'boom', x: x | 0, y: y | 0, c, n, p });
  const float = (x, y, text, c, size, life) => fx({ k: 'float', x: x | 0, y: y | 0, text, c, size, life });

  // ---------- Meny och lobby (HTML) ----------
  const nameInput = $('name');
  const addrInput = $('addr');
  nameInput.value = load('grotta-name', '');
  addrInput.value = load('grotta-addr', '');
  // Som webbsida används rumskoder i stället för IP-adresser (se net.js)
  const ONLINE = !!(window.GameNet && window.GameNet.online);
  if (ONLINE) {
    addrInput.placeholder = 'Rumskod, t.ex. MZRB';
    addrInput.maxLength = 4;
    addrInput.style.textTransform = 'uppercase';
    addrInput.value = '';
  }
  let myClass = CLASSES[load('grotta-cls', 'warrior')] ? load('grotta-cls', 'warrior') : 'warrior';

  function myName() {
    const n = nameInput.value.trim().slice(0, 12) || 'Krigare';
    store('grotta-name', n);
    return n;
  }

  function classCards(container, onPick) {
    container.replaceChildren();
    for (const [key, c] of Object.entries(CLASSES)) {
      const b = el('button', 'cls' + (key === myClass ? ' on' : ''));
      b.style.setProperty('--c', c.color);
      b.append(el('span', 'icon', c.icon), el('span', 'cname', c.name), el('span', 'cdesc', c.desc),
        el('span', 'cdesc', '★ ' + c.special), el('span', 'cstat', `❤ ${c.hp} liv`));
      b.onclick = () => {
        myClass = key;
        store('grotta-cls', key);
        container.querySelectorAll('.cls').forEach(x => x.classList.toggle('on', x === b));
        if (onPick) onPick(key);
        b.blur();
      };
      container.append(b);
    }
  }
  classCards($('classes'));

  function showOverlay(id) {
    for (const o of ['menu', 'lobby', 'error']) $(o).classList.toggle('active', o === id);
    if (id) document.activeElement && document.activeElement.blur && document.activeElement.blur();
  }
  let lastOverlayState = '';
  function syncOverlay() {
    if (state === lastOverlayState) return;
    lastOverlayState = state;
    if (state === 'menu') showOverlay('menu');
    else if (state === 'lobby') { showOverlay('lobby'); lobbyKey = ''; classCards($('lobbyClasses'), changeClass); }
    else if (state === 'connecting' || state === 'error') showOverlay('error');
    else showOverlay(null);
  }

  function changeClass(cls) {
    if (mode === 'client') send({ t: 'cls', c: cls });
    else {
      const me = players.find(p => p.id === myId);
      if (me) setClass(me, cls);
    }
  }

  let lobbyKey = '';
  function renderLobby() {
    const key = JSON.stringify([players.map(p => [p.id, p.name, p.cls]), lanInfo, mode]);
    if (key === lobbyKey) return;
    lobbyKey = key;
    $('addrCard').style.display = lanInfo ? '' : 'none';
    if (lanInfo && lanInfo.code) {
      $('addrTitle').textContent = 'Kompisarna öppnar samma sida, skriver in rumskoden och klickar "Gå med"';
      $('addrText').textContent = `Rumskod: ${lanInfo.code}`;
    } else if (lanInfo) {
      const port = lanInfo.port !== DEFAULT_PORT ? ':' + lanInfo.port : '';
      const ips = lanInfo.ips.length ? lanInfo.ips : ['localhost'];
      $('addrText').textContent = ips.slice(0, 3).map(ip => ip + port).join('  eller  ');
    }
    $('playerCount').textContent = `Spelare (${players.length}/4)`;
    const list = $('lobbyPlayers');
    list.replaceChildren();
    for (const p of players) {
      const c = CLASSES[p.cls];
      const row = el('div', 'pl');
      row.style.setProperty('--c', c.color);
      row.append(el('span', '', c.icon), el('span', '', p.name + (p.id === myId ? ' (du)' : '') + (p.id === 0 ? ' 👑' : '')), el('span', 'pc', c.name));
      list.append(row);
    }
    $('btnStart').style.display = mode === 'client' ? 'none' : '';
    $('lobbyInfo').textContent = mode === 'client'
      ? 'Väntar på att värden startar äventyret…'
      : players.length === 1 ? 'Väntar på kompisar… Du kan starta när alla är med. Kompisar kan också hoppa in mitt i spelet.' : '';
  }

  $('btnSolo').onclick = () => {
    mode = 'solo';
    myId = 0;
    players = [makePlayer(0, myName(), myClass)];
    startRun();
  };

  $('btnHost').onclick = async () => {
    const name = myName();
    mode = 'host';
    myId = 0;
    players = [makePlayer(0, name, myClass)];
    if (ONLINE) return connect(() => window.GameNet.host('grottkrigarna', 3), () => send({ t: 'host' }), 'Skapar ett rum…');
    let url;
    if (window.net) {
      const res = await window.net.startHost(DEFAULT_PORT);
      if (res.error) return fail(res.error);
      url = `ws://localhost:${res.port}`;
    } else {
      url = `ws://${location.host}`;
    }
    connect(url, () => send({ t: 'host' }));
  };

  function join() {
    let addr = addrInput.value.trim();
    if (!addr) { addrInput.focus(); return; }
    store('grotta-addr', addr);
    const code = ONLINE ? window.GameNet.cleanCode(addr) : '';
    if (ONLINE && code.length !== 4) { addrInput.focus(); addrInput.select(); return; }
    addr = addr.replace(/^wss?:\/\//, '');
    if (!/:\d+$/.test(addr)) addr += ':' + DEFAULT_PORT;
    const name = myName();
    mode = 'client';
    myId = -1;
    players = [];
    lastSent = '';
    connect(ONLINE ? () => window.GameNet.join('grottkrigarna', code) : `ws://${addr}`,
      () => send({ t: 'join', name, cls: myClass }), ONLINE ? `Rum ${code}` : null);
  }
  $('btnJoin').onclick = join;
  addrInput.addEventListener('keydown', e => { if (e.key === 'Enter') join(); });
  $('btnLeave').onclick = () => toMenu();
  $('btnErrBack').onclick = () => toMenu();
  $('btnStart').onclick = () => { if (mode !== 'client' && state === 'lobby') startRun(); };

  function toMenu() {
    if (ws) { ws.onclose = null; ws.close(); ws = null; }
    mode = null;
    state = 'menu';
    players = []; enemies = []; projs = []; items = [];
    dungeon = null; seed = 0;
    classCards($('classes'));
  }

  // ---------- Nätverk ----------
  // url är en ws://-adress (desktop-appen) eller en funktion som skapar en direktkoppling (webbsidan)
  function connect(url, onOpen, label) {
    state = 'connecting';
    $('errTitle').textContent = 'Ansluter…';
    $('errText').textContent = label || String(url).replace('ws://', '');
    $('btnErrBack').textContent = 'Avbryt';
    try { ws = typeof url === 'function' ? url() : new WebSocket(url); } catch { return fail('Ogiltig adress.'); }
    const sock = ws;
    const timer = setTimeout(() => {
      if (ws === sock && sock.readyState !== 1) {
        fail(ONLINE ? 'Kunde inte ansluta. Kolla rumskoden och din internetanslutning.' : 'Kunde inte ansluta. Kolla IP-adressen och att värden har skapat ett spel.');
      }
    }, ONLINE ? 12000 : 6000);
    sock.onopen = () => { clearTimeout(timer); onOpen(); };
    sock.onmessage = ev => { try { onNet(JSON.parse(ev.data)); } catch (err) { console.error(err); } };
    sock.onclose = () => {
      clearTimeout(timer);
      if (ws === sock) fail(mode === 'client' ? 'Anslutningen till värden bröts.' : 'Servern stängdes.');
    };
  }
  function send(m) {
    if (ws && ws.readyState === 1) ws.send(JSON.stringify(m));
  }
  function fail(msg) {
    if (ws) { ws.onclose = null; ws.close(); ws = null; }
    state = 'error';
    $('errTitle').textContent = 'Hoppsan!';
    $('errText').textContent = msg;
    $('btnErrBack').textContent = 'Tillbaka till menyn';
  }

  function onNet(m) {
    if (m.t === 'error') return fail(m.msg);
    if (mode === 'host') {
      if (m.t === 'hosted') {
        lanInfo = { ips: m.ips, port: m.port, code: m.code };
        state = 'lobby';
      } else if (m.t === 'joined') {
        const p = makePlayer(m.id, m.name, CLASSES[m.cls] ? m.cls : 'warrior');
        // Hoppar man in mitt i spelet hamnar man bredvid en lagkamrat
        if (state === 'playing') {
          const buddy = players.find(q => !q.down) || players[0];
          p.x = buddy.x; p.y = buddy.y; p.invuln = 3;
        }
        players.push(p);
        if (dungeon) float(p.x, p.y - 30, `${p.name} gick med!`, CLASSES[p.cls].color, 16, 2);
        fx({ k: 'sfx', n: 'pickup' });
      } else if (m.t === 'input') {
        const p = players.find(p => p.id === m.id);
        if (p && m.k) p.input = m.k;
      } else if (m.t === 'cls') {
        const p = players.find(p => p.id === m.id);
        if (p && state === 'lobby' && CLASSES[m.c]) setClass(p, m.c);
      } else if (m.t === 'left') {
        const p = players.find(p => p.id === m.id);
        players = players.filter(p => p.id !== m.id);
        if (p && dungeon) float(p.x, p.y - 30, `${p.name} lämnade`, '#9a93cc', 15, 2);
        if (state === 'playing' && !players.some(p => !p.down)) gameOver();
      }
    } else if (mode === 'client') {
      if (m.t === 'welcome') myId = m.id;
      else if (m.t === 'state') applySnapshot(m);
      else if (m.t === 'hostLeft') fail('Värden lämnade spelet.');
    }
  }

  function snapshot() {
    return {
      t: 'state', s: state, fl: floor, sd: seed, ip: lanInfo, tm: [team.gold, team.xp, team.need, team.lvl],
      st: stairs ? [stairs.x | 0, stairs.y | 0, stairs.open ? 1 : 0] : 0,
      dc: [descend.n, descend.total, r1(descend.t)], rt: r1(runTime), ba: bossAwake ? 1 : 0,
      p: players.map(p => [p.id, p.name, p.cls, p.x | 0, p.y | 0, Math.ceil(p.hp), Math.round(p.maxHp), r2(p.aim),
        p.down ? 1 : 0, r1(p.revive), p.potions, r1(p.acd), r1(p.invuln), p.kills, r2(p.dmg)]),
      e: enemies.map(e => [e.id, ETYPES.indexOf(e.type), e.x | 0, e.y | 0, Math.ceil(e.hp), Math.round(e.maxHp), e.flash > 0 ? 1 : 0]),
      b: projs.map(b => [b.x | 0, b.y | 0, PKINDS.indexOf(b.kind), r2(Math.atan2(b.vy, b.vx))]),
      it: items.map(i => [i.id, IKINDS.indexOf(i.kind), i.x | 0, i.y | 0]),
      fx: netFx,
    };
  }

  function applySnapshot(m) {
    state = m.s;
    lanInfo = m.ip;
    if (m.sd && m.sd !== seed) {
      seed = m.sd;
      floor = m.fl;
      dungeon = makeDungeon(seed, floor);
      onNewMap();
    }
    floor = m.fl;
    [team.gold, team.xp, team.need, team.lvl] = m.tm;
    stairs = m.st ? { x: m.st[0], y: m.st[1], open: !!m.st[2] } : null;
    [descend.n, descend.total, descend.t] = m.dc;
    runTime = m.rt;
    bossAwake = !!m.ba;
    players = m.p.map(a => ({ id: a[0], name: a[1], cls: a[2], x: a[3], y: a[4], hp: a[5], maxHp: a[6], aim: a[7],
      down: !!a[8], revive: a[9], potions: a[10], acd: a[11], invuln: a[12], kills: a[13], dmg: a[14], r: 12 }));
    enemies = m.e.map(a => ({ id: a[0], type: ETYPES[a[1]], x: a[2], y: a[3], hp: a[4], maxHp: a[5], flash: a[6],
      r: ENEMY[ETYPES[a[1]]].r }));
    projs = m.b.map(a => ({ x: a[0], y: a[1], kind: PKINDS[a[2]], ang: a[3] }));
    items = m.it.map(a => ({ id: a[0], kind: IKINDS[a[1]], x: a[2], y: a[3] }));
    for (const ev of m.fx) runFx(ev);
    // Lobbyn uppdateras direkt, även om fönstret inte ritar just nu
    syncOverlay();
    if (state === 'lobby') renderLobby();
  }

  // ---------- Input ----------
  const keys = new Set();
  const mouse = { x: 0, y: 0, l: false, r: false };
  window.addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT') return;
    keys.add(e.code);
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
    if (e.code === 'KeyM') { muted = !muted; store('grotta-muted', muted ? 1 : 0); }
    if (mode === 'solo' && (e.code === 'KeyP' || e.code === 'Escape') && (state === 'playing' || state === 'paused')) {
      state = state === 'playing' ? 'paused' : 'playing';
      return;
    }
    if (state === 'paused' && e.code === 'KeyQ') return toMenu();
    if (e.code === 'Enter') {
      if (state === 'lobby' && mode !== 'client') startRun();
      else if ((state === 'gameover' || state === 'victory') && mode !== 'client' && performance.now() - endAt > 1000) {
        if (mode === 'solo') startRun(); else state = 'lobby';
      } else if (state === 'error') toMenu();
    }
    if (e.code === 'Escape' && ['lobby', 'gameover', 'victory', 'connecting', 'error'].includes(state)) toMenu();
  });
  window.addEventListener('keyup', e => keys.delete(e.code));
  window.addEventListener('blur', () => {
    keys.clear();
    mouse.l = mouse.r = false;
    if (state === 'playing' && mode === 'solo') state = 'paused';
  });
  canvas.addEventListener('mousemove', e => { mouse.x = e.clientX; mouse.y = e.clientY; });
  canvas.addEventListener('mousedown', e => {
    mouse.x = e.clientX; mouse.y = e.clientY;
    if (e.button === 0) mouse.l = true;
    if (e.button === 2) mouse.r = true;
  });
  window.addEventListener('mouseup', e => {
    if (e.button === 0) mouse.l = false;
    if (e.button === 2) mouse.r = false;
  });
  canvas.addEventListener('contextmenu', e => e.preventDefault());

  function localInput() {
    return {
      u: keys.has('KeyW') || keys.has('ArrowUp'),
      d: keys.has('KeyS') || keys.has('ArrowDown'),
      l: keys.has('KeyA') || keys.has('ArrowLeft'),
      r: keys.has('KeyD') || keys.has('ArrowRight'),
      f: mouse.l,
      s: mouse.r || keys.has('Space'),
      e: keys.has('KeyE'),
      // Kameran är centrerad på den egna spelaren, så siktet är riktningen från mitten till musen
      a: r2(Math.atan2(mouse.y - CH / 2, mouse.x - CW / 2)),
    };
  }

  // ---------- Spelare ----------
  function makePlayer(id, name, cls) {
    const p = { id, name, cls, x: 0, y: 0, r: 12, aim: 0, input: {}, kills: 0 };
    setClass(p, cls);
    return p;
  }
  function setClass(p, cls) {
    const c = CLASSES[cls];
    Object.assign(p, { cls, hp: c.hp, maxHp: c.hp, dmg: 1, cd: 0, acd: 0, pcd: 0, potions: 1, down: false, revive: 0, invuln: 0 });
  }

  // ---------- Spelets gång (körs hos värden eller ensamspelaren) ----------
  function startRun() {
    team = { gold: 0, xp: 0, need: 60, lvl: 1 };
    floor = 0;
    runTime = 0;
    players.forEach(p => { setClass(p, p.cls); p.kills = 0; });
    state = 'playing';
    enterFloor();
  }

  function enterFloor() {
    floor++;
    seed = 1 + Math.floor(Math.random() * 2e9);
    dungeon = makeDungeon(seed, floor);
    onNewMap();
    enemies = []; projs = []; items = [];
    particles = []; effects = [];
    bossAwake = false;
    const s = dungeon.start;
    players.forEach((p, i) => {
      p.x = (s.cx + 0.5) * TILE + (i - (players.length - 1) / 2) * 26;
      p.y = (s.cy + 0.5) * TILE;
      if (p.down) { p.down = false; p.hp = p.maxHp * 0.3; }
      p.invuln = 2;
    });
    for (const r of dungeon.rooms) {
      if (r === s) continue;
      if (dungeon.boss && r === dungeon.end) spawnBoss(r);
      else spawnRoom(r);
    }
    // 1–2 skattkistor per våning
    const chestRooms = dungeon.rooms.filter(r => r !== s && r !== dungeon.end);
    for (let i = 0; i < Math.min(chestRooms.length, randInt(1, 2)); i++) {
      const r = chestRooms.splice(randInt(0, chestRooms.length - 1), 1)[0];
      spawnItem('chest', (r.x + 1.5) * TILE, (r.y + 1.5) * TILE);
    }
    const e = dungeon.end;
    stairs = { x: (e.cx + 0.5) * TILE, y: (e.cy + 0.5) * TILE, open: !dungeon.boss };
    descend = { n: 0, total: 0, t: 0 };
    fx({ k: 'sfx', n: 'stairs' });
    float(players[0].x, players[0].y - 60, `VÅNING ${floor}`, '#ffcf3f', 34, 2.5);
    if (dungeon.boss) float(players[0].x, players[0].y - 30, 'Här bor en boss…', '#ff5ea8', 18, 2.5);
  }

  function randomSpot(r) {
    return [(r.x + 1 + Math.random() * (r.w - 2)) * TILE, (r.y + 1 + Math.random() * (r.h - 2)) * TILE];
  }

  function pickEnemyType() {
    const options = [['slime', 3], ['bat', 2]];
    if (floor >= 2) options.push(['skeleton', 2]);
    if (floor >= 3) options.push(['orc', 1 + floor * 0.15]);
    let roll = Math.random() * options.reduce((s, o) => s + o[1], 0);
    for (const [t, w] of options) { roll -= w; if (roll <= 0) return t; }
    return 'slime';
  }

  function spawnRoom(r) {
    const n = randInt(2, 3) + Math.floor(floor / 2) + (players.length - 1);
    for (let i = 0; i < n; i++) spawnEnemy(pickEnemyType(), ...randomSpot(r));
  }

  function spawnEnemy(type, x, y) {
    const d = ENEMY[type];
    const scale = 1 + 0.25 * (floor - 1);
    const party = 1 + 0.35 * (players.length - 1);
    const hp = d.hp * scale * party;
    const e = { id: nextId++, type, x, y, r: d.r, hp, maxHp: hp, dmg: d.dmg * (1 + 0.15 * (floor - 1)), spd: d.spd,
      xp: d.xp, cd: rand(0.5, 2), hitcd: 0, aggro: false, wander: rand(0, 6.28), wt: 0, flash: 0, t: rand(0, 6) };
    enemies.push(e);
    return e;
  }

  function spawnBoss(r) {
    const b = spawnEnemy('boss', (r.cx + 0.5) * TILE, (r.cy + 0.5) * TILE);
    const tier = floor / 3;
    b.hp = b.maxHp = 900 * (1 + 0.5 * (tier - 1)) * (1 + 0.5 * (players.length - 1));
    b.dmg = 22 * (1 + 0.3 * (tier - 1));
    b.xp = 160 * tier;
    b.phase = 0;
    b.pt = 2;
    b.boss = BOSSES[floor];
  }

  function spawnItem(kind, x, y, amt = 0) {
    let ix = x + rand(-14, 14), iy = y + rand(-14, 14);
    if (wallAt(ix, iy)) { ix = x; iy = y; }
    items.push({ id: nextId++, kind, x: ix, y: iy, amt });
  }

  const nearestPlayer = e => {
    let best = null, bd = Infinity;
    for (const p of players) {
      if (p.down) continue;
      const d = dist(e, p);
      if (d < bd) { bd = d; best = p; }
    }
    return best;
  };

  function shoot(p, kind, a, spd, dmg, opt = {}) {
    projs.push({ x: p.x + Math.cos(a) * 16, y: p.y + Math.sin(a) * 16, vx: Math.cos(a) * spd, vy: Math.sin(a) * spd,
      kind, dmg, from: 'p', owner: p.id, life: opt.life || 1.1, pierce: !!opt.pierce, hit: opt.pierce ? new Set() : null,
      explode: opt.explode || 0, xdmg: opt.xdmg || 0, r: kind === 'fire' ? 10 : 5 });
  }
  function enemyShoot(e, kind, a, spd, dmg) {
    projs.push({ x: e.x + Math.cos(a) * e.r, y: e.y + Math.sin(a) * e.r, vx: Math.cos(a) * spd, vy: Math.sin(a) * spd,
      kind, dmg, from: 'e', life: 3, r: kind === 'rock' ? 8 : 6 });
  }

  function attack(p) {
    const c = CLASSES[p.cls];
    p.cd = c.cd;
    const a = p.aim;
    if (p.cls === 'warrior') {
      fx({ k: 'swing', x: p.x | 0, y: p.y | 0, a, r: 56, c: c.color });
      fx({ k: 'sfx', n: 'swing', who: p.id });
      for (const e of enemies) {
        if (dist(e, p) < 56 + e.r && Math.abs(angDiff(Math.atan2(e.y - p.y, e.x - p.x), a)) < 1.1) {
          hurtEnemy(e, 24 * p.dmg, p, a, 150);
        }
      }
    } else if (p.cls === 'ranger') {
      shoot(p, 'arrow', a, 580, 15 * p.dmg);
      fx({ k: 'sfx', n: 'shoot', who: p.id });
    } else if (p.cls === 'mage') {
      shoot(p, 'bolt', a, 430, 14 * p.dmg, { life: 1.2 });
      fx({ k: 'sfx', n: 'magic', who: p.id });
    } else {
      shoot(p, 'light', a, 470, 11 * p.dmg);
      fx({ k: 'sfx', n: 'shoot', who: p.id });
    }
  }

  function ability(p) {
    const c = CLASSES[p.cls];
    p.acd = c.acd;
    const a = p.aim;
    if (p.cls === 'warrior') {
      fx({ k: 'ring', x: p.x | 0, y: p.y | 0, r: 85, c: c.color });
      fx({ k: 'sfx', n: 'boom' });
      for (const e of enemies) {
        if (dist(e, p) < 85 + e.r) hurtEnemy(e, 45 * p.dmg, p, Math.atan2(e.y - p.y, e.x - p.x), 300);
      }
    } else if (p.cls === 'ranger') {
      for (let i = -3; i <= 3; i++) shoot(p, 'arrow', a + i * 0.11, 620, 14 * p.dmg, { pierce: true, life: 1 });
      fx({ k: 'sfx', n: 'shoot' });
    } else if (p.cls === 'mage') {
      shoot(p, 'fire', a, 330, 0, { life: 1.3, explode: 95, xdmg: 60 * p.dmg });
      fx({ k: 'sfx', n: 'magic' });
    } else {
      fx({ k: 'ring', x: p.x | 0, y: p.y | 0, r: 170, c: '#7cff6b' });
      fx({ k: 'sfx', n: 'heal' });
      for (const q of players) {
        if (dist(q, p) > 170) continue;
        if (q.down) revive(q);
        else heal(q, q.maxHp * 0.35);
      }
    }
  }

  function hurtEnemy(e, dmg, p, ang, kb) {
    if (e.hp <= 0) return;
    e.hp -= dmg;
    e.flash = 0.1;
    e.aggro = true;
    if (p) e.lastHit = p.id;
    const push = e.type === 'boss' ? 0.02 : 0.08;
    moveCircle(e, Math.cos(ang) * kb * push, Math.sin(ang) * kb * push);
    float(e.x + rand(-6, 6), e.y - e.r - 6, String(Math.round(dmg)), '#ffffff', 12, 0.6);
    fx({ k: 'sfx', n: 'hit' });
  }

  function explodeAt(b) {
    explode(b.x, b.y, '#ff8a3f', 40, 260);
    fx({ k: 'ring', x: b.x | 0, y: b.y | 0, r: b.explode, c: '#ff8a3f' });
    fx({ k: 'sfx', n: 'boom' });
    fx({ k: 'shake', a: 8 });
    const owner = players.find(p => p.id === b.owner);
    for (const e of enemies) {
      if (dist(e, b) < b.explode + e.r) hurtEnemy(e, b.xdmg, owner, Math.atan2(e.y - b.y, e.x - b.x), 220);
    }
  }

  function damagePlayer(p, dmg) {
    if (p.down || p.invuln > 0) return;
    p.hp -= dmg;
    p.invuln = 0.45;
    fx({ k: 'sfx', n: 'hurt', who: p.id });
    fx({ k: 'shake', a: 9, who: p.id });
    float(p.x, p.y - 22, '-' + Math.round(dmg), '#ff5d73', 14, 0.8);
    if (p.hp <= 0) {
      p.hp = 0;
      p.down = true;
      p.revive = 0;
      fx({ k: 'sfx', n: 'down' });
      if (players.length > 1) float(p.x, p.y - 40, `${p.name} är nere!`, '#ff5d73', 18, 2);
      if (!players.some(q => !q.down)) gameOver();
    }
  }

  function heal(p, amt) {
    const before = p.hp;
    p.hp = Math.min(p.maxHp, p.hp + amt);
    if (p.hp > before) float(p.x, p.y - 24, '+' + Math.round(p.hp - before), '#7cff6b', 15, 1);
  }

  function revive(p) {
    p.down = false;
    p.hp = Math.max(p.hp, p.maxHp * 0.4);
    p.invuln = 1.5;
    p.revive = 0;
    fx({ k: 'sfx', n: 'revive' });
    float(p.x, p.y - 36, 'ÅTERUPPLIVAD!', '#7cff6b', 18, 1.6);
  }

  function addXp(n) {
    team.xp += n;
    while (team.xp >= team.need) {
      team.xp -= team.need;
      team.lvl++;
      team.need = 40 + team.lvl * 35;
      for (const p of players) {
        p.maxHp *= 1.1;
        p.dmg *= 1.07;
        if (!p.down) p.hp = Math.min(p.maxHp, p.hp + p.maxHp * 0.3);
        float(p.x, p.y - 44, `NIVÅ ${team.lvl}!`, '#ffcf3f', 20, 1.8);
      }
      fx({ k: 'sfx', n: 'level' });
    }
  }

  function killEnemy(e) {
    e.dead = true;
    const color = e.type === 'boss' ? e.boss.color : ENEMY[e.type].color;
    explode(e.x, e.y, color, e.type === 'boss' ? 120 : 18, e.type === 'boss' ? 380 : 170);
    fx({ k: 'sfx', n: e.type === 'boss' ? 'boom' : 'kill' });
    const killer = players.find(p => p.id === e.lastHit);
    if (killer) killer.kills++;
    addXp(e.xp);
    if (e.type === 'boss') {
      fx({ k: 'shake', a: 22 });
      for (let i = 0; i < 12; i++) spawnItem('gold', e.x + rand(-40, 40), e.y + rand(-40, 40), randInt(3, 6) * floor);
      spawnItem('potion', e.x - 20, e.y);
      spawnItem('potion', e.x + 20, e.y);
      spawnItem('upgrade', e.x, e.y + 24);
      float(e.x, e.y - 60, `${e.boss.name} är besegrad!`, '#ffcf3f', 26, 3);
      if (floor >= LAST_FLOOR) return victory();
      stairs.open = true;
      float(e.x, e.y - 30, 'Trappan ner har öppnats!', '#7cff6b', 18, 3);
      return;
    }
    if (Math.random() < 0.55) spawnItem('gold', e.x, e.y, randInt(1, 3) * floor);
    if (Math.random() < 0.07) spawnItem('heart', e.x, e.y);
    if (Math.random() < 0.04) spawnItem('potion', e.x, e.y);
  }

  function updateEnemy(e, dt) {
    e.flash = Math.max(0, e.flash - dt);
    e.cd -= dt;
    e.hitcd -= dt;
    e.t += dt;
    const target = nearestPlayer(e);
    let ang = null, spd = e.spd;
    if (!target) return;
    const d = dist(e, target);
    const sees = d < 450 && los(e.x, e.y, target.x, target.y);
    if (!e.aggro && sees && d < 330) e.aggro = true;
    if (e.aggro && d > 900) e.aggro = false;

    if (!e.aggro) {
      e.wt -= dt;
      if (e.wt <= 0) { e.wander = rand(0, Math.PI * 2); e.wt = rand(1, 3); }
      ang = e.wander;
      spd *= 0.3;
    } else {
      const direct = Math.atan2(target.y - e.y, target.x - e.x);
      const path = () => (sees ? direct : (flowDir(e) ?? direct));
      if (e.type === 'skeleton') {
        // Bågskyttar håller avstånd och skjuter
        if (d < 150) ang = direct + Math.PI;
        else if (d > 270 || !sees) ang = path();
        else { ang = direct + (Math.sin(e.t * 0.8) > 0 ? 1 : -1) * Math.PI / 2; spd *= 0.6; }
        if (sees && e.cd <= 0 && d < 430) { e.cd = rand(1.4, 2.2); enemyShoot(e, 'bone', direct, 270, e.dmg); }
      } else if (e.type === 'bat') {
        ang = direct + Math.sin(e.t * 6) * 0.9;
      } else if (e.type === 'boss') {
        if (!bossAwake) {
          bossAwake = true;
          fx({ k: 'sfx', n: 'boss' });
          fx({ k: 'shake', a: 16 });
          float(e.x, e.y - 70, `${e.boss.name} vaknar!`, e.boss.color, 28, 2.5);
        }
        bossAI(e, direct, dt);
        ang = e.charging ? e.chargeAng : (d > 70 ? path() : null);
        if (e.charging) spd = 340;
        else if (e.hp < e.maxHp * 0.5) spd *= 1.25;
      } else {
        ang = sees && d < 260 ? direct : (flowDir(e) ?? direct);
      }
    }
    if (ang !== null) moveCircle(e, Math.cos(ang) * spd * dt, Math.sin(ang) * spd * dt);
    for (const p of players) {
      if (!p.down && e.hitcd <= 0 && dist(e, p) < e.r + p.r + 2) {
        damagePlayer(p, e.dmg);
        e.hitcd = e.type === 'boss' ? 0.6 : 0.9;
      }
    }
  }

  // Bossen växlar mellan tre attacker: ring, riktad solfjäder och en specialattack
  function bossAI(e, direct, dt) {
    e.pt -= dt;
    if (e.charging) {
      e.ct -= dt;
      if (e.ct <= 0) e.charging = false;
      return;
    }
    if (e.pt > 0) return;
    const kind = e.boss.shot;
    const angry = e.hp < e.maxHp * 0.5;
    e.phase = (e.phase + 1) % 3;
    e.pt = angry ? 1.7 : 2.5;
    if (e.phase === 0) {
      const n = 14 + floor;
      for (let i = 0; i < n; i++) enemyShoot(e, kind, e.t + i / n * Math.PI * 2, 190, e.dmg * 0.7);
    } else if (e.phase === 1) {
      const spread = angry ? 3 : 2;
      for (let i = -spread; i <= spread; i++) enemyShoot(e, kind, direct + i * 0.17, 300, e.dmg * 0.7);
    } else if (floor === 3) {
      // Grottjätten rusar mot närmaste spelare
      e.charging = true;
      e.ct = 0.75;
      e.chargeAng = direct;
      fx({ k: 'sfx', n: 'boss' });
    } else if (floor === 6) {
      // Skelettkungen kallar på skelett
      if (enemies.length < 40) {
        for (let i = 0; i < 3; i++) {
          const a = i / 3 * Math.PI * 2;
          const s = spawnEnemy('skeleton', e.x + Math.cos(a) * 60, e.y + Math.sin(a) * 60);
          if (blocked(s.x, s.y, s.r)) { s.x = e.x; s.y = e.y; }
          s.aggro = true;
        }
        fx({ k: 'ring', x: e.x | 0, y: e.y | 0, r: 70, c: '#e8ecff' });
      }
    } else {
      // Draken sprutar eld
      for (let i = 0; i < 14; i++) enemyShoot(e, 'flame', direct + rand(-0.5, 0.5), rand(240, 380), e.dmg * 0.6);
      fx({ k: 'sfx', n: 'boom' });
    }
  }

  function updateProjectiles(dt) {
    for (const b of projs) {
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.life -= dt;
      if (wallAt(b.x, b.y) || b.life <= 0) {
        if (b.explode) explodeAt(b);
        b.dead = true;
        continue;
      }
      if (b.from === 'p') {
        const owner = players.find(p => p.id === b.owner);
        for (const e of enemies) {
          if (e.hp <= 0 || dist(e, b) > e.r + b.r) continue;
          if (b.pierce) {
            if (b.hit.has(e.id)) continue;
            b.hit.add(e.id);
            hurtEnemy(e, b.dmg, owner, Math.atan2(b.vy, b.vx), 60);
          } else {
            if (b.explode) explodeAt(b);
            else hurtEnemy(e, b.dmg, owner, Math.atan2(b.vy, b.vx), 60);
            b.dead = true;
            break;
          }
        }
      } else {
        for (const p of players) {
          if (!p.down && dist(p, b) < p.r + b.r) { damagePlayer(p, b.dmg); b.dead = true; break; }
        }
      }
    }
    projs = projs.filter(b => !b.dead);
  }

  function pickupItems() {
    for (const it of items) {
      for (const p of players) {
        if (p.down || dist(p, it) > p.r + 14) continue;
        if (it.kind === 'gold') {
          team.gold += it.amt;
          fx({ k: 'sfx', n: 'coin', who: p.id });
          float(it.x, it.y - 10, `+${it.amt} 🪙`, '#ffcf3f', 13, 0.8);
        } else if (it.kind === 'potion') {
          if (p.potions >= 3) continue;
          p.potions++;
          fx({ k: 'sfx', n: 'pickup', who: p.id });
          float(it.x, it.y - 10, '+1 dryck', '#ff5d73', 14);
        } else if (it.kind === 'heart') {
          if (p.hp >= p.maxHp) continue;
          heal(p, 30);
          fx({ k: 'sfx', n: 'pickup', who: p.id });
        } else if (it.kind === 'chest') {
          fx({ k: 'sfx', n: 'chest' });
          explode(it.x, it.y, '#ffcf3f', 24, 160);
          float(it.x, it.y - 20, 'Skattkista!', '#ffcf3f', 18, 1.5);
          for (let i = 0; i < randInt(4, 7); i++) spawnItem('gold', it.x + rand(-30, 30), it.y + rand(-30, 30), randInt(2, 4) * floor);
          if (Math.random() < 0.45) spawnItem('upgrade', it.x + 20, it.y);
          if (Math.random() < 0.4) spawnItem('potion', it.x - 20, it.y);
        } else if (it.kind === 'upgrade') {
          p.dmg *= 1.12;
          fx({ k: 'sfx', n: 'level', who: p.id });
          float(it.x, it.y - 20, 'Starkare vapen! ⚔️', CLASSES[p.cls].color, 17, 1.6);
        }
        it.dead = true;
        break;
      }
    }
    items = items.filter(i => !i.dead);
  }

  function gameOver() {
    state = 'gameover';
    endAt = performance.now();
    fx({ k: 'sfx', n: 'down' });
  }
  function victory() {
    state = 'victory';
    endAt = performance.now();
    fx({ k: 'sfx', n: 'level' });
  }

  function simulate(dt) {
    runTime += dt;
    for (const p of players) {
      p.invuln = Math.max(0, p.invuln - dt);
      p.cd -= dt;
      p.acd = Math.max(0, p.acd - dt);
      p.pcd -= dt;
      if (p.down) continue;
      const k = p.id === myId ? localInput() : p.input;
      const dx = (k.r ? 1 : 0) - (k.l ? 1 : 0), dy = (k.d ? 1 : 0) - (k.u ? 1 : 0);
      const len = Math.hypot(dx, dy) || 1;
      const spd = CLASSES[p.cls].spd;
      moveCircle(p, dx / len * spd * dt, dy / len * spd * dt);
      if (typeof k.a === 'number' && Number.isFinite(k.a)) p.aim = k.a;
      if (k.f && p.cd <= 0) attack(p);
      if (k.s && p.acd <= 0) ability(p);
      if (k.e && p.pcd <= 0 && p.potions > 0 && p.hp < p.maxHp) {
        p.potions--;
        p.pcd = 1;
        heal(p, p.maxHp * 0.5);
        fx({ k: 'sfx', n: 'heal', who: p.id });
      }
    }
    // Lagkamrater återupplivar den som är nere genom att stå bredvid
    for (const p of players) {
      if (!p.down) continue;
      const helpers = players.filter(q => !q.down && dist(q, p) < 48).length;
      if (helpers) {
        p.revive += dt * helpers;
        if (p.revive >= 2.5) revive(p);
      } else p.revive = Math.max(0, p.revive - dt * 0.5);
    }

    flowTimer -= dt;
    if (flowTimer <= 0) { computeFlow(); flowTimer = 0.3; }
    for (const e of enemies) updateEnemy(e, dt);
    updateProjectiles(dt);
    for (const e of enemies) if (e.hp <= 0 && !e.dead) killEnemy(e);
    enemies = enemies.filter(e => !e.dead);
    if (state !== 'playing') return;
    pickupItems();

    // Alla som står upp måste vara vid trappan för att gå ner
    if (stairs && stairs.open) {
      const up = players.filter(p => !p.down);
      descend.n = up.filter(p => dist(p, stairs) < 56).length;
      descend.total = up.length;
      if (descend.n > 0 && descend.n === descend.total) {
        descend.t += dt;
        if (descend.t >= 1.2) enterFloor();
      } else descend.t = 0;
    }
  }

  // ---------- Uppdatering ----------
  let lastState = '';
  function update(dt) {
    if (state === 'playing' && mode !== 'client') simulate(dt);

    if (mode === 'client' && state === 'playing' && myId >= 0) {
      const k = localInput();
      const s = JSON.stringify(k);
      const now = performance.now();
      if (s !== lastSent && now - lastSendAt > 30) { lastSent = s; lastSendAt = now; send({ t: 'input', k }); }
    }

    // Utforskade rutor till minikartan
    exploreTimer -= dt;
    if (dungeon && explored && exploreTimer <= 0 && state === 'playing') {
      exploreTimer = 0.15;
      for (const p of players) {
        const tx = Math.floor(p.x / TILE), ty = Math.floor(p.y / TILE);
        for (let y = ty - 8; y <= ty + 8; y++) {
          for (let x = tx - 9; x <= tx + 9; x++) {
            if (x >= 0 && y >= 0 && x < MW && y < MH && (x - tx) ** 2 + (y - ty) ** 2 < 80) explored[y * MW + x] = 1;
          }
        }
      }
    }

    for (const p of particles) { p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 0.94; p.vy *= 0.94; p.life -= dt; }
    particles = particles.filter(p => p.life > 0);
    for (const f of floaters) { f.y -= 30 * dt; f.life -= dt; }
    floaters = floaters.filter(f => f.life > 0);
    for (const f of effects) f.life -= dt;
    effects = effects.filter(f => f.life > 0);
    shake = Math.max(0, shake - dt * 40);

    if (mode === 'host' && ['lobby', 'playing', 'gameover', 'victory'].includes(state)) {
      send(snapshot());
      netFx = [];
    }
    if (state !== lastState) {
      if (state === 'gameover' || state === 'victory') endAt = performance.now();
      lastState = state;
    }
    syncOverlay();
    if (state === 'lobby') renderLobby();
  }

  // ---------- Ritning ----------
  function glow(color, blur) { ctx.shadowColor = color; ctx.shadowBlur = blur; }
  function text(str, x, y, size, color = '#ece8ff', align = 'center', blur = 0, weight = 700) {
    ctx.save();
    ctx.font = `${weight} ${size}px "Segoe UI", system-ui, sans-serif`;
    ctx.textAlign = align;
    ctx.textBaseline = 'middle';
    if (blur) glow(color, blur);
    ctx.fillStyle = color;
    ctx.fillText(str, x, y);
    ctx.restore();
  }
  function bar(x, y, w, h, frac, color, bg = '#0008') {
    ctx.fillStyle = bg;
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = color;
    ctx.fillRect(x, y, w * clamp(frac, 0, 1), h);
  }

  function drawPlayer(p) {
    const c = CLASSES[p.cls];
    ctx.save();
    ctx.translate(p.x, p.y);
    if (p.down) {
      ctx.globalAlpha = 0.7;
      ctx.fillStyle = '#3a3560';
      ctx.beginPath(); ctx.ellipse(0, 4, 14, 9, 0, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#7cff6b';
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(0, 0, 20, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (p.revive / 2.5)); ctx.stroke();
      ctx.restore();
      text('💀', p.x, p.y - 2, 16);
      text(p.name, p.x, p.y + 26, 11, '#9a93cc');
      return;
    }
    if (p.invuln > 0 && Math.floor(performance.now() / 80) % 2) ctx.globalAlpha = 0.45;
    // Vapen åt det håll man siktar
    ctx.save();
    ctx.rotate(p.aim);
    ctx.lineCap = 'round';
    if (p.cls === 'warrior') {
      ctx.strokeStyle = '#dfe6ff'; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.moveTo(10, 0); ctx.lineTo(28, 0); ctx.stroke();
      ctx.strokeStyle = '#8a6a2a'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(9, -5); ctx.lineTo(9, 5); ctx.stroke();
    } else if (p.cls === 'ranger') {
      ctx.strokeStyle = '#c08a4a'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(8, 0, 13, -1.1, 1.1); ctx.stroke();
      ctx.strokeStyle = '#ffffff88'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(8 + Math.cos(-1.1) * 13, Math.sin(-1.1) * 13); ctx.lineTo(8 + Math.cos(1.1) * 13, Math.sin(1.1) * 13); ctx.stroke();
    } else {
      ctx.strokeStyle = '#8a6a2a'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(6, 6); ctx.lineTo(26, 6); ctx.stroke();
      glow(c.color, 12);
      ctx.fillStyle = c.color;
      ctx.beginPath(); ctx.arc(27, 6, 4.5, 0, Math.PI * 2); ctx.fill();
      ctx.shadowBlur = 0;
    }
    ctx.restore();
    // Kropp
    glow(c.color, 14);
    ctx.fillStyle = '#141029';
    ctx.strokeStyle = c.color;
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(0, 0, p.r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.shadowBlur = 0;
    // Ögon tittar åt siktet
    ctx.fillStyle = '#fff';
    const ex = Math.cos(p.aim) * 4, ey = Math.sin(p.aim) * 4;
    ctx.beginPath(); ctx.arc(ex - Math.sin(p.aim) * 3.5, ey + Math.cos(p.aim) * 3.5, 2.2, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(ex + Math.sin(p.aim) * 3.5, ey - Math.cos(p.aim) * 3.5, 2.2, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    bar(p.x - 16, p.y - 24, 32, 4, p.hp / p.maxHp, p.hp / p.maxHp > 0.35 ? '#7cff6b' : '#ff5d73');
    if (players.length > 1) text(p.name, p.x, p.y + 24, 11, c.color);
  }

  function drawEnemy(e) {
    const t = performance.now() / 1000 + e.id;
    const flash = e.flash > 0;
    ctx.save();
    ctx.translate(e.x, e.y);
    if (e.type === 'slime') {
      const sq = 1 + Math.sin(t * 5) * 0.12;
      ctx.fillStyle = flash ? '#fff' : '#3fbf4a';
      glow('#7cff6b', 10);
      ctx.beginPath(); ctx.ellipse(0, 2, e.r * sq, e.r / sq, 0, 0, Math.PI * 2); ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#0a2a0f';
      ctx.fillRect(-5, -2, 3, 3); ctx.fillRect(3, -2, 3, 3);
    } else if (e.type === 'bat') {
      const w = Math.sin(t * 18) * 6;
      ctx.strokeStyle = flash ? '#fff' : '#c77dff';
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(-4, 0); ctx.lineTo(-15, -4 + w); ctx.moveTo(4, 0); ctx.lineTo(15, -4 + w); ctx.stroke();
      ctx.fillStyle = flash ? '#fff' : '#6b3fa0';
      ctx.beginPath(); ctx.arc(0, 0, e.r * 0.7, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#ff5d73';
      ctx.fillRect(-3, -2, 2, 2); ctx.fillRect(1, -2, 2, 2);
    } else if (e.type === 'skeleton') {
      ctx.fillStyle = flash ? '#fff' : '#d9dcef';
      ctx.beginPath(); ctx.arc(0, 0, e.r, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#1b1840';
      ctx.beginPath(); ctx.arc(-4, -2, 3, 0, Math.PI * 2); ctx.arc(4, -2, 3, 0, Math.PI * 2); ctx.fill();
      ctx.fillRect(-4, 5, 8, 2);
    } else if (e.type === 'orc') {
      ctx.fillStyle = flash ? '#fff' : '#b0582f';
      glow('#ff8a5e', 8);
      ctx.beginPath(); ctx.arc(0, 0, e.r, 0, Math.PI * 2); ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#fff3d6';
      ctx.beginPath(); ctx.moveTo(-7, 4); ctx.lineTo(-5, -2); ctx.lineTo(-3, 4); ctx.fill();
      ctx.beginPath(); ctx.moveTo(7, 4); ctx.lineTo(5, -2); ctx.lineTo(3, 4); ctx.fill();
      ctx.fillStyle = '#ffdd33';
      ctx.fillRect(-6, -5, 3, 3); ctx.fillRect(3, -5, 3, 3);
    } else if (e.type === 'boss') {
      const b = BOSSES[floor] || BOSSES[3];
      ctx.rotate(Math.sin(t) * 0.1);
      glow(b.color, 26);
      ctx.fillStyle = flash ? '#fff' : '#1d1238';
      ctx.strokeStyle = b.color;
      ctx.lineWidth = 4;
      ctx.beginPath();
      for (let i = 0; i < 16; i++) {
        const a = i / 16 * Math.PI * 2;
        const rr = i % 2 ? e.r * 0.78 : e.r;
        i ? ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr) : ctx.moveTo(Math.cos(a) * rr, Math.sin(a) * rr);
      }
      ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.fillStyle = b.color;
      ctx.beginPath(); ctx.arc(-10, -6, 5, 0, Math.PI * 2); ctx.arc(10, -6, 5, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#000';
      ctx.fillRect(-12, 8, 24, 4);
    }
    ctx.restore();
    if (e.type !== 'boss' && e.hp < e.maxHp) bar(e.x - 14, e.y - e.r - 9, 28, 3, e.hp / e.maxHp, '#ff5d73');
  }

  function drawProj(b) {
    const a = b.ang ?? Math.atan2(b.vy, b.vx);
    ctx.save();
    ctx.translate(b.x, b.y);
    ctx.rotate(a);
    switch (b.kind) {
      case 'arrow':
        ctx.strokeStyle = '#e8d8b0'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(-10, 0); ctx.lineTo(6, 0); ctx.stroke();
        ctx.fillStyle = '#dfe6ff';
        ctx.beginPath(); ctx.moveTo(9, 0); ctx.lineTo(4, -3); ctx.lineTo(4, 3); ctx.fill();
        break;
      case 'bolt': glow('#5ef1ff', 14); ctx.fillStyle = '#bff8ff'; ctx.beginPath(); ctx.arc(0, 0, 5, 0, Math.PI * 2); ctx.fill(); break;
      case 'light': glow('#f15bb5', 14); ctx.fillStyle = '#ffd6ee'; ctx.fillRect(-7, -2, 14, 4); break;
      case 'fire': glow('#ff8a3f', 24); ctx.fillStyle = '#ffb347'; ctx.beginPath(); ctx.arc(0, 0, 10, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#fff3c4'; ctx.beginPath(); ctx.arc(2, 0, 4, 0, Math.PI * 2); ctx.fill(); break;
      case 'bone': ctx.fillStyle = '#f2efe4'; ctx.fillRect(-6, -2, 12, 4); ctx.beginPath(); ctx.arc(-6, 0, 3, 0, Math.PI * 2); ctx.arc(6, 0, 3, 0, Math.PI * 2); ctx.fill(); break;
      case 'rock': ctx.fillStyle = '#8a6a4a'; ctx.beginPath(); ctx.arc(0, 0, 8, 0, Math.PI * 2); ctx.fill(); break;
      case 'flame': glow('#ff5ea8', 16); ctx.fillStyle = '#ff7a59'; ctx.beginPath(); ctx.arc(0, 0, 6, 0, Math.PI * 2); ctx.fill(); break;
    }
    ctx.restore();
  }

  function drawItem(it) {
    const bob = Math.sin(performance.now() / 300 + it.id) * 2;
    if (it.kind === 'gold') {
      glow('#ffcf3f', 10);
      ctx.fillStyle = '#ffcf3f';
      ctx.beginPath(); ctx.arc(it.x, it.y + bob, 5, 0, Math.PI * 2); ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#fff6c0';
      ctx.fillRect(it.x - 1, it.y + bob - 3, 2, 2);
    } else if (it.kind === 'chest') {
      glow('#ffcf3f', 14);
      ctx.fillStyle = '#7a4a1e';
      ctx.fillRect(it.x - 12, it.y - 8, 24, 17);
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#ffcf3f';
      ctx.fillRect(it.x - 12, it.y - 2, 24, 3);
      ctx.fillRect(it.x - 2, it.y - 3, 4, 6);
    } else {
      const icon = { potion: '🧪', heart: '❤️', upgrade: '⚔️' }[it.kind];
      glow('#ffffff', 10);
      text(icon, it.x, it.y + bob, 18);
      ctx.shadowBlur = 0;
    }
  }

  function drawStairs() {
    if (!stairs || !stairs.open) return;
    const { x, y } = stairs;
    glow('#ffcf3f', 22);
    ctx.fillStyle = '#2a1f0a';
    ctx.fillRect(x - 20, y - 20, 40, 40);
    ctx.shadowBlur = 0;
    for (let i = 0; i < 4; i++) {
      ctx.fillStyle = i % 2 ? '#a07a2a' : '#d9a83a';
      ctx.fillRect(x - 20 + i * 4, y - 20 + i * 10, 40 - i * 8, 10);
    }
    text('⬇', x, y, 18, '#fff');
  }

  function drawEffects() {
    for (const f of effects) {
      const k = f.life / f.max;
      ctx.save();
      ctx.globalAlpha = k;
      glow(f.c, 16);
      ctx.strokeStyle = f.c;
      if (f.type === 'swing') {
        ctx.lineWidth = 6;
        ctx.beginPath(); ctx.arc(f.x, f.y, f.r, f.a - 1.1, f.a + 1.1); ctx.stroke();
      } else {
        ctx.lineWidth = 4;
        ctx.beginPath(); ctx.arc(f.x, f.y, f.r * (1.2 - k * 0.4), 0, Math.PI * 2); ctx.stroke();
      }
      ctx.restore();
    }
  }

  function drawDarkness(camX, camY, Z) {
    dctx.setTransform(1, 0, 0, 1, 0, 0);
    dctx.globalCompositeOperation = 'source-over';
    dctx.fillStyle = 'rgba(4, 3, 12, 0.93)';
    dctx.fillRect(0, 0, dark.width, dark.height);
    dctx.globalCompositeOperation = 'destination-out';
    const hole = (wx, wy, radius) => {
      const sx = (CW / 2 + (wx - camX) * Z) * DPR, sy = (CH / 2 + (wy - camY) * Z) * DPR, R = radius * Z * DPR;
      const g = dctx.createRadialGradient(sx, sy, R * 0.2, sx, sy, R);
      g.addColorStop(0, 'rgba(0,0,0,1)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      dctx.fillStyle = g;
      dctx.fillRect(sx - R, sy - R, R * 2, R * 2);
    };
    for (const p of players) hole(p.x, p.y, p.down ? LIGHT * 0.5 : LIGHT);
    for (const b of projs) if (b.kind === 'fire' || b.kind === 'flame' || b.kind === 'bolt') hole(b.x, b.y, 70);
    if (stairs && stairs.open) hole(stairs.x, stairs.y, 90);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(dark, 0, 0);
  }

  function drawMinimap(me) {
    const s = 2.5, w = MW * s, h = MH * s, x0 = CW - w - 14, y0 = 14;
    ctx.fillStyle = '#07060fcc';
    ctx.fillRect(x0 - 4, y0 - 4, w + 8, h + 8);
    ctx.strokeStyle = '#2f2860';
    ctx.strokeRect(x0 - 4, y0 - 4, w + 8, h + 8);
    ctx.fillStyle = '#3a3270';
    for (let y = 0; y < MH; y++) {
      for (let x = 0; x < MW; x++) {
        if (explored[y * MW + x] && !isWall(x, y)) ctx.fillRect(x0 + x * s, y0 + y * s, s, s);
      }
    }
    if (stairs && stairs.open && explored[Math.floor(stairs.y / TILE) * MW + Math.floor(stairs.x / TILE)]) {
      ctx.fillStyle = '#ffcf3f';
      ctx.fillRect(x0 + stairs.x / TILE * s - 3, y0 + stairs.y / TILE * s - 3, 6, 6);
    }
    for (const p of players) {
      ctx.fillStyle = p.down ? '#9a93cc' : CLASSES[p.cls].color;
      ctx.beginPath(); ctx.arc(x0 + p.x / TILE * s, y0 + p.y / TILE * s, p === me ? 3.5 : 2.5, 0, Math.PI * 2); ctx.fill();
    }
    return y0 + h + 12;
  }

  function drawHUD(me) {
    // Uppe till vänster: våning, guld och nivå
    text(`VÅNING ${floor}/${LAST_FLOOR}`, 16, 22, 18, '#ffcf3f', 'left', 8, 800);
    text(`🪙 ${team.gold}`, 16, 48, 16, '#ffe9a0', 'left');
    text(`Nivå ${team.lvl}`, 16, 72, 14, '#ece8ff', 'left');
    bar(80, 67, 110, 8, team.xp / team.need, '#ffcf3f');

    // Uppe till höger: minikarta och laget
    let y = drawMinimap(me);
    if (players.length > 1) {
      for (const p of players) {
        const c = CLASSES[p.cls];
        const x = CW - 174;
        text(`${c.icon} ${p.name}`, x, y + 6, 12, c.color, 'left');
        if (p.down) text('NERE', CW - 18, y + 6, 12, '#ff5d73', 'right');
        bar(x, y + 15, 160, 5, p.hp / p.maxHp, p.down ? '#ff5d73' : '#7cff6b');
        y += 30;
      }
    }

    // Bossens livsmätare
    const boss = enemies.find(e => e.type === 'boss');
    if (boss && bossAwake) {
      const b = BOSSES[floor] || BOSSES[3];
      const w = Math.min(460, CW - 420);
      text(b.name, CW / 2, 22, 16, b.color, 'center', 10, 800);
      bar(CW / 2 - w / 2, 34, w, 10, boss.hp / boss.maxHp, b.color, '#1d1238');
    }

    if (!me) return;
    const c = CLASSES[me.cls];
    // Nere till vänster: liv, drycker och specialattack
    const bx = 16, by = CH - 70;
    text(c.icon, bx + 18, by + 22, 30);
    text(`${Math.ceil(me.hp)} / ${Math.round(me.maxHp)}`, bx + 50, by + 6, 14, '#ece8ff', 'left');
    bar(bx + 50, by + 16, 220, 14, me.hp / me.maxHp, me.hp / me.maxHp > 0.35 ? '#3fd16b' : '#ff5d73', '#2a1530');
    text(`🧪 × ${me.potions}  (E)`, bx + 50, by + 46, 14, '#ffb3c0', 'left');
    const ready = me.acd <= 0;
    const ax = bx + 160, ay = by + 36;
    ctx.fillStyle = '#16132c';
    ctx.fillRect(ax, ay, 110, 22);
    ctx.fillStyle = ready ? c.color : '#3a3560';
    ctx.fillRect(ax, ay, 110 * (ready ? 1 : 1 - me.acd / c.acd), 22);
    text(ready ? '★ Special redo' : `★ ${Math.ceil(me.acd)} s`, ax + 55, ay + 11, 12, ready ? '#1b1840' : '#ece8ff');

    // Trappan
    if (stairs && stairs.open && !me.down) {
      const d = dist(me, stairs);
      if (d < 56) {
        const msg = descend.n === descend.total ? 'Går ner…' : `Alla måste stå vid trappan (${descend.n}/${descend.total})`;
        text(msg, CW / 2, CH - 120, 18, '#ffcf3f', 'center', 8);
      } else if (explored[Math.floor(stairs.y / TILE) * MW + Math.floor(stairs.x / TILE)]) {
        // Pil mot trappan
        const a = Math.atan2(stairs.y - me.y, stairs.x - me.x);
        const px = CW / 2 + Math.cos(a) * 70, py = CH / 2 + Math.sin(a) * 70;
        ctx.save();
        ctx.translate(px, py);
        ctx.rotate(a);
        ctx.globalAlpha = 0.6;
        ctx.fillStyle = '#ffcf3f';
        ctx.beginPath(); ctx.moveTo(10, 0); ctx.lineTo(-6, -7); ctx.lineTo(-6, 7); ctx.fill();
        ctx.restore();
      }
    }
    if (me.down && state === 'playing') {
      text('Du är nere!', CW / 2, CH / 2 - 70, 30, '#ff5d73', 'center', 12, 800);
      text(players.length > 1 ? 'Be en lagkamrat stå bredvid dig för att återuppliva dig' : '', CW / 2, CH / 2 - 38, 15, '#ece8ff');
    }
    if (muted) text('LJUD AV (M)', CW - 14, CH - 14, 11, '#9a93cc', 'right');
  }

  function drawEndScreen(win) {
    ctx.fillStyle = 'rgba(7, 6, 15, 0.82)';
    ctx.fillRect(0, 0, CW, CH);
    text(win ? 'SEGER!' : 'GAME OVER', CW / 2, CH / 2 - 150, 64, win ? '#ffcf3f' : '#ff5d73', 'center', 30, 900);
    text(win ? 'Ni besegrade Draken och tog er ut ur grottan!' : `Laget föll på våning ${floor}.`, CW / 2, CH / 2 - 95, 20);
    const mins = Math.floor(runTime / 60), secs = Math.floor(runTime % 60);
    text(`🪙 ${team.gold} guld   ·   Nivå ${team.lvl}   ·   ⏱ ${mins}:${String(secs).padStart(2, '0')}`, CW / 2, CH / 2 - 60, 18, '#ffe9a0');
    [...players].sort((a, b) => b.kills - a.kills).forEach((p, i) => {
      const c = CLASSES[p.cls];
      text(`${c.icon} ${p.name} – ${p.kills} besegrade monster`, CW / 2, CH / 2 - 10 + i * 30, 18, c.color);
    });
    if (mode === 'client') text('Väntar på värden…   ·   Esc – lämna', CW / 2, CH - 70, 16, '#9a93cc');
    else {
      if (Math.floor(performance.now() / 500) % 2) text(mode === 'solo' ? 'Tryck ENTER för att spela igen' : 'Tryck ENTER för att gå till lobbyn', CW / 2, CH - 100, 20, '#ffcf3f');
      text('Esc – till menyn', CW / 2, CH - 66, 14, '#9a93cc');
    }
  }

  function draw() {
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.fillStyle = '#07060f';
    ctx.fillRect(0, 0, CW, CH);
    if (!dungeon || !mapCanvas || !['playing', 'paused', 'gameover', 'victory'].includes(state)) return;

    const me = players.find(p => p.id === myId) || players[0];
    if (!me) return;
    const Z = Math.min(CW / VIEW_W, CH / VIEW_H);
    const camX = me.x, camY = me.y;
    const sx = shake ? rand(-shake, shake) * 0.4 : 0, sy = shake ? rand(-shake, shake) * 0.4 : 0;
    ctx.setTransform(DPR * Z, 0, 0, DPR * Z, DPR * (CW / 2 - camX * Z + sx), DPR * (CH / 2 - camY * Z + sy));
    ctx.drawImage(mapCanvas, 0, 0);
    drawStairs();
    for (const it of items) drawItem(it);
    ctx.shadowBlur = 0;
    for (const e of enemies) drawEnemy(e);
    for (const p of players) drawPlayer(p);
    for (const b of projs) drawProj(b);
    ctx.shadowBlur = 0;
    for (const p of particles) {
      ctx.globalAlpha = Math.max(0, p.life / p.max);
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
    }
    ctx.globalAlpha = 1;
    drawEffects();
    drawDarkness(camX, camY, Z);

    // Flytande texter ritas ovanpå mörkret
    ctx.setTransform(DPR * Z, 0, 0, DPR * Z, DPR * (CW / 2 - camX * Z), DPR * (CH / 2 - camY * Z));
    for (const f of floaters) {
      ctx.globalAlpha = clamp(f.life * 1.5, 0, 1);
      text(f.text, f.x, f.y, f.size, f.c, 'center', 6, 800);
    }
    ctx.globalAlpha = 1;

    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    drawHUD(me);
    if (state === 'paused') {
      ctx.fillStyle = 'rgba(7, 6, 15, 0.7)';
      ctx.fillRect(0, 0, CW, CH);
      text('PAUS', CW / 2, CH / 2 - 20, 56, '#ffcf3f', 'center', 20, 900);
      text('P – fortsätt   ·   Q – till menyn', CW / 2, CH / 2 + 30, 16, '#9a93cc');
    }
    if (state === 'gameover') drawEndScreen(false);
    if (state === 'victory') drawEndScreen(true);
  }

  // Testläge (bara i webbläsaren med ?debug i adressen): ger tillgång till spelets inre
  if (location.search.includes('debug')) {
    window.__grotta = {
      get state() { return state; }, get floor() { return floor; }, get players() { return players; },
      get enemies() { return enemies; }, get items() { return items; }, get stairs() { return stairs; },
      get team() { return team; }, get seed() { return seed; }, get myId() { return myId; },
      enterFloor, gameOver, victory,
      tp(x, y) { const p = players.find(q => q.id === myId); p.x = x; p.y = y; },
    };
  }

  // ---------- Spelloop ----------
  let last = performance.now();
  function loop(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    update(dt);
    draw();
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
})();
