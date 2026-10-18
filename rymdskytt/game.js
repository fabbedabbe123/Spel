// Neon Rymdskytt – arkadspel i canvas, ensam eller med upp till 3 kompisar.
// Multiplayer: värden kör hela spelet och skickar läget till kompisarna,
// kompisarna skickar bara sina knapptryck (se relay.js).
// Styrning: piltangenter/WASD = flyg, Mellanslag = skjut, P = paus (ensam), M = ljud

(() => {
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');

  // Spelplanen har en fast storlek så att alla datorer ser samma sak.
  const W = 1000, H = 750;
  const DEFAULT_PORT = 7777;
  let CW = 0, CH = 0, DPR = 1;
  function resize() {
    DPR = window.devicePixelRatio || 1;
    CW = window.innerWidth;
    CH = window.innerHeight;
    canvas.width = CW * DPR;
    canvas.height = CH * DPR;
  }
  window.addEventListener('resize', resize);
  resize();

  // ---------- Hjälpfunktioner ----------
  const rand = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const dist2 = (a, b) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
  const hit = (a, b) => dist2(a, b) < (a.r + b.r) ** 2;
  const r1 = v => Math.round(v * 10) / 10;
  const r2 = v => Math.round(v * 100) / 100;

  // Stenarnas form räknas fram från deras id, så den behöver inte skickas över nätet
  const shapeCache = new Map();
  function shapeFor(id) {
    if (!shapeCache.has(id)) {
      let s = (id * 7919) % 233280;
      const out = [];
      for (let i = 0; i < 9; i++) {
        s = (s * 9301 + 49297) % 233280;
        out.push(0.75 + (s / 233280) * 0.4);
      }
      shapeCache.set(id, out);
    }
    return shapeCache.get(id);
  }

  function load(key, fallback) {
    try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; }
  }
  function store(key, v) {
    try { localStorage.setItem(key, String(v)); } catch {}
  }

  // ---------- Ljud (genereras, inga filer behövs) ----------
  let audio = null;
  let muted = false;
  function beep(freq, dur, type = 'square', vol = 0.06, slide = 0) {
    if (muted) return;
    try {
      audio = audio || new (window.AudioContext || window.webkitAudioContext)();
      const o = audio.createOscillator();
      const g = audio.createGain();
      o.type = type;
      o.frequency.setValueAtTime(freq, audio.currentTime);
      if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), audio.currentTime + dur);
      g.gain.setValueAtTime(vol, audio.currentTime);
      g.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + dur);
      o.connect(g).connect(audio.destination);
      o.start();
      o.stop(audio.currentTime + dur);
    } catch {}
  }
  const sfx = {
    shoot: () => beep(880, 0.08, 'square', 0.03, -400),
    boom: () => beep(160, 0.35, 'sawtooth', 0.08, -120),
    hurt: () => beep(220, 0.4, 'triangle', 0.1, -180),
    power: () => { beep(523, 0.1, 'sine', 0.08); setTimeout(() => beep(784, 0.15, 'sine', 0.08), 90); },
    wave: () => { beep(392, 0.12, 'sine', 0.07); setTimeout(() => beep(587, 0.2, 'sine', 0.07), 120); },
  };

  // ---------- Speltillstånd ----------
  // state: menu | connecting | lobby | playing | paused | gameover | error
  let state = 'menu';
  let mode = null; // 'solo' | 'host' | 'client'
  let myId = 0;
  let ws = null;
  let lanInfo = null;
  let errorMsg = '';
  let players = [], bullets = [], enemyBullets = [], enemies = [], particles = [], powerups = [], floaters = [];
  let teamScore = 0, wave = 0, waveTimer = 0, spawnQueue = [], shake = 0, gameOverAt = 0, nextEnemyId = 1;
  let highscore = Number(load('neon-highscore', 0)) || 0;
  let netFx = [];
  let lastSentInput = '';

  const COLORS = ['#5ef1ff', '#7cff6b', '#ffe066', '#ff8a5e'];
  const TYPES = ['rock', 'drone', 'gunner', 'boss'];

  // ---------- Effekter (körs lokalt och skickas till kompisarna) ----------
  function fx(ev) {
    runFx(ev);
    if (mode === 'host') netFx.push(ev);
  }
  function runFx(ev) {
    const forMe = ev.who === undefined || ev.who === myId;
    if (ev.k === 'sfx' && forMe) sfx[ev.n]();
    else if (ev.k === 'boom') explodeLocal(ev.x, ev.y, ev.c, ev.n, ev.p);
    else if (ev.k === 'float') floaters.push({ x: ev.x, y: ev.y, text: ev.text, color: ev.c || '#ffe066', life: ev.life || 0.9 });
    else if (ev.k === 'shake' && forMe) shake = Math.max(shake, ev.a);
  }
  function explodeLocal(x, y, color, count = 18, power = 220) {
    for (let i = 0; i < count; i++) {
      const a = rand(0, Math.PI * 2), s = rand(40, power);
      particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: rand(0.4, 0.9), max: 0.9, color, size: rand(1.5, 3.5) });
    }
  }
  const explode = (x, y, c, n = 18, p = 220) => fx({ k: 'boom', x: x | 0, y: y | 0, c, n, p });

  // ---------- Meny (HTML-överlägget) ----------
  const menu = document.getElementById('menu');
  const nameInput = document.getElementById('name');
  const addrInput = document.getElementById('addr');
  nameInput.value = load('neon-name', '');
  addrInput.value = load('neon-addr', '');
  // Som webbsida används rumskoder i stället för IP-adresser (se net.js)
  const ONLINE = !!(window.GameNet && window.GameNet.online);
  if (ONLINE) {
    addrInput.placeholder = 'Rumskod, t.ex. KATT';
    addrInput.maxLength = 4;
    addrInput.style.textTransform = 'uppercase';
    addrInput.value = '';
  }

  function myName() {
    const n = nameInput.value.trim().slice(0, 12) || 'Pilot';
    store('neon-name', n);
    return n;
  }
  function hideMenu() {
    menu.classList.add('hidden');
    if (document.activeElement) document.activeElement.blur();
  }
  function showMenu() {
    menu.classList.remove('hidden');
    document.getElementById('record').textContent = highscore ? `Rekord: ${highscore}` : '';
  }

  document.getElementById('solo').onclick = () => {
    hideMenu();
    mode = 'solo';
    myId = 0;
    players = [makePlayer(0, myName())];
    startGame();
  };

  document.getElementById('host').onclick = async () => {
    hideMenu();
    mode = 'host';
    myId = 0;
    players = [makePlayer(0, myName())];
    if (ONLINE) return connect(() => window.GameNet.host('rymdskytt', 3), () => send({ t: 'host' }));
    let url;
    if (window.net) {
      // Desktop-appen: starta servern i Electron
      const res = await window.net.startHost(DEFAULT_PORT);
      if (res.error) return fail(res.error);
      url = `ws://localhost:${res.port}`;
    } else {
      // Webbläsartest: servern kör på samma adress som sidan
      url = `ws://${location.host}`;
    }
    connect(url, () => send({ t: 'host' }));
  };

  function join() {
    let addr = addrInput.value.trim();
    if (!addr) { addrInput.focus(); return; }
    store('neon-addr', addr);
    const code = ONLINE ? window.GameNet.cleanCode(addr) : '';
    if (ONLINE && code.length !== 4) { addrInput.focus(); addrInput.select(); return; }
    addr = addr.replace(/^wss?:\/\//, '');
    if (!/:\d+$/.test(addr)) addr += ':' + DEFAULT_PORT;
    const name = myName();
    hideMenu();
    mode = 'client';
    myId = -1;
    players = [];
    lastSentInput = '';
    connect(ONLINE ? () => window.GameNet.join('rymdskytt', code) : `ws://${addr}`, () => send({ t: 'join', name }));
  }
  document.getElementById('join').onclick = join;
  addrInput.addEventListener('keydown', e => { if (e.key === 'Enter') join(); });

  function toMenu() {
    if (ws) { ws.onclose = null; ws.close(); ws = null; }
    mode = null;
    state = 'menu';
    players = []; enemies = []; bullets = []; enemyBullets = []; powerups = [];
    showMenu();
  }

  // ---------- Nätverk ----------
  // url är en ws://-adress (desktop-appen) eller en funktion som skapar en direktkoppling (webbsidan)
  function connect(url, onOpen) {
    state = 'connecting';
    try { ws = typeof url === 'function' ? url() : new WebSocket(url); } catch { return fail('Ogiltig adress.'); }
    const sock = ws;
    const timer = setTimeout(() => {
      if (ws === sock && sock.readyState !== 1) {
        fail(ONLINE ? 'Kunde inte ansluta. Kolla rumskoden och din internetanslutning.' : 'Kunde inte ansluta. Kolla IP-adressen och att värden har skapat ett spel.');
      }
    }, ONLINE ? 12000 : 6000);
    sock.onopen = () => { clearTimeout(timer); onOpen(); };
    sock.onmessage = ev => { try { onNet(JSON.parse(ev.data)); } catch {} };
    sock.onclose = () => {
      clearTimeout(timer);
      if (ws === sock) fail(mode === 'client' ? 'Anslutningen till värden bröts.' : 'Servern stängdes.');
    };
  }
  function send(m) {
    if (ws && ws.readyState === 1) ws.send(JSON.stringify(m));
  }
  function fail(msg) {
    errorMsg = msg;
    state = 'error';
    if (ws) { ws.onclose = null; ws.close(); ws = null; }
  }

  function onNet(m) {
    if (m.t === 'error') return fail(m.msg);
    if (mode === 'host') {
      if (m.t === 'hosted') {
        lanInfo = { ips: m.ips, port: m.port, code: m.code };
        state = 'lobby';
      } else if (m.t === 'joined') {
        const p = makePlayer(m.id, m.name);
        if (state === 'playing') { p.x = W / 2; p.y = H - 100; p.invuln = 3; }
        players.push(p);
        fx({ k: 'sfx', n: 'power' });
        fx({ k: 'float', x: W / 2, y: H / 2 + 80, text: `${p.name} gick med!`, c: p.color, life: 2 });
      } else if (m.t === 'input') {
        const p = players.find(p => p.id === m.id);
        if (p && m.k) p.input = m.k;
      } else if (m.t === 'left') {
        const p = players.find(p => p.id === m.id);
        players = players.filter(p => p.id !== m.id);
        if (p) fx({ k: 'float', x: W / 2, y: H / 2 + 80, text: `${p.name} lämnade`, c: p.color, life: 2 });
        if (state === 'playing' && !players.some(p => p.alive)) gameOver();
      }
    } else if (mode === 'client') {
      if (m.t === 'welcome') myId = m.id;
      else if (m.t === 'state') applySnapshot(m);
      else if (m.t === 'hostLeft') fail('Värden lämnade spelet.');
    }
  }

  function snapshot() {
    return {
      t: 'state', s: state, w: wave, wt: r1(waveTimer), sc: teamScore, hi: highscore, ip: lanInfo,
      p: players.map(p => [p.id, p.name, p.color, p.x | 0, p.y | 0, p.lives, r1(p.invuln), r1(p.triple), r1(p.shield), p.score, p.tilt, p.alive ? 1 : 0]),
      e: enemies.map(e => [TYPES.indexOf(e.type), e.id, e.x | 0, e.y | 0, e.r | 0, r2(e.rot || 0), e.flash > 0 ? 1 : 0, e.hp, e.maxHp || 0, r2(e.t || 0)]),
      b: bullets.map(b => [b.x | 0, b.y | 0]),
      eb: enemyBullets.map(b => [b.x | 0, b.y | 0, b.r]),
      pu: powerups.map(p => [p.x | 0, p.y | 0, p.kind, r1(p.t)]),
      fx: netFx,
    };
  }

  function applySnapshot(m) {
    state = m.s; wave = m.w; waveTimer = m.wt; teamScore = m.sc; highscore = m.hi; lanInfo = m.ip;
    players = m.p.map(a => ({ id: a[0], name: a[1], color: a[2], x: a[3], y: a[4], lives: a[5], invuln: a[6],
      triple: a[7], shield: a[8], score: a[9], tilt: a[10], alive: !!a[11] }));
    enemies = m.e.map(a => ({ type: TYPES[a[0]], id: a[1], x: a[2], y: a[3], r: a[4], rot: a[5], flash: a[6],
      hp: a[7], maxHp: a[8], t: a[9] }));
    bullets = m.b.map(a => ({ x: a[0], y: a[1] }));
    enemyBullets = m.eb.map(a => ({ x: a[0], y: a[1], r: a[2] }));
    powerups = m.pu.map(a => ({ x: a[0], y: a[1], kind: a[2], t: a[3], r: 12 }));
    for (const ev of m.fx) runFx(ev);
  }

  // ---------- Input ----------
  const keys = new Set();
  window.addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT') return;
    keys.add(e.code);
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
    if (e.code === 'KeyM') muted = !muted;

    if (state === 'playing' && mode === 'solo' && (e.code === 'KeyP' || e.code === 'Escape')) state = 'paused';
    else if (state === 'paused') {
      if (e.code === 'KeyP' || e.code === 'Escape') state = 'playing';
      if (e.code === 'KeyQ') toMenu();
    } else if (e.code === 'Enter') {
      if (state === 'lobby' && mode === 'host') startGame();
      else if (state === 'gameover' && mode !== 'client' && performance.now() - gameOverAt > 800) startGame();
      else if (state === 'error') toMenu();
    } else if (e.code === 'Escape' && ['lobby', 'gameover', 'error', 'connecting'].includes(state)) {
      toMenu();
    }
  });
  window.addEventListener('keydown', sendInput);
  window.addEventListener('keyup', e => { keys.delete(e.code); sendInput(); });
  window.addEventListener('blur', () => {
    keys.clear();
    sendInput();
    if (state === 'playing' && mode === 'solo') state = 'paused';
  });

  function localInput() {
    return {
      l: keys.has('ArrowLeft') || keys.has('KeyA'),
      r: keys.has('ArrowRight') || keys.has('KeyD'),
      u: keys.has('ArrowUp') || keys.has('KeyW'),
      d: keys.has('ArrowDown') || keys.has('KeyS'),
      f: keys.has('Space'),
    };
  }

  // Kompisar skickar sina knappar till värden så fort de ändras
  function sendInput() {
    if (mode !== 'client' || state !== 'playing') return;
    const k = JSON.stringify(localInput());
    if (k !== lastSentInput) { lastSentInput = k; send({ t: 'input', k: JSON.parse(k) }); }
  }

  // ---------- Bakgrund: stjärnfält ----------
  const stars = Array.from({ length: 220 }, () => ({ x: Math.random(), y: Math.random(), z: rand(0.2, 1) }));

  // ---------- Spelare och vågor ----------
  function makePlayer(id, name) {
    const used = players.map(p => p.color);
    return {
      id, name, color: COLORS.find(c => !used.includes(c)) || COLORS[0],
      x: W / 2, y: H - 100, r: 16, speed: 420,
      lives: 3, cooldown: 0, invuln: 2, triple: 0, shield: 0,
      score: 0, tilt: 0, alive: true, input: {},
    };
  }

  function startGame() {
    players.forEach((p, i) => {
      Object.assign(p, {
        x: W * (i + 1) / (players.length + 1), y: H - 100,
        lives: 3, cooldown: 0, invuln: 2, triple: 0, shield: 0, score: 0, alive: true,
      });
    });
    bullets = []; enemyBullets = []; enemies = []; powerups = [];
    teamScore = 0; wave = 0; shake = 0;
    nextWave();
    state = 'playing';
  }

  function gameOver() {
    state = 'gameover';
    gameOverAt = performance.now();
    if (teamScore > highscore) { highscore = teamScore; store('neon-highscore', teamScore); }
  }

  function nextWave() {
    wave++;
    waveTimer = 2.2;
    spawnQueue = [];
    const extra = 1 + (players.length - 1) * 0.4;
    const n = Math.round((6 + wave * 3) * extra);
    for (let i = 0; i < n; i++) {
      const roll = Math.random();
      let type = 'rock';
      if (wave >= 2 && roll < 0.3) type = 'drone';
      if (wave >= 3 && roll < 0.15) type = 'gunner';
      spawnQueue.push({ type, delay: i * Math.max(0.2, (0.9 - wave * 0.06) / extra) });
    }
    if (wave % 5 === 0) spawnQueue.push({ type: 'boss', delay: n * 0.4 });
    if (wave > 1) {
      fx({ k: 'sfx', n: 'wave' });
      // Utslagna kompisar kommer tillbaka med ett liv
      for (const p of players) {
        if (!p.alive) {
          Object.assign(p, { alive: true, lives: 1, invuln: 3, x: W / 2, y: H - 100 });
          fx({ k: 'float', x: p.x, y: p.y - 40, text: 'ÅTERUPPLIVAD!', c: p.color, life: 1.5 });
        }
      }
    }
  }

  function spawnEnemy(type) {
    const x = rand(40, W - 40);
    const speedUp = 1 + wave * 0.07;
    const id = nextEnemyId++;
    if (type === 'rock') {
      const r = rand(18, 34);
      enemies.push({ id, type, x, y: -r, r, vx: rand(-40, 40), vy: rand(70, 130) * speedUp,
        hp: Math.ceil(r / 12), rot: 0, spin: rand(-2, 2), pts: 10 });
    } else if (type === 'drone') {
      enemies.push({ id, type, x, y: -20, r: 15, vy: 110 * speedUp, t: rand(0, 6), baseX: x, hp: 2, pts: 25 });
    } else if (type === 'gunner') {
      enemies.push({ id, type, x, y: -24, r: 20, vy: 60 * speedUp, targetY: rand(80, H * 0.4), hp: 4, fire: rand(1, 2), pts: 50 });
    } else if (type === 'boss') {
      const hp = Math.round((40 + wave * 6) * (1 + (players.length - 1) * 0.5));
      enemies.push({ id, type, x: W / 2, y: -80, r: 60, vy: 50, targetY: 140, t: 0, hp, maxHp: hp, fire: 1.5, pts: 500 });
    }
  }

  function nearestPlayer(x, y) {
    let best = null, bd = Infinity;
    for (const p of players) {
      if (!p.alive) continue;
      const d = (p.x - x) ** 2 + (p.y - y) ** 2;
      if (d < bd) { bd = d; best = p; }
    }
    return best;
  }

  function damagePlayer(p) {
    if (p.invuln > 0 || !p.alive) return;
    if (p.shield > 0) {
      p.shield = 0; p.invuln = 1;
      fx({ k: 'sfx', n: 'hurt', who: p.id });
      explode(p.x, p.y, '#5ef1ff', 20);
      return;
    }
    p.lives--;
    p.invuln = 2;
    p.triple = 0;
    fx({ k: 'shake', a: 14, who: p.id });
    fx({ k: 'sfx', n: 'hurt', who: p.id });
    explode(p.x, p.y, p.color, 40, 300);
    if (p.lives <= 0) {
      p.alive = false;
      if (players.length > 1) fx({ k: 'float', x: p.x, y: p.y - 30, text: `${p.name} är ute!`, c: p.color, life: 1.5 });
      if (!players.some(q => q.alive)) gameOver();
    }
  }

  function killEnemy(e) {
    const colors = { rock: '#ffb347', drone: '#7cff6b', gunner: '#ff5ea8', boss: '#c77dff' };
    const boss = e.type === 'boss';
    explode(e.x, e.y, colors[e.type], boss ? 120 : 22, boss ? 420 : 220);
    fx({ k: 'sfx', n: 'boom' });
    fx({ k: 'shake', a: boss ? 20 : 4 });
    teamScore += e.pts;
    const shooter = players.find(p => p.id === e.lastHit);
    if (shooter) shooter.score += e.pts;
    fx({ k: 'float', x: e.x | 0, y: e.y | 0, text: '+' + e.pts, c: shooter ? shooter.color : '#ffe066' });
    // Stora stenar delas i mindre
    if (e.type === 'rock' && e.r > 26) {
      for (let i = 0; i < 2; i++) {
        enemies.push({ id: nextEnemyId++, type: 'rock', x: e.x, y: e.y, r: e.r * 0.55, vx: rand(-120, 120), vy: rand(60, 140),
          hp: 1, rot: 0, spin: rand(-3, 3), pts: 5 });
      }
    }
    if (Math.random() < (boss ? 1 : 0.08)) {
      const kinds = ['triple', 'shield', 'life'];
      const kind = boss ? 'life' : kinds[Math.floor(Math.random() * 3)];
      powerups.push({ x: e.x, y: e.y, r: 12, vy: 90, kind, t: 0 });
    }
  }

  // ---------- Simulering (körs hos den som spelar ensam eller är värd) ----------
  function simulate(dt) {
    for (const p of players) {
      if (!p.alive) continue;
      const k = p.id === myId ? localInput() : p.input;
      const dx = (k.r ? 1 : 0) - (k.l ? 1 : 0);
      const dy = (k.d ? 1 : 0) - (k.u ? 1 : 0);
      const len = Math.hypot(dx, dy) || 1;
      p.x = clamp(p.x + dx / len * p.speed * dt, 20, W - 20);
      p.y = clamp(p.y + dy / len * p.speed * dt, 40, H - 30);
      p.tilt = dx;
      p.cooldown -= dt;
      p.invuln = Math.max(0, p.invuln - dt);
      p.triple = Math.max(0, p.triple - dt);
      p.shield = Math.max(0, p.shield - dt);

      if (k.f && p.cooldown <= 0) {
        p.cooldown = 0.16;
        bullets.push({ x: p.x, y: p.y - 18, vx: 0, vy: -720, r: 4, owner: p.id });
        if (p.triple > 0) {
          bullets.push({ x: p.x - 8, y: p.y - 10, vx: -160, vy: -680, r: 4, owner: p.id });
          bullets.push({ x: p.x + 8, y: p.y - 10, vx: 160, vy: -680, r: 4, owner: p.id });
        }
        fx({ k: 'sfx', n: 'shoot', who: p.id });
      }
    }

    // Vågor
    waveTimer -= dt;
    if (waveTimer <= 0) {
      for (const s of spawnQueue) s.delay -= dt;
      while (spawnQueue.length && spawnQueue[0].delay <= 0) spawnEnemy(spawnQueue.shift().type);
      if (!spawnQueue.length && !enemies.length) nextWave();
    }

    // Skott
    for (const b of bullets) { b.x += b.vx * dt; b.y += b.vy * dt; }
    bullets = bullets.filter(b => b.y > -20 && b.x > -20 && b.x < W + 20 && !b.dead);
    for (const b of enemyBullets) { b.x += b.vx * dt; b.y += b.vy * dt; }
    enemyBullets = enemyBullets.filter(b => b.y < H + 20 && b.y > -20 && b.x > -20 && b.x < W + 20 && !b.dead);

    // Fiender
    for (const e of enemies) {
      if (e.type === 'rock') {
        e.x += e.vx * dt; e.y += e.vy * dt; e.rot += e.spin * dt;
        if (e.x < e.r || e.x > W - e.r) e.vx *= -1;
      } else if (e.type === 'drone') {
        e.t += dt * 3;
        e.y += e.vy * dt;
        e.x = clamp(e.baseX + Math.sin(e.t) * 90, 20, W - 20);
      } else {
        const boss = e.type === 'boss';
        if (e.y < e.targetY) e.y += e.vy * dt;
        else {
          e.t = (e.t || 0) + dt;
          e.x += Math.sin(e.t * (boss ? 0.8 : 1.5)) * (boss ? 140 : 80) * dt;
          e.x = clamp(e.x, e.r, W - e.r);
        }
        e.fire -= dt;
        const target = nearestPlayer(e.x, e.y);
        if (e.fire <= 0 && e.y > 0 && target) {
          if (!boss) {
            e.fire = rand(1.4, 2.4);
            const a = Math.atan2(target.y - e.y, target.x - e.x);
            enemyBullets.push({ x: e.x, y: e.y + 10, vx: Math.cos(a) * 260, vy: Math.sin(a) * 260, r: 5 });
          } else {
            e.fire = 1.1;
            for (let i = 0; i < 10; i++) {
              const a = e.t + i / 10 * Math.PI * 2;
              enemyBullets.push({ x: e.x, y: e.y, vx: Math.cos(a) * 200, vy: Math.sin(a) * 200, r: 6 });
            }
          }
        }
      }
      for (const p of players) {
        if (p.alive && hit(e, p) && p.invuln <= 0) {
          damagePlayer(p);
          if (e.type !== 'boss') { e.hp = 0; e.noScore = true; }
        }
      }
      for (const b of bullets) {
        if (!b.dead && e.hp > 0 && hit(b, e)) {
          b.dead = true;
          e.hp--;
          e.flash = 0.08;
          e.lastHit = b.owner;
        }
      }
      e.flash = Math.max(0, (e.flash || 0) - dt);
    }
    for (const e of enemies) {
      if (e.hp <= 0 && !e.dead) {
        e.dead = true;
        if (e.noScore) { explode(e.x, e.y, '#ffb347'); fx({ k: 'sfx', n: 'boom' }); } else killEnemy(e);
      }
    }
    enemies = enemies.filter(e => !e.dead && e.y < H + 80);

    for (const b of enemyBullets) {
      for (const p of players) if (p.alive && p.invuln <= 0 && hit(b, p)) { b.dead = true; damagePlayer(p); }
    }

    // Power-ups
    for (const pu of powerups) {
      pu.y += pu.vy * dt; pu.t += dt;
      const p = players.find(p => p.alive && hit(pu, p));
      if (p) {
        pu.dead = true;
        fx({ k: 'sfx', n: 'power', who: p.id });
        if (pu.kind === 'triple') p.triple = 10;
        if (pu.kind === 'shield') p.shield = 8;
        if (pu.kind === 'life') p.lives = Math.min(5, p.lives + 1);
        const label = { triple: 'TRIPPELSKOTT!', shield: 'SKÖLD!', life: '+1 LIV' }[pu.kind];
        fx({ k: 'float', x: pu.x | 0, y: pu.y | 0, text: label, c: p.color, life: 1.2 });
      }
    }
    powerups = powerups.filter(p => !p.dead && p.y < H + 20);
  }

  // ---------- Uppdatering ----------
  function update(dt) {
    for (const s of stars) {
      s.y += dt * s.z * (state === 'playing' ? 0.12 : 0.04);
      if (s.y > 1) { s.y -= 1; s.x = Math.random(); }
    }

    if (state === 'playing' && mode !== 'client') simulate(dt);
    sendInput();

    // Motorlåga bakom alla skepp (bara utseende, räknas ut lokalt)
    if (state === 'playing') {
      for (const p of players) {
        if (!p.alive) continue;
        particles.push({ x: p.x + rand(-4, 4), y: p.y + 16, vx: rand(-20, 20), vy: rand(120, 220),
          life: 0.25, max: 0.25, color: p.color, size: rand(1.5, 3) });
      }
    }

    for (const p of particles) { p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 0.97; p.vy *= 0.97; p.life -= dt; }
    particles = particles.filter(p => p.life > 0);
    for (const f of floaters) { f.y -= 40 * dt; f.life -= dt; }
    floaters = floaters.filter(f => f.life > 0);
    shake = Math.max(0, shake - dt * 40);

    if (mode === 'host' && ['lobby', 'playing', 'gameover'].includes(state)) {
      send(snapshot());
      netFx = [];
    }
  }

  // ---------- Ritning ----------
  function glow(color, blur) { ctx.shadowColor = color; ctx.shadowBlur = blur; }

  function drawShip(p) {
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.scale(1 - Math.abs(p.tilt || 0) * 0.15, 1);
    glow(p.color, 18);
    ctx.strokeStyle = p.color;
    ctx.fillStyle = '#0b1a2e';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(0, -20); ctx.lineTo(15, 14); ctx.lineTo(5, 9); ctx.lineTo(0, 15);
    ctx.lineTo(-5, 9); ctx.lineTo(-15, 14); ctx.closePath();
    ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#ff5ea8';
    glow('#ff5ea8', 10);
    ctx.beginPath(); ctx.arc(0, -3, 3.5, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  function polygon(points) {
    ctx.beginPath();
    points.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }

  function drawEnemy(e) {
    ctx.save();
    ctx.translate(e.x, e.y);
    const flash = e.flash > 0;
    ctx.lineWidth = 2.5;
    if (e.type === 'rock') {
      ctx.rotate(e.rot);
      const c = flash ? '#fff' : '#ffb347';
      glow(c, 14); ctx.strokeStyle = c; ctx.fillStyle = '#1e140a';
      const shape = shapeFor(e.id);
      polygon(shape.map((k, i) => {
        const a = i / shape.length * Math.PI * 2;
        return [Math.cos(a) * e.r * k, Math.sin(a) * e.r * k];
      }));
    } else if (e.type === 'drone') {
      const c = flash ? '#fff' : '#7cff6b';
      glow(c, 14); ctx.strokeStyle = c; ctx.fillStyle = '#0c1f0a';
      polygon([[0, 15], [15, 0], [0, -10], [-15, 0]]);
    } else if (e.type === 'gunner') {
      const c = flash ? '#fff' : '#ff5ea8';
      glow(c, 16); ctx.strokeStyle = c; ctx.fillStyle = '#240a17';
      polygon(Array.from({ length: 6 }, (_, i) => {
        const a = i / 6 * Math.PI * 2 + Math.PI / 6;
        return [Math.cos(a) * e.r, Math.sin(a) * e.r];
      }));
      ctx.beginPath(); ctx.arc(0, 0, 6, 0, Math.PI * 2); ctx.stroke();
    } else if (e.type === 'boss') {
      const c = flash ? '#fff' : '#c77dff';
      glow(c, 26); ctx.strokeStyle = c; ctx.fillStyle = '#1a0b29';
      ctx.lineWidth = 3.5;
      polygon(Array.from({ length: 12 }, (_, i) => {
        const a = i / 12 * Math.PI * 2 + (e.t || 0);
        const rr = i % 2 ? e.r * 0.7 : e.r;
        return [Math.cos(a) * rr, Math.sin(a) * rr];
      }));
      ctx.beginPath(); ctx.arc(0, 0, 16, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.restore();
  }

  function drawPowerup(p) {
    const colors = { triple: '#ffe066', shield: '#5ef1ff', life: '#ff5ea8' };
    const labels = { triple: 'T', shield: 'S', life: '♥' };
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(Math.sin(p.t * 3) * 0.3);
    glow(colors[p.kind], 18);
    ctx.strokeStyle = colors[p.kind];
    ctx.lineWidth = 2;
    ctx.strokeRect(-p.r, -p.r, p.r * 2, p.r * 2);
    ctx.fillStyle = colors[p.kind];
    ctx.font = 'bold 15px "Segoe UI", sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(labels[p.kind], 0, 1);
    ctx.restore();
  }

  function text(str, x, y, size, color = '#e8ecff', align = 'center', blur = 12) {
    ctx.save();
    ctx.font = `700 ${size}px "Segoe UI", system-ui, sans-serif`;
    ctx.textAlign = align;
    ctx.textBaseline = 'middle';
    glow(color, blur);
    ctx.fillStyle = color;
    ctx.fillText(str, x, y);
    ctx.restore();
  }

  const blink = () => Math.floor(performance.now() / 500) % 2 === 1;
  const me = () => players.find(p => p.id === myId);

  function drawWorld() {
    for (const p of powerups) drawPowerup(p);
    for (const e of enemies) drawEnemy(e);

    ctx.save();
    glow('#ffe066', 12); ctx.fillStyle = '#ffe066';
    for (const b of bullets) ctx.fillRect(b.x - 2, b.y - 8, 4, 16);
    glow('#ff5ea8', 12); ctx.fillStyle = '#ff8fc4';
    for (const b of enemyBullets) { ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2); ctx.fill(); }
    ctx.restore();

    if (state !== 'gameover') {
      for (const p of players) {
        if (!p.alive || (p.invuln > 0 && Math.floor(p.invuln * 12) % 2)) continue;
        drawShip(p);
        if (players.length > 1) text(p.name, p.x, p.y + 32, 12, p.color, 'center', 4);
        if (p.shield > 0) {
          ctx.save();
          glow(p.color, 20);
          ctx.globalAlpha = p.shield < 2 ? 0.5 + 0.4 * Math.sin(p.shield * 20) : 0.85;
          ctx.strokeStyle = p.color;
          ctx.lineWidth = 2;
          ctx.beginPath(); ctx.arc(p.x, p.y, 28, 0, Math.PI * 2); ctx.stroke();
          ctx.restore();
        }
      }
    }

    for (const f of floaters) {
      ctx.globalAlpha = clamp(f.life, 0, 1);
      text(f.text, f.x, f.y, 16, f.color, 'center', 8);
    }
    ctx.globalAlpha = 1;

    // Bossens livsmätare
    const boss = enemies.find(e => e.type === 'boss');
    if (boss && boss.maxHp) {
      const bw = 400;
      ctx.fillStyle = '#2a1840';
      ctx.fillRect(W / 2 - bw / 2, 56, bw, 8);
      ctx.save(); glow('#c77dff', 12);
      ctx.fillStyle = '#c77dff';
      ctx.fillRect(W / 2 - bw / 2, 56, bw * (boss.hp / boss.maxHp), 8);
      ctx.restore();
    }

    // HUD
    text(`POÄNG ${teamScore}`, 20, 26, 20, '#e8ecff', 'left', 8);
    text(`VÅG ${wave}`, W / 2, 26, 20, '#c77dff', 'center', 8);
    players.forEach((p, i) => {
      const hearts = p.alive ? '♥'.repeat(p.lives) : 'UTE';
      text(players.length > 1 ? `${p.name}  ${hearts}` : hearts, W - 20, 26 + i * 24, players.length > 1 ? 16 : 22, p.color, 'right', 8);
    });
    const mine = me();
    if (mine && mine.triple > 0) text(`TRIPPEL ${Math.ceil(mine.triple)}s`, 20, 54, 14, '#ffe066', 'left', 6);
    if (mine && !mine.alive && state === 'playing') {
      text('Du är ute – du återupplivas nästa våg', W / 2, H - 40, 18, mine.color, 'center', 8);
    }
    if (waveTimer > 0 && state === 'playing') {
      ctx.globalAlpha = clamp(waveTimer, 0, 1);
      text(`VÅG ${wave}`, W / 2, H / 2 - 20, 56, '#c77dff', 'center', 24);
      if (wave % 5 === 0) text('BOSS PÅ VÄG!', W / 2, H / 2 + 30, 22, '#ff5ea8');
      ctx.globalAlpha = 1;
    }
  }

  function dim(alpha) {
    ctx.fillStyle = `rgba(5,6,15,${alpha})`;
    ctx.fillRect(0, 0, W, H);
  }

  function drawLobby() {
    text('LOBBY', W / 2, 120, 56, '#5ef1ff', 'center', 24);
    if (lanInfo && lanInfo.code) {
      text('Kompisarna öppnar samma sida och skriver in rumskoden:', W / 2, 200, 18, '#aab3dd', 'center', 0);
      text(lanInfo.code, W / 2, 260, 56, '#ffe066', 'center', 16);
    } else if (lanInfo) {
      const port = lanInfo.port !== DEFAULT_PORT ? ':' + lanInfo.port : '';
      const ips = lanInfo.ips.length ? lanInfo.ips.map(ip => ip + port) : ['localhost' + port];
      text('Kompisarna skriver in den här adressen för att gå med:', W / 2, 200, 18, '#aab3dd', 'center', 0);
      ips.slice(0, 3).forEach((ip, i) => text(ip, W / 2, 238 + i * 34, 28, '#ffe066', 'center', 12));
    }
    text(`Spelare (${players.length}/4)`, W / 2, 380, 20, '#aab3dd', 'center', 0);
    players.forEach((p, i) => {
      const tags = [p.id === 0 ? 'värd' : '', p.id === myId ? 'du' : ''].filter(Boolean).join(', ');
      text(`●  ${p.name}${tags ? `  (${tags})` : ''}`, W / 2, 420 + i * 36, 24, p.color, 'center', 10);
    });
    if (mode === 'host') {
      if (blink()) text('Tryck ENTER för att starta', W / 2, H - 90, 24, '#7cff6b');
      text('Esc – avbryt', W / 2, H - 50, 15, '#7b86b8', 'center', 0);
    } else {
      text('Väntar på att värden startar…', W / 2, H - 90, 22, '#7cff6b', 'center', 8);
      text('Esc – lämna', W / 2, H - 50, 15, '#7b86b8', 'center', 0);
    }
  }

  function drawGameOver() {
    dim(0.55);
    text('GAME OVER', W / 2, 190, 64, '#ff5ea8', 'center', 30);
    text(`Lagets poäng: ${teamScore}   ·   Våg: ${wave}`, W / 2, 260, 22);
    text(teamScore >= highscore && teamScore > 0 ? 'NYTT REKORD!' : `Rekord: ${highscore}`, W / 2, 296, 20, '#ffe066', 'center', 8);
    if (players.length > 1) {
      [...players].sort((a, b) => b.score - a.score).forEach((p, i) => {
        text(`${i + 1}. ${p.name} – ${p.score}`, W / 2, 360 + i * 32, 22, p.color, 'center', 8);
      });
    }
    if (mode === 'client') text('Väntar på värden…   ·   Esc – lämna', W / 2, H - 70, 18, '#aab3dd', 'center', 0);
    else {
      if (blink()) text('Tryck ENTER för att spela igen', W / 2, H - 100, 22, '#5ef1ff');
      text('Esc – till menyn', W / 2, H - 60, 15, '#7b86b8', 'center', 0);
    }
  }

  function draw() {
    // Bakgrund och stjärnor täcker hela fönstret
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.fillStyle = '#05060f';
    ctx.fillRect(0, 0, CW, CH);
    for (const s of stars) {
      ctx.globalAlpha = 0.3 + s.z * 0.7;
      ctx.fillStyle = s.z > 0.8 ? '#cfe8ff' : '#7b86b8';
      const sz = s.z * 2;
      ctx.fillRect(s.x * CW, s.y * CH, sz, sz * (state === 'playing' ? 2.5 : 1));
    }
    ctx.globalAlpha = 1;
    if (state === 'menu') return;

    // Spelplanen skalas för att passa fönstret
    const scale = Math.min(CW / W, CH / H);
    const ox = (CW - W * scale) / 2, oy = (CH - H * scale) / 2;
    ctx.setTransform(DPR * scale, 0, 0, DPR * scale, DPR * ox, DPR * oy);
    ctx.strokeStyle = '#1a2148';
    ctx.lineWidth = 2;
    ctx.strokeRect(0, 0, W, H);

    ctx.save();
    if (shake > 0) ctx.translate(rand(-shake, shake) * 0.5, rand(-shake, shake) * 0.5);
    for (const p of particles) {
      ctx.globalAlpha = Math.max(0, p.life / p.max);
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
    }
    ctx.globalAlpha = 1;
    if (['playing', 'paused', 'gameover'].includes(state)) drawWorld();
    ctx.restore();

    if (state === 'lobby') drawLobby();
    if (state === 'connecting') text('Ansluter…', W / 2, H / 2, 32, '#5ef1ff', 'center', 16);
    if (state === 'error') {
      text('Hoppsan!', W / 2, H / 2 - 60, 48, '#ff5ea8', 'center', 24);
      text(errorMsg, W / 2, H / 2, 20);
      text('Tryck ENTER för att gå tillbaka', W / 2, H / 2 + 60, 18, '#aab3dd', 'center', 0);
    }
    if (state === 'paused') {
      dim(0.6);
      text('PAUS', W / 2, H / 2 - 10, 56, '#5ef1ff', 'center', 24);
      text('P – fortsätt   ·   Q – till menyn', W / 2, H / 2 + 40, 18, '#aab3dd', 'center', 0);
    }
    if (state === 'gameover') drawGameOver();
    if (muted) text('LJUD AV', W - 20, H - 20, 12, '#7b86b8', 'right', 0);
  }

  // ---------- Spelloop ----------
  showMenu();
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
