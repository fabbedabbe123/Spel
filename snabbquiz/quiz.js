// Snabbquiz – frågesport och minispel, ensam eller med upp till 7 kompisar.
// Värden styr spelet och skickar läget till alla, kompisarna skickar bara sina svar (se relay.js).
// Varje spel består av rundor: värden skapar en utmaning, alla svarar, poäng delas ut.
// Tangenter: 1–4 = svara, Mellanslag = reagera/klicka, Enter = starta / nästa runda.

(() => {
  const $ = id => document.getElementById(id);
  const DEFAULT_PORT = 7778;
  const GRACE = 800;          // extra tid för nätverksfördröjning
  const REVEAL_TIME = 7000;
  const MAX_PLAYERS = 8;
  const COLORS = ['#ffcf3f', '#3a86ff', '#ef476f', '#06b67a', '#c77dff', '#ff8a5e', '#5ef1ff', '#f15bb5'];
  const SHAPES = ['▲', '◆', '●', '■'];
  const INKS = [['RÖD', '#ef476f'], ['BLÅ', '#3a86ff'], ['GUL', '#ffcf3f'], ['GRÖN', '#06b67a']];

  const GAMES = {
    quiz:     { icon: '❓', name: 'Frågesport',     desc: 'Snabbast rätt svar vinner mest',          counts: [5, 10, 15, 20] },
    reaction: { icon: '⚡', name: 'Reaktion',       desc: 'Klicka så fort det blir grönt',           counts: [3, 5, 10] },
    math:     { icon: '➗', name: 'Mattekamp',      desc: 'Räkna ut svaret snabbast',               counts: [5, 10, 15] },
    color:    { icon: '🎨', name: 'Färgfällan',     desc: 'Välj färgen på texten – inte ordet!',    counts: [5, 10, 15] },
    typing:   { icon: '⌨️', name: 'Snabbskrivning', desc: 'Skriv av texten först',                  counts: [3, 5, 10] },
    estimate: { icon: '🎯', name: 'Närmast vinner', desc: 'Gissa siffran – närmast får mest',       counts: [3, 5, 10] },
    clicks:   { icon: '👆', name: 'Klickrace',      desc: 'Klicka så mycket du kan på 5 sekunder',  counts: [3, 5] },
    capitals: { icon: '🌍', name: 'Huvudstäder',    desc: 'Vilken är landets huvudstad?',            counts: [5, 10, 15] },
    flagquiz: { icon: '🏳️', name: 'Flaggquiz',      desc: 'Vilket land har flaggan?',                counts: [5, 10, 15] },
    paint:    { icon: '🖌️', name: 'Flaggfärger',    desc: 'Hitta flaggans exakta färger med färghjulet', counts: [3, 5, 10] },
    size:     { icon: '📏', name: 'Size it up',     desc: 'Hur stor är saken jämfört med den andra?', counts: [5, 10, 15] },
    wordle:   { icon: '🟩', name: 'Wordle',         desc: 'Gissa ordet på fem bokstäver – sex försök', counts: [1, 3, 5] },
    cryptic:  { icon: '🧩', name: 'Kryptoordet',    desc: 'Lös en kryptisk ledtråd, som Minute Cryptic', counts: [3, 5, 10] },
    anagram:  { icon: '🔤', name: 'Ordjakten',      desc: 'Bokstäverna är blandade – hitta ordet',  counts: [5, 10] },
    emoji:    { icon: '😂', name: 'Emojigåtan',     desc: 'Vilken film beskriver emojierna?',       counts: [5, 10, 15] },
    mix:      { icon: '🎉', name: 'Partymix',       desc: 'Blandar alla spel i en omgång',          counts: [5, 10, 15] },
  };
  const MIX_KINDS = Object.keys(GAMES).filter(k => k !== 'mix');

  function load(key, fallback) {
    try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; }
  }
  function store(key, v) {
    try { localStorage.setItem(key, String(v)); } catch {}
  }
  const rand = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const fmt = n => Number(n).toLocaleString('sv-SE');
  function shuffle(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }
  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }
  function show(id) {
    document.querySelectorAll('.screen').forEach(s => s.classList.toggle('active', s.id === id));
  }
  const normalize = s => s.trim().replace(/\s+/g, ' ').toLowerCase();
  const capFirst = s => s.charAt(0).toUpperCase() + s.slice(1);
  // Längd i cm som läsbar text: 8 cm, 5,5 m, 12 742 km
  function fmtLength(cm) {
    const nice = (v, d) => Number(v.toFixed(d)).toLocaleString('sv-SE');
    if (cm < 100) return `${nice(cm, cm < 10 ? 1 : 0)} cm`;
    if (cm < 100000) return `${nice(cm / 100, cm < 1000 ? 1 : 0)} m`;
    return `${nice(cm / 100000, 0)} km`;
  }
  // Förhållande (som 10-logaritm) som text: "12 gånger större"
  function ratioText(logv) {
    if (Math.abs(logv) < 0.02) return 'lika stor';
    const r = 10 ** Math.abs(logv);
    const n = r < 10 ? Number(r.toFixed(1)) : r < 100 ? Math.round(r) : Number(r.toPrecision(2));
    return `${n.toLocaleString('sv-SE')} gånger ${logv > 0 ? 'större' : 'mindre'}`;
  }
  const normalizeWord = s => String(s).toUpperCase().replace(/[^A-ZÅÄÖÉÜ]/g, '');
  // Svaret i ordspelen skickas lite förvrängt så att det inte syns direkt i nätverkstrafiken
  const encodeWord = w => [...w].map(c => c.charCodeAt(0) + 7);
  const decodeWord = code => String.fromCharCode(...code.map(c => c - 7));

  // ---------- Färgverktyg ----------
  const hexToRgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
  const rgbToHex = rgb => '#' + rgb.map(v => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0')).join('').toUpperCase();
  function hsvToRgb(h, s, v) {
    const f = n => {
      const k = (n + h / 60) % 6;
      return v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
    };
    return [f(5) * 255, f(3) * 255, f(1) * 255];
  }
  function rgbToHsv([r, g, b]) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), d = max - Math.min(r, g, b);
    let h = 0;
    if (d) {
      if (max === r) h = ((g - b) / d) % 6;
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h = (h * 60 + 360) % 360;
    }
    return [h, max ? d / max : 0, max];
  }
  // Färgavstånd som liknar hur ögat uppfattar skillnader (CIE Lab, ΔE)
  function rgbToLab(rgb) {
    const lin = rgb.map(v => { v /= 255; return v > 0.04045 ? ((v + 0.055) / 1.055) ** 2.4 : v / 12.92; });
    const [x, y, z] = [
      (lin[0] * 0.4124 + lin[1] * 0.3576 + lin[2] * 0.1805) / 0.95047,
      (lin[0] * 0.2126 + lin[1] * 0.7152 + lin[2] * 0.0722),
      (lin[0] * 0.0193 + lin[1] * 0.1192 + lin[2] * 0.9505) / 1.08883,
    ].map(t => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116));
    return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
  }
  function colorDistance(a, b) {
    const [l1, a1, b1] = rgbToLab(hexToRgb(a));
    const [l2, a2, b2] = rgbToLab(hexToRgb(b));
    return Math.hypot(l1 - l2, a1 - a2, b1 - b2);
  }
  // 100 % = exakt rätt, 0 % = långt ifrån (ΔE 70 eller mer)
  const colorAccuracy = (a, b) => clamp(1 - colorDistance(a, b) / 70, 0, 1);
  const isHex = c => typeof c === 'string' && /^#[0-9A-F]{6}$/i.test(c);

  // Ritar en förenklad flagga som SVG. colors = en hexfärg per del.
  function flagSVG(flag, colors, onPart) {
    const [, type, , weights, extra] = flag;
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 300 200');
    svg.classList.add('flag');
    const rect = (g, x, y, w, h) => {
      const r = document.createElementNS(NS, 'rect');
      r.setAttribute('x', x); r.setAttribute('y', y); r.setAttribute('width', w); r.setAttribute('height', h);
      g.append(r);
    };
    const parts = colors.map((c, i) => {
      const g = document.createElementNS(NS, 'g');
      g.setAttribute('fill', c);
      if (onPart) { g.style.cursor = 'pointer'; g.addEventListener('click', () => onPart(i)); }
      return g;
    });
    const circle = (g, cx, cy, r) => {
      const c = document.createElementNS(NS, 'circle');
      c.setAttribute('cx', cx); c.setAttribute('cy', cy); c.setAttribute('r', r);
      g.append(c);
    };
    const stripes = extra && extra.disc ? colors.length - 1 : colors.length;
    if (type === 'h' || type === 'v') {
      const ws = weights || Array(stripes).fill(1);
      const sum = ws.reduce((a, b) => a + b, 0);
      let pos = 0;
      ws.forEach((w, i) => {
        if (type === 'h') rect(parts[i], 0, pos / sum * 200, 300, w / sum * 200 + 0.5);
        else rect(parts[i], pos / sum * 300, 0, w / sum * 300 + 0.5, 200);
        pos += w;
      });
      if (extra && extra.disc) circle(parts[stripes], 150, 100, extra.r || 40);
    } else if (type === 'nordic') {
      rect(parts[0], 0, 0, 300, 200);
      rect(parts[1], 85, 0, 50, 200); rect(parts[1], 0, 75, 300, 50);
      if (parts[2]) { rect(parts[2], 98, 0, 24, 200); rect(parts[2], 0, 88, 300, 24); }
    } else if (type === 'disc') {
      rect(parts[0], 0, 0, 300, 200);
      circle(parts[1], (extra && extra.cx) || 150, 100, 60);
    } else if (type === 'plus') {
      rect(parts[0], 0, 0, 300, 200);
      rect(parts[1], 130, 45, 40, 110); rect(parts[1], 95, 80, 110, 40);
    } else if (type === 'tri') {
      rect(parts[0], 0, 0, 300, 100);
      rect(parts[1], 0, 100, 300, 100);
      const p = document.createElementNS(NS, 'polygon');
      p.setAttribute('points', '0,0 150,100 0,200');
      parts[2].append(p);
    } else if (type === 'bar') {
      const w = 300 * ((extra && extra.w) || 1 / 3);
      rect(parts[0], 0, 0, w, 200);
      rect(parts[1], w, 0, 300 - w, 100);
      rect(parts[2], w, 100, 300 - w, 100);
    }
    svg.append(...parts);
    return { svg, parts };
  }

  // ---------- Ljud ----------
  let audio = null;
  let muted = load('quiz-muted', '0') === '1';
  function beep(freq, dur, type = 'sine', vol = 0.08, delay = 0) {
    if (muted) return;
    try {
      audio = audio || new (window.AudioContext || window.webkitAudioContext)();
      const t = audio.currentTime + delay;
      const o = audio.createOscillator();
      const g = audio.createGain();
      o.type = type;
      o.frequency.setValueAtTime(freq, t);
      g.gain.setValueAtTime(vol, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g).connect(audio.destination);
      o.start(t);
      o.stop(t + dur);
    } catch {}
  }
  const sfx = {
    tick: () => beep(1200, 0.05, 'square', 0.03),
    click: () => beep(700, 0.03, 'square', 0.02),
    go: () => beep(988, 0.15, 'square', 0.06),
    start: () => { beep(523, 0.12); beep(659, 0.12, 'sine', 0.08, 0.1); },
    good: () => { beep(659, 0.12); beep(784, 0.12, 'sine', 0.08, 0.1); beep(1047, 0.25, 'sine', 0.08, 0.2); },
    bad: () => { beep(300, 0.2, 'sawtooth', 0.05); beep(220, 0.35, 'sawtooth', 0.05, 0.18); },
    join: () => beep(880, 0.1, 'triangle', 0.06),
    win: () => [523, 659, 784, 1047].forEach((f, i) => beep(f, 0.3, 'triangle', 0.08, i * 0.13)),
  };
  const muteBtn = $('mute');
  const paintMute = () => { muteBtn.textContent = muted ? '🔇' : '🔊'; };
  muteBtn.onclick = () => { muted = !muted; store('quiz-muted', muted ? 1 : 0); paintMute(); muteBtn.blur(); };
  paintMute();

  // ---------- Frågor ----------
  function parseLine(line) {
    const parts = line.split('|').map(s => s.trim()).filter(Boolean);
    if (parts.length < 3) return null;
    return { q: parts[0], right: parts[1], wrong: parts.slice(2, 5) };
  }
  function customLines() {
    return load('quiz-custom', '').split('\n').filter(l => parseLine(l));
  }
  function categories() {
    const cats = ['Blandat', ...Object.keys(window.QUESTIONS)];
    if (customLines().length) cats.push('Egna frågor');
    return cats;
  }
  function pool(cat) {
    if (cat === 'Egna frågor') return customLines();
    if (cat === 'Blandat') return [...Object.values(window.QUESTIONS).flat(), ...customLines()];
    return window.QUESTIONS[cat] || [];
  }

  // ---------- Tillstånd ----------
  let mode = null; // 'solo' | 'host' | 'client'
  let myId = 0;
  let ws = null;
  let lanInfo = null;
  let view = null;       // senaste läget som visas på skärmen
  let local = null;      // mitt eget läge i aktuell runda
  let deadline = 0;      // lokal tid när rundan tar slut
  let revealDeadline = 0;
  let game = null;       // bara hos värden / ensamspelaren

  // ---------- Meny ----------
  const nameInput = $('name');
  const addrInput = $('addr');
  nameInput.value = load('quiz-name', '');
  addrInput.value = load('quiz-addr', '');
  // Som webbsida används rumskoder i stället för IP-adresser
  const ONLINE = !!(window.GameNet && window.GameNet.online);
  if (ONLINE) {
    addrInput.placeholder = 'Rumskod, t.ex. KATT';
    addrInput.maxLength = 4;
    addrInput.style.textTransform = 'uppercase';
    addrInput.value = '';
  }

  function myName() {
    const n = nameInput.value.trim().slice(0, 12) || 'Spelare';
    store('quiz-name', n);
    return n;
  }

  $('btnSolo').onclick = () => {
    mode = 'solo';
    myId = 0;
    newGame(myName());
    broadcast();
  };

  $('btnHost').onclick = async () => {
    const name = myName();
    mode = 'host';
    myId = 0;
    if (ONLINE) {
      // Webbsidan: värdens webbläsare skapar ett rum med en kod (se net.js)
      return connect(() => window.GameNet.host('snabbquiz', 7), () => send({ t: 'host' }), () => newGame(name), 'Skapar ett rum…');
    }
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
    connect(url, () => send({ t: 'host' }), () => newGame(name));
  };

  function join() {
    let addr = addrInput.value.trim();
    if (!addr) { addrInput.focus(); return; }
    store('quiz-addr', addr);
    const name = myName();
    if (ONLINE) {
      const code = window.GameNet.cleanCode(addr);
      if (code.length !== 4) { addrInput.focus(); addrInput.select(); return; }
      mode = 'client';
      myId = -1;
      return connect(() => window.GameNet.join('snabbquiz', code), () => send({ t: 'join', name }), null, `Rum ${code}`);
    }
    addr = addr.replace(/^wss?:\/\//, '');
    if (!/:\d+$/.test(addr)) addr += ':' + DEFAULT_PORT;
    mode = 'client';
    myId = -1;
    connect(`ws://${addr}`, () => send({ t: 'join', name }));
  }
  $('btnJoin').onclick = join;
  addrInput.addEventListener('keydown', e => { if (e.key === 'Enter') join(); });

  function toMenu() {
    if (ws) { ws.onclose = null; ws.close(); ws = null; }
    mode = null;
    game = null;
    view = null;
    local = null;
    show('menu');
  }
  $('btnLeave').onclick = toMenu;
  $('btnFinalMenu').onclick = toMenu;
  $('btnErrBack').onclick = toMenu;

  // ---------- Egna frågor ----------
  const customText = $('customText');
  function updateCustomInfo() {
    const n = customText.value.split('\n').filter(l => parseLine(l)).length;
    $('customInfo').textContent = n ? `${n} giltiga frågor` : 'Inga giltiga frågor än';
  }
  $('btnEdit').onclick = () => {
    customText.value = load('quiz-custom', '');
    updateCustomInfo();
    show('editor');
  };
  customText.addEventListener('input', updateCustomInfo);
  $('btnEditBack').onclick = () => show('menu');
  $('btnEditSave').onclick = () => {
    store('quiz-custom', customText.value);
    show('menu');
  };

  // ---------- Nätverk ----------
  // url är en ws://-adress (desktop-appen) eller en funktion som skapar en direktkoppling (webbsidan)
  function connect(url, onOpen, onHosted, label) {
    show('error');
    $('errTitle').textContent = 'Ansluter…';
    $('errText').textContent = label || String(url).replace('ws://', '');
    $('btnErrBack').textContent = 'Avbryt';
    try { ws = typeof url === 'function' ? url() : new WebSocket(url); } catch { return fail('Ogiltig adress.'); }
    const sock = ws;
    sock.onHosted = onHosted;
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
    game = null;
    show('error');
    $('errTitle').textContent = 'Hoppsan!';
    $('errText').textContent = msg;
    $('btnErrBack').textContent = 'Tillbaka till menyn';
  }

  function onNet(m) {
    if (m.t === 'error') return fail(m.msg);
    if (mode === 'host') {
      if (m.t === 'hosted') {
        lanInfo = { ips: m.ips, port: m.port, code: m.code };
        ws.onHosted();
        broadcast();
      } else if (m.t === 'joined' && game) {
        addPlayer(m.id, m.name);
        broadcast();
      } else if (m.t === 'answer' && game) {
        recordAnswer(m.id, { v: m.v, ms: m.ms });
      } else if (m.t === 'left' && game) {
        game.players = game.players.filter(p => p.id !== m.id);
        game.answers.delete(m.id);
        if (game.phase === 'round' && allAnswered()) reveal();
        else broadcast();
      }
    } else if (mode === 'client') {
      if (m.t === 'welcome') myId = m.id;
      else if (m.t === 'state') render(m.v);
      else if (m.t === 'hostLeft') fail('Värden lämnade spelet.');
    }
  }

  // ---------- Rundor (skapas hos värden) ----------
  function draw(name, source) {
    const decks = game.decks;
    if (!decks[name] || !decks[name].length) decks[name] = shuffle(source());
    return decks[name].pop();
  }

  function mathProblem() {
    const type = rand(0, 3);
    if (type === 0) { const a = rand(12, 89), b = rand(12, 89); return [`${a} + ${b}`, a + b]; }
    if (type === 1) { const a = rand(30, 99), b = rand(11, a - 1); return [`${a} − ${b}`, a - b]; }
    if (type === 2) { const a = rand(3, 12), b = rand(3, 12); return [`${a} × ${b}`, a * b]; }
    const b = rand(2, 9), ans = rand(3, 12);
    return [`${b * ans} ÷ ${b}`, ans];
  }

  // Fyra svarsalternativ: rätt svar, ev. en fälla och resten slumpade
  function choices(right, others, trap) {
    const wrong = shuffle(others.filter(o => o !== right && o !== trap)).slice(0, trap ? 2 : 3);
    const alts = shuffle([right, ...(trap ? [trap] : []), ...wrong]);
    return { alts, secret: alts.indexOf(right) };
  }

  // Skapar en runda. Svaren ritas med samma "kind" som liknande spel (t.ex. alla flervalsfrågor = quiz).
  function makeRound(game) {
    const r = makeRoundInner(game);
    r.game = game;
    return r;
  }

  function makeRoundInner(kind) {
    if (kind === 'capitals') {
      const [country, capital, trap] = draw('capitals', () => window.CAPITALS);
      const { alts, secret } = choices(capital, window.CAPITALS.map(c => c[1]), trap);
      return { kind: 'quiz', data: { q: `Vad heter huvudstaden i ${country}?`, alts }, secret, limit: 12000 };
    }
    if (kind === 'flagquiz') {
      const flag = draw('flags', () => window.FLAGS.map((_, i) => i));
      const { alts, secret } = choices(window.FLAGS[flag][0], window.FLAGS.map(f => f[0]));
      return { kind: 'quiz', data: { q: 'Vilket land har den här flaggan?', alts, flag }, secret, limit: 12000 };
    }
    if (kind === 'emoji') {
      const [emojis, answer] = draw('emoji', () => window.EMOJIS);
      const { alts, secret } = choices(answer, window.EMOJIS.map(e => e[1]));
      return { kind: 'quiz', data: { q: emojis, alts, big: true }, secret, limit: 15000 };
    }
    if (kind === 'paint') {
      const flag = draw('paintflags', () => window.FLAGS.map((_, i) => i));
      const right = window.FLAGS[flag][2];
      // Varje del får en slumpad färg som ligger långt från den rätta
      const start = right.map(c => {
        let hex;
        do hex = rgbToHex(hsvToRgb(Math.random() * 360, 0.4 + Math.random() * 0.6, 0.35 + Math.random() * 0.65));
        while (colorAccuracy(hex, c) > 0.2);
        return hex;
      });
      return { kind: 'paint', data: { flag, start }, secret: right, limit: 45000 };
    }
    if (kind === 'size') {
      // Två saker vars storlek skiljer sig mellan 2 och 1000 gånger
      const S = window.SIZES;
      let a, b, ratio;
      do {
        a = S[Math.floor(Math.random() * S.length)];
        b = S[Math.floor(Math.random() * S.length)];
        ratio = b[2] / a[2];
      } while (a === b || Math.abs(Math.log10(ratio)) < 0.3 || Math.abs(Math.log10(ratio)) > 3);
      const explain = `${capFirst(b[1])} är ${fmtLength(b[2])} ${b[3]}, ${a[1]} är ${fmtLength(a[2])} ${a[3]}.`;
      return { kind: 'size', data: { a: [a[0], a[1]], b: [b[0], b[1]] }, secret: ratio, explain, limit: 20000 };
    }
    if (kind === 'wordle') {
      const word = draw('wordle', () => window.WORDLE);
      return { kind: 'wordle', data: { code: encodeWord(word) }, secret: word, limit: 150000 };
    }
    if (kind === 'cryptic') {
      const [clue, answer, explain] = draw('cryptic', () => window.CRYPTIC);
      return { kind: 'word', data: { clue, len: answer.length, code: encodeWord(answer) }, secret: answer, explain, limit: 90000 };
    }
    if (kind === 'anagram') {
      const word = draw('anagram', () => window.ANAGRAMS);
      let letters = word;
      while (letters === word) letters = shuffle([...word]).join('');
      return { kind: 'word', data: { letters, len: word.length, code: encodeWord(word) }, secret: word, limit: 30000 };
    }
    if (kind === 'quiz') {
      const cat = game.gameType === 'quiz' ? game.cat : 'Blandat';
      const q = parseLine(draw('quiz:' + cat, () => pool(cat)));
      const alts = shuffle([q.right, ...q.wrong]);
      return { kind, data: { q: q.q, alts, cat }, secret: alts.indexOf(q.right), limit: 15000 };
    }
    if (kind === 'reaction') {
      const delay = rand(1500, 5000);
      return { kind, data: { delay }, limit: delay + 3000 };
    }
    if (kind === 'math') {
      const [text, ans] = mathProblem();
      return { kind, data: { text }, secret: ans, limit: 12000 };
    }
    if (kind === 'color') {
      const word = rand(0, 3);
      const ink = (word + rand(1, 3)) % 4; // färgen är aldrig samma som ordet
      return { kind, data: { word, ink }, secret: ink, limit: 5000 };
    }
    if (kind === 'typing') {
      return { kind, data: { text: draw('typing', () => window.PHRASES) }, limit: 20000 };
    }
    if (kind === 'estimate') {
      const [q, ans, unit] = draw('estimate', () => window.ESTIMATES);
      return { kind, data: { q, unit }, secret: ans, limit: 20000 };
    }
    if (kind === 'clicks') {
      return { kind, data: { countdown: 3000, duration: 5000 }, limit: 8000 };
    }
  }

  // Kontrollerar att ett svar är rimligt för rundans typ
  function validAnswer(kind, v) {
    if (kind === 'quiz' || kind === 'color') return Number.isInteger(v) && v >= 0 && v < 4;
    if (kind === 'reaction') return v === 'early' || v === 'ok';
    if (kind === 'math' || kind === 'estimate') return typeof v === 'number' && Number.isFinite(v);
    if (kind === 'typing') return v === true;
    if (kind === 'clicks') return Number.isInteger(v) && v >= 0 && v <= 120;
    if (kind === 'paint') return Array.isArray(v) && v.length <= 8 && v.every(isHex);
    if (kind === 'size') return typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= 3.5;
    if (kind === 'wordle') return v && typeof v.w === 'string' && v.w.length <= 10 && Number.isInteger(v.g) && v.g >= 1 && v.g <= 7;
    if (kind === 'word') return v && typeof v.w === 'string' && v.w.length <= 30 && Number.isInteger(v.h) && v.h >= 0 && v.h <= 20;
    return false;
  }

  // Räknar ut poäng och vad som ska stå bredvid varje spelare
  function scoreRound() {
    const r = game.current;
    const res = new Map();
    for (const p of game.players) {
      const a = game.answers.get(p.id);
      const frac = a ? clamp(1 - a.ms / r.limit, 0, 1) : 0;
      let pts = 0, detail = a ? '' : '—', metric = null;
      if (a) {
        if (r.kind === 'quiz' || r.kind === 'color' || r.kind === 'math') {
          const right = a.v === r.secret;
          pts = right ? 500 + Math.round(500 * frac) : 0;
          detail = r.kind === 'math' ? `svarade ${fmt(a.v)}` : right ? 'rätt' : 'fel';
        } else if (r.kind === 'reaction') {
          if (a.v === 'early') detail = 'Tjuvstart!';
          else { pts = clamp(Math.round(1000 - (a.ms - 200) * 2), 100, 1000); detail = `${a.ms} ms`; metric = -a.ms; }
        } else if (r.kind === 'typing') {
          pts = 300 + Math.round(700 * frac);
          detail = `${(a.ms / 1000).toFixed(2)} s`;
          metric = -a.ms;
        } else if (r.kind === 'estimate') {
          const err = Math.abs(a.v - r.secret) / Math.max(1, Math.abs(r.secret));
          pts = Math.round(1000 * Math.max(0, 1 - err * 2));
          detail = `gissade ${fmt(a.v)}`;
          metric = -err;
        } else if (r.kind === 'clicks') {
          pts = Math.min(1000, a.v * 20);
          detail = `${a.v} klick`;
          metric = a.v;
        } else if (r.kind === 'paint') {
          // Medel av hur nära varje del är den officiella färgen
          const acc = r.secret.reduce((sum, c, i) => sum + (a.v[i] ? colorAccuracy(a.v[i], c) : 0), 0) / r.secret.length;
          pts = Math.round(acc * acc * (500 + 500 * frac));
          detail = `${Math.round(acc * 100)} % exakt`;
          metric = acc;
        } else if (r.kind === 'size') {
          // Svaret är 10-logaritmen av gissat förhållande; 10 gånger fel = 0 poäng
          const err = Math.abs(a.v - Math.log10(r.secret));
          const acc = clamp(1 - err, 0, 1);
          pts = Math.round(acc * acc * (600 + 400 * frac));
          detail = `gissade ${ratioText(a.v)}`;
          metric = -err;
        } else if (r.kind === 'wordle') {
          if (a.v.g <= 6 && normalizeWord(a.v.w) === r.secret) {
            pts = Math.round((1000 - (a.v.g - 1) * 120) * (0.6 + 0.4 * frac));
            detail = `${a.v.g}/6 försök`;
            metric = -(a.v.g * 1e6 + a.ms);
          } else detail = 'klarade inte';
        } else if (r.kind === 'word') {
          if (normalizeWord(a.v.w) === r.secret) {
            pts = Math.max(100, 500 + Math.round(500 * frac) - 150 * a.v.h);
            detail = `${(a.ms / 1000).toFixed(1)} s` + (a.v.h ? `, ${a.v.h} ledtråd${a.v.h > 1 ? 'ar' : ''}` : '');
          } else detail = 'fel';
        }
      }
      res.set(p.id, { pts, detail, metric });
    }
    // Bonus till den som var bäst i rundan (när ni är flera)
    if (game.players.length > 1) {
      const metrics = [...res.values()].filter(x => x.metric !== null).map(x => x.metric);
      if (metrics.length) {
        const best = Math.max(...metrics);
        for (const x of res.values()) if (x.metric === best) { x.pts += 200; x.detail += ' ⭐'; }
      }
    }
    return res;
  }

  // ---------- Spellogik (körs hos värden eller ensamspelaren) ----------
  function countFor(type) {
    const counts = GAMES[type].counts;
    const saved = Number(load('quiz-count-' + type, 0));
    return counts.includes(saved) ? saved : counts[Math.min(1, counts.length - 1)];
  }

  function newGame(hostName) {
    const cats = categories();
    const savedCat = load('quiz-cat', 'Blandat');
    const savedType = load('quiz-game', 'quiz');
    const gameType = GAMES[savedType] ? savedType : 'quiz';
    game = {
      phase: 'lobby',
      players: [],
      gameType,
      cat: cats.includes(savedCat) ? savedCat : 'Blandat',
      count: countFor(gameType),
      kinds: [], n: 0, current: null, decks: {},
      answers: new Map(), results: new Map(),
      deadline: 0, revealUntil: 0,
    };
    addPlayer(0, hostName);
  }

  function addPlayer(id, name) {
    const used = game.players.map(p => p.color);
    game.players.push({ id, name, color: COLORS.find(c => !used.includes(c)) || COLORS[0], score: 0 });
    if (id !== myId) sfx.join();
  }

  function startGame() {
    if (game.gameType === 'quiz' && !pool(game.cat).length) return;
    if (game.gameType === 'mix') {
      // Slumpa spel, men aldrig samma två gånger i rad
      game.kinds = [];
      for (let i = 0; i < game.count; i++) {
        const options = MIX_KINDS.filter(k => k !== game.kinds[i - 1]);
        game.kinds.push(options[Math.floor(Math.random() * options.length)]);
      }
    } else {
      game.kinds = Array(game.count).fill(game.gameType);
    }
    if (game.gameType === 'quiz') game.kinds = game.kinds.slice(0, pool(game.cat).length);
    game.n = 0;
    game.decks = {};
    game.players.forEach(p => { p.score = 0; });
    nextRound();
  }

  function nextRound() {
    if (game.n >= game.kinds.length) {
      game.phase = 'final';
      return broadcast();
    }
    game.current = makeRound(game.kinds[game.n]);
    game.n++;
    game.answers = new Map();
    game.results = new Map();
    game.deadline = Date.now() + game.current.limit + GRACE;
    game.phase = 'round';
    broadcast();
  }

  const allAnswered = () => game.players.every(p => game.answers.has(p.id));

  function recordAnswer(id, a) {
    if (!game || game.phase !== 'round' || game.answers.has(id)) return;
    if (!game.players.some(p => p.id === id)) return;
    if (!validAnswer(game.current.kind, a.v)) return;
    const ms = clamp(Math.round(Number(a.ms) || 0), 0, game.current.limit);
    game.answers.set(id, { v: a.v, ms });
    if (allAnswered()) reveal();
    else broadcast();
  }

  function reveal() {
    game.phase = 'reveal';
    game.results = scoreRound();
    for (const p of game.players) p.score += game.results.get(p.id).pts;
    game.revealUntil = Date.now() + REVEAL_TIME;
    broadcast();
  }

  // Klockan hos värden: avslutar rundor och går vidare automatiskt
  setInterval(() => {
    if (!game) return;
    if (game.phase === 'round' && Date.now() >= game.deadline) reveal();
    else if (game.phase === 'reveal' && Date.now() >= game.revealUntil) nextRound();
  }, 200);

  function publicView() {
    const g = game;
    const revealed = g.phase === 'reveal';
    const r = g.current;
    return {
      phase: g.phase,
      gameType: g.gameType,
      cat: g.cat,
      count: g.count,
      cats: categories().map(c => [c, pool(c).length]),
      lan: lanInfo,
      n: g.n,
      total: g.kinds.length,
      game: r && r.game,
      kind: r && r.kind,
      data: r && r.data,
      limit: r && r.limit,
      result: revealed ? { secret: r.secret, explain: r.explain || '' } : null,
      remaining: g.phase === 'round' ? Math.max(0, g.deadline - Date.now()) : 0,
      revealLeft: revealed ? Math.max(0, g.revealUntil - Date.now()) : 0,
      players: g.players.map(p => {
        const a = g.answers.get(p.id);
        const res = revealed && g.results.get(p.id);
        return {
          id: p.id, name: p.name, color: p.color, score: p.score,
          answered: !!a,
          answer: revealed && a ? a.v : null,
          gained: res ? res.pts : 0,
          detail: res ? res.detail : '',
        };
      }),
    };
  }

  function broadcast() {
    if (!game) return;
    const v = publicView();
    if (mode === 'host') send({ t: 'state', v });
    render(v);
  }

  // ---------- Mina svar ----------
  function submit(v, msOverride) {
    if (!view || view.phase !== 'round' || !local || local.answer !== null) return;
    const ms = msOverride ?? Math.round(performance.now() - local.start);
    local.answer = { v, ms };
    if (mode === 'client') {
      send({ t: 'answer', v, ms });
      render(view);
    } else {
      recordAnswer(myId, { v, ms });
    }
  }
  const canControl = () => mode === 'solo' || mode === 'host';

  function primaryAction() {
    if (!canControl() || !game) return;
    if (game.phase === 'lobby') startGame();
    else if (game.phase === 'reveal') nextRound();
    else if (game.phase === 'final') { game.phase = 'lobby'; broadcast(); }
  }
  $('btnStart').onclick = primaryAction;
  $('btnNext').onclick = primaryAction;
  $('btnAgain').onclick = primaryAction;

  window.addEventListener('keydown', e => {
    if (['INPUT', 'TEXTAREA'].includes(e.target.tagName)) return;
    const kind = view && view.phase === 'round' ? view.kind : null;
    // Wordle tar emot bokstäver direkt från tangentbordet
    if (kind === 'wordle' && local && local.wordleKey && !e.ctrlKey && !e.altKey && !e.metaKey
      && (e.key === 'Enter' || e.key === 'Backspace' || /^[a-zåäöA-ZÅÄÖ]$/.test(e.key))) {
      e.preventDefault();
      local.wordleKey(e.key);
      return;
    }
    if (e.key >= '1' && e.key <= '4' && (kind === 'quiz' || kind === 'color')) submit(Number(e.key) - 1);
    if (e.code === 'Space' && (kind === 'reaction' || kind === 'clicks')) {
      e.preventDefault();
      if (!e.repeat && local && local.press) local.press();
    }
    if (e.key === 'Enter') { e.preventDefault(); primaryAction(); }
  });

  // ---------- Spelytan för varje typ av runda ----------
  // build() skapar innehållet en gång per runda, update() anpassar det efter svar och avslöjande.

  function choiceButtons(stage, labels, makeClass) {
    const box = el('div', 'answers');
    labels.forEach((label, i) => {
      const b = el('button', makeClass(i));
      const txt = el('span', 'txt');
      txt.append(el('span', '', label), el('span', 'who'));
      b.append(el('span', 'shape', SHAPES[i]), txt, el('span', 'key', String(i + 1)));
      b.onclick = () => submit(i);
      box.append(b);
    });
    stage.append(box);
    return box;
  }

  function updateChoices(box, v, revealed) {
    const me = v.players.find(p => p.id === myId);
    const mine = revealed && me && me.answer !== null ? me.answer : local.answer && local.answer.v;
    [...box.children].forEach((b, i) => {
      b.classList.toggle('picked', mine === i);
      b.classList.toggle('correct', revealed && i === v.result.secret);
      b.classList.toggle('dim', revealed ? i !== v.result.secret : local.answer !== null && mine !== i);
      b.querySelector('.who').textContent = revealed
        ? v.players.filter(p => p.answer === i).map(p => p.name).join(', ') : '';
    });
  }

  function numberInput(stage, placeholder) {
    const row = el('div', 'numrow');
    const input = el('input');
    input.type = 'number';
    input.inputMode = 'decimal';
    input.placeholder = placeholder;
    const btn = el('button', 'primary', 'Svara');
    const go = () => {
      const n = Number(input.value.replace(',', '.'));
      if (input.value.trim() === '' || !Number.isFinite(n)) return input.focus();
      submit(n);
    };
    btn.onclick = go;
    input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.stopPropagation(); go(); } });
    row.append(input, btn);
    stage.append(row);
    setTimeout(() => input.focus(), 30);
    return { input, btn };
  }

  const KINDS = {
    quiz: {
      build(stage, d) {
        const q = el('div', 'qtext' + (d.big ? ' emoji' : ''), d.q);
        if (d.flag !== undefined) {
          const f = window.FLAGS[d.flag];
          q.replaceChildren(flagSVG(f, f[2]).svg);
          stage.append(el('div', 'status', d.q));
        }
        stage.append(q);
        local.box = choiceButtons(stage, d.alts, i => `ans a${i}`);
      },
      update(stage, v, revealed) { updateChoices(local.box, v, revealed); },
    },

    color: {
      build(stage, d) {
        const box = el('div', 'bigbox neutral');
        box.style.minHeight = '200px';
        const word = el('div', 'stroop', INKS[d.word][0]);
        word.style.color = INKS[d.ink][1];
        box.append(word, el('small', '', 'Välj färgen som ordet är skrivet med!'));
        stage.append(box);
        local.box = choiceButtons(stage, INKS.map(c => c[0]), () => 'ans colorbtn');
      },
      update(stage, v, revealed) { updateChoices(local.box, v, revealed); },
    },

    reaction: {
      build(stage, d) {
        const box = el('div', 'bigbox wait');
        box.append(el('div', '', 'Vänta på grönt…'), el('small', '', 'Klicka eller tryck mellanslag när rutan blir grön'));
        stage.append(box);
        local.big = box;
        local.greenAt = local.start + d.delay;
        local.press = () => {
          const now = performance.now();
          if (now < local.greenAt) submit('early', 0);
          else submit('ok', Math.round(now - local.greenAt));
        };
        box.addEventListener('pointerdown', local.press);
      },
      tick(now) {
        if (local.answer === null && now >= local.greenAt && !local.turned) {
          local.turned = true;
          local.big.className = 'bigbox go';
          local.big.replaceChildren(el('div', '', 'KLICKA NU!'));
          sfx.go();
        }
      },
      update(stage, v, revealed) {
        if (local.answer === null && !revealed) return;
        local.big.className = 'bigbox neutral';
        const a = local.answer;
        const text = !a ? 'För sent!' : a.v === 'early' ? 'Tjuvstart! 😬' : `${a.ms} ms`;
        local.big.replaceChildren(el('div', '', text), el('small', '', revealed ? '' : 'Väntar på de andra…'));
      },
    },

    math: {
      build(stage, d) {
        stage.append(el('div', 'qtext', `${d.text} = ?`));
        local.num = numberInput(stage, 'Ditt svar');
        local.info = el('div', 'status');
        stage.append(local.info);
      },
      update(stage, v, revealed) {
        const locked = local.answer !== null || revealed;
        local.num.input.disabled = locked;
        local.num.btn.disabled = locked;
        local.info.textContent = revealed ? `Rätt svar: ${fmt(v.result.secret)}` : '';
      },
    },

    estimate: {
      build(stage, d) {
        stage.append(el('div', 'qtext', d.q));
        local.num = numberInput(stage, d.unit ? `Din gissning (${d.unit})` : 'Din gissning');
        local.info = el('div', 'status');
        stage.append(local.info);
      },
      update(stage, v, revealed) {
        const locked = local.answer !== null || revealed;
        local.num.input.disabled = locked;
        local.num.btn.disabled = locked;
        local.info.textContent = revealed ? `Rätt svar: ${fmt(v.result.secret)} ${v.data.unit}` : '';
      },
    },

    typing: {
      build(stage, d) {
        const box = el('div', 'bigbox neutral');
        box.style.minHeight = '160px';
        local.target = el('div', 'typetarget');
        box.append(local.target, el('small', '', 'Skriv exakt det här så snabbt du kan'));
        stage.append(box);
        const input = el('input');
        input.autocomplete = 'off';
        input.spellcheck = false;
        input.placeholder = 'Börja skriva här…';
        input.style.fontSize = '22px';
        input.addEventListener('paste', e => e.preventDefault());
        input.addEventListener('input', () => {
          paintTyping(d.text, input.value);
          if (normalize(input.value) === normalize(d.text)) submit(true);
        });
        stage.append(input);
        local.input = input;
        paintTyping(d.text, '');
        setTimeout(() => input.focus(), 30);
      },
      update(stage, v, revealed) {
        local.input.disabled = local.answer !== null || revealed;
      },
    },

    clicks: {
      build(stage, d) {
        const box = el('div', 'bigbox neutral');
        stage.append(box);
        local.big = box;
        local.count = 0;
        local.goAt = local.start + d.countdown;
        local.endAt = local.goAt + d.duration;
        local.press = () => {
          const now = performance.now();
          if (now >= local.goAt && now < local.endAt && local.answer === null) {
            local.count++;
            sfx.click();
            local.big.firstChild.textContent = String(local.count);
          }
        };
        box.addEventListener('pointerdown', local.press);
      },
      tick(now) {
        if (local.answer !== null) return;
        if (now < local.goAt) {
          const s = Math.ceil((local.goAt - now) / 1000);
          if (local.shown !== s) {
            local.shown = s;
            sfx.tick();
            local.big.className = 'bigbox neutral';
            local.big.replaceChildren(el('div', '', `${s}…`), el('small', '', 'Gör dig redo att klicka!'));
          }
        } else if (now < local.endAt) {
          if (local.shown !== 'go') {
            local.shown = 'go';
            sfx.go();
            local.big.className = 'bigbox clicker';
            local.big.replaceChildren(el('div', '', '0'), el('small', '', 'KLICKA! (eller mellanslag)'));
          }
          const left = ((local.endAt - now) / 1000).toFixed(1);
          local.big.lastChild.textContent = `KLICKA! ${left} s kvar`;
        } else {
          submit(local.count, Math.round(local.endAt - local.start));
        }
      },
      update(stage, v, revealed) {
        if (local.answer === null && !revealed) return;
        local.big.className = 'bigbox neutral';
        const n = local.answer ? local.answer.v : local.count;
        local.big.replaceChildren(el('div', '', `${n} klick`), el('small', '', revealed ? '' : 'Väntar på de andra…'));
      },
    },

    // Flaggfärger: välj en del av flaggan och ställ in exakt färg med färghjulet
    paint: {
      build(stage, d) {
        const flag = window.FLAGS[d.flag];
        stage.append(el('div', 'qtext', `Måla flaggan för ${flag[0]}!`));
        local.colors = [...d.start];
        local.sel = 0;

        const area = el('div', 'flagarea');
        const mineBox = el('div', 'flagbox');
        const drawn = flagSVG(flag, local.colors, i => { if (local.answer === null) select(i); });
        local.drawn = drawn;
        mineBox.append(drawn.svg, el('div', 'flaglabel', 'Klicka på en del av flaggan och välj färg i hjulet'));
        area.append(mineBox);

        const picker = el('div', 'picker');
        const SIZE = 220;
        const canvas = el('canvas', 'wheel');
        canvas.width = canvas.height = SIZE;
        const side = el('div', 'pickside');
        const slider = el('input', 'bright');
        slider.type = 'range'; slider.min = 0; slider.max = 100;
        const preview = el('div', 'preview');
        const hexLabel = el('div', 'hexlabel');
        const partList = el('div', 'partlist');
        side.append(el('div', 'flaglabel', 'Ljusstyrka'), slider, preview, hexLabel, el('div', 'flaglabel', 'Delar'), partList);
        picker.append(canvas, side);
        area.append(picker);
        stage.append(area);
        local.area = area; local.picker = picker; local.mine = mineBox;

        const done = el('button', 'primary', 'Klar!');
        done.onclick = () => submit([...local.colors]);
        stage.append(done);
        local.done = done;

        // Färghjul: vinkeln är nyans, avståndet från mitten är mättnad. Reglaget styr ljusstyrka.
        const ctx = canvas.getContext('2d');
        let hsv = [0, 0, 1];
        let cache = null, cacheV = -1;
        const drawWheel = () => {
          if (cacheV !== hsv[2]) {
            cache = ctx.createImageData(SIZE, SIZE);
            const R = SIZE / 2;
            for (let y = 0; y < SIZE; y++) {
              for (let x = 0; x < SIZE; x++) {
                const dx = x - R + 0.5, dy = y - R + 0.5, r = Math.hypot(dx, dy);
                const o = (y * SIZE + x) * 4;
                if (r > R) continue;
                const [cr, cg, cb] = hsvToRgb((Math.atan2(dy, dx) * 180 / Math.PI + 360) % 360, r / R, hsv[2]);
                cache.data[o] = cr; cache.data[o + 1] = cg; cache.data[o + 2] = cb;
                cache.data[o + 3] = r > R - 1 ? 128 : 255;
              }
            }
            cacheV = hsv[2];
          }
          ctx.putImageData(cache, 0, 0);
          const a = hsv[0] * Math.PI / 180, rr = hsv[1] * SIZE / 2;
          ctx.beginPath();
          ctx.arc(SIZE / 2 + Math.cos(a) * rr, SIZE / 2 + Math.sin(a) * rr, 8, 0, Math.PI * 2);
          ctx.lineWidth = 3;
          ctx.strokeStyle = hsv[2] > 0.6 ? '#000' : '#fff';
          ctx.stroke();
        };
        const paintParts = () => {
          partList.replaceChildren();
          local.colors.forEach((c, i) => {
            const b = el('button', 'partchip' + (i === local.sel ? ' on' : ''), String(i + 1));
            b.style.setProperty('--sw', c);
            b.onclick = () => select(i);
            partList.append(b);
          });
          drawn.parts.forEach((g, i) => {
            if (i === local.sel && local.answer === null) {
              g.setAttribute('stroke', '#ffffff');
              g.setAttribute('stroke-width', '5');
              g.setAttribute('stroke-dasharray', '12 7');
            } else g.removeAttribute('stroke');
          });
        };
        const showColor = hex => {
          preview.style.background = hex;
          hexLabel.textContent = hex;
          slider.style.background = `linear-gradient(to right, #000, ${rgbToHex(hsvToRgb(hsv[0], hsv[1], 1))})`;
        };
        const apply = () => {
          const hex = rgbToHex(hsvToRgb(...hsv));
          local.colors[local.sel] = hex;
          drawn.parts[local.sel].setAttribute('fill', hex);
          showColor(hex);
          paintParts();
          drawWheel();
        };
        const select = i => {
          local.sel = i;
          hsv = rgbToHsv(hexToRgb(local.colors[i]));
          slider.value = Math.round(hsv[2] * 100);
          showColor(local.colors[i]);
          paintParts();
          drawWheel();
        };
        const pick = e => {
          const r = canvas.getBoundingClientRect();
          const R = r.width / 2;
          const dx = e.clientX - r.left - R, dy = e.clientY - r.top - R;
          hsv = [(Math.atan2(dy, dx) * 180 / Math.PI + 360) % 360, Math.min(1, Math.hypot(dx, dy) / R), hsv[2]];
          apply();
        };
        canvas.addEventListener('pointerdown', e => {
          if (local.answer !== null) return;
          canvas.setPointerCapture(e.pointerId);
          local.dragging = true;
          pick(e);
        });
        canvas.addEventListener('pointermove', e => { if (local.dragging) pick(e); });
        canvas.addEventListener('pointerup', () => { local.dragging = false; });
        slider.addEventListener('input', () => { hsv[2] = slider.value / 100; apply(); });
        local.paintParts = paintParts;
        select(0);
      },
      update(stage, v, revealed) {
        const locked = local.answer !== null || revealed;
        local.picker.style.display = locked ? 'none' : '';
        local.done.style.display = locked ? 'none' : '';
        if (locked) local.paintParts();
        local.mine.lastChild.textContent = locked ? 'Din flagga' : 'Klicka på en del av flaggan och välj färg i hjulet';
        if (revealed && !local.shownAnswer) {
          local.shownAnswer = true;
          const f = window.FLAGS[v.data.flag];
          const box = el('div', 'flagbox');
          box.append(flagSVG(f, v.result.secret).svg, el('div', 'flaglabel', 'Rätt flagga'));
          local.area.append(box);
          // Jämförelse del för del
          const list = el('div', 'compare');
          v.result.secret.forEach((c, i) => {
            const mine = local.colors[i];
            const row = el('div', 'cmprow');
            const a = el('span', 'cmpsw'); a.style.background = mine;
            const b = el('span', 'cmpsw'); b.style.background = c;
            row.append(el('span', '', `Del ${i + 1}`), a, el('span', 'hexlabel', mine), el('span', '', '→'), b,
              el('span', 'hexlabel', c), el('b', '', `${Math.round(colorAccuracy(mine, c) * 100)} %`));
            list.append(row);
          });
          stage.insertBefore(list, local.done);
        }
      },
    },

    // Size it up: dra i reglaget tills storleksförhållandet ser rätt ut
    size: {
      build(stage, d) {
        const [ea, na] = d.a, [eb, nb] = d.b;
        stage.append(el('div', 'qtext', `Hur stor är ${nb} jämfört med ${na}?`));
        const scene = el('div', 'sizescene');
        const mk = (emoji, name) => {
          const box = el('div', 'sizeobj');
          const em = el('div', 'sizeemoji', emoji);
          box.append(el('div', 'sizestage', ''), el('div', 'flaglabel', capFirst(name)));
          box.firstChild.append(em);
          scene.append(box);
          return em;
        };
        const emA = mk(ea, na), emB = mk(eb, nb);
        stage.append(scene);
        const label = el('div', 'verdict sizelabel');
        const slider = el('input', 'sizeslider');
        slider.type = 'range'; slider.min = -300; slider.max = 300; slider.value = 0;
        const hint = el('div', 'hint', '← mindre   ·   dra i reglaget   ·   större →');
        const done = el('button', 'primary', 'Klar!');
        const info = el('div', 'status');
        stage.append(label, slider, hint, done, info);
        local.size = { emA, emB, label, slider, hint, done, info, nb };
        const paint = logv => {
          setSizes(emA, emB, logv);
          label.textContent = `${capFirst(nb)} är ${ratioText(logv)}`;
        };
        slider.addEventListener('input', () => paint(slider.value / 100));
        done.onclick = () => submit(Number(slider.value) / 100);
        paint(0);
      },
      update(stage, v, revealed) {
        const s = local.size;
        const locked = local.answer !== null || revealed;
        s.slider.disabled = locked;
        s.done.style.display = locked ? 'none' : '';
        s.hint.style.display = locked ? 'none' : '';
        if (local.answer !== null && !revealed) s.info.textContent = 'Gissning inlämnad!';
        if (revealed && !s.shown) {
          s.shown = true;
          const real = Math.log10(v.result.secret);
          setSizes(s.emA, s.emB, real);
          s.label.textContent = `Rätt svar: ${s.nb} är ${ratioText(real)}`;
          const mine = local.answer ? `Du gissade ${ratioText(local.answer.v)}. ` : '';
          s.info.textContent = mine + v.result.explain;
        }
      },
    },

    // Wordle: gissa ordet på fem bokstäver, grönt = rätt plats, gult = finns i ordet
    wordle: {
      build(stage, d) {
        const answer = decodeWord(d.code);
        local.guesses = [];
        local.cur = '';
        const grid = el('div', 'wgrid');
        for (let r = 0; r < 6; r++) {
          const row = el('div', 'wrow');
          for (let c = 0; c < 5; c++) row.append(el('span', 'wtile'));
          grid.append(row);
        }
        stage.append(grid);
        local.msg = el('div', 'status');
        stage.append(local.msg);

        const kb = el('div', 'keyboard');
        const keyEls = {};
        for (const line of ['QWERTYUIOPÅ', 'ASDFGHJKLÖÄ', '⏎ZXCVBNM⌫']) {
          const row = el('div', 'krow');
          for (const ch of line) {
            const k = el('button', 'key' + (ch === '⏎' || ch === '⌫' ? ' wide' : ''), ch === '⏎' ? 'Gissa' : ch);
            k.onclick = () => local.wordleKey(ch === '⏎' ? 'Enter' : ch === '⌫' ? 'Backspace' : ch);
            keyEls[ch] = k;
            row.append(k);
          }
          kb.append(row);
        }
        stage.append(kb);
        local.kb = kb;

        const evaluate = guess => {
          const res = Array(5).fill('x');
          const left = {};
          for (let i = 0; i < 5; i++) {
            if (guess[i] === answer[i]) res[i] = 'g';
            else left[answer[i]] = (left[answer[i]] || 0) + 1;
          }
          for (let i = 0; i < 5; i++) {
            if (res[i] !== 'g' && left[guess[i]] > 0) { res[i] = 'y'; left[guess[i]]--; }
          }
          return res;
        };
        const rank = { x: 1, y: 2, g: 3 };
        const paintRow = () => {
          const row = grid.children[local.guesses.length];
          if (!row) return;
          [...row.children].forEach((t, i) => { t.textContent = local.cur[i] || ''; t.classList.toggle('filled', !!local.cur[i]); });
        };
        local.wordleKey = key => {
          if (local.answer !== null || !view || view.phase !== 'round') return;
          local.msg.textContent = '';
          if (key === 'Enter') {
            if (local.cur.length < 5) {
              local.msg.textContent = 'Ordet måste ha fem bokstäver';
              const row = grid.children[local.guesses.length];
              row.classList.remove('shake'); void row.offsetWidth; row.classList.add('shake');
              return;
            }
            const guess = local.cur;
            const res = evaluate(guess);
            const row = grid.children[local.guesses.length];
            [...row.children].forEach((t, i) => { t.classList.add('w' + res[i]); t.style.animationDelay = i * 0.08 + 's'; });
            res.forEach((s, i) => {
              const k = keyEls[guess[i]];
              if (k && (rank[s] > (rank[k.dataset.s] || 0))) { k.dataset.s = s; k.className = 'key k' + s; }
            });
            local.guesses.push(guess);
            local.cur = '';
            if (guess === answer) submit({ w: guess, g: local.guesses.length });
            else if (local.guesses.length >= 6) submit({ w: guess, g: 7 });
            return;
          }
          if (key === 'Backspace') local.cur = local.cur.slice(0, -1);
          else if (/^[A-ZÅÄÖ]$/.test(key.toUpperCase()) && local.cur.length < 5) local.cur += key.toUpperCase();
          paintRow();
        };
      },
      update(stage, v, revealed) {
        const locked = local.answer !== null || revealed;
        local.kb.classList.toggle('locked', locked);
        if (local.answer && !revealed) {
          local.msg.textContent = local.answer.v.g <= 6 ? `Löst på ${local.answer.v.g} försök! 🎉 Väntar på de andra…` : 'Slut på försök…';
        }
        if (revealed) local.msg.textContent = `Ordet var: ${v.result.secret}`;
      },
    },

    // Kryptoordet och Ordjakten: skriv ordet, få ledtrådar om du kör fast
    word: {
      build(stage, d) {
        const answer = decodeWord(d.code);
        local.word = answer;
        local.hints = 0;
        if (d.clue) {
          stage.append(el('div', 'qtext cryptic', d.clue));
        } else {
          const tiles = el('div', 'tiles');
          for (const ch of d.letters) tiles.append(el('span', 'tile', ch));
          stage.append(tiles);
        }
        const boxes = el('div', 'tiles slots');
        for (let i = 0; i < d.len; i++) boxes.append(el('span', 'tile slot', ''));
        stage.append(boxes);
        local.slots = boxes;

        const row = el('div', 'numrow');
        const input = el('input');
        input.autocomplete = 'off';
        input.spellcheck = false;
        input.maxLength = d.len + 5;
        input.placeholder = `Ditt svar (${d.len} bokstäver)`;
        input.style.textTransform = 'uppercase';
        const guess = el('button', 'primary', 'Gissa');
        const hint = el('button', 'blue', 'Ledtråd −150');
        row.append(input, guess);
        stage.append(row, hint);
        local.input = input; local.guess = guess; local.hint = hint;
        local.msg = el('div', 'status');
        stage.append(local.msg);
        local.explain = el('div', 'hint');
        stage.append(local.explain);

        const paintSlots = () => {
          const typed = normalizeWord(input.value);
          [...boxes.children].forEach((s, i) => {
            s.textContent = i < local.hints ? answer[i] : typed[i] || '';
            s.classList.toggle('given', i < local.hints);
          });
        };
        input.addEventListener('input', () => { local.msg.textContent = ''; input.classList.remove('shake'); paintSlots(); });
        const go = () => {
          const w = normalizeWord(input.value);
          if (!w) return input.focus();
          if (w === answer) submit({ w, h: local.hints });
          else {
            local.msg.textContent = 'Inte rätt – försök igen!';
            input.classList.remove('shake');
            void input.offsetWidth;
            input.classList.add('shake');
          }
        };
        guess.onclick = go;
        input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.stopPropagation(); go(); } });
        hint.onclick = () => {
          if (local.hints < answer.length - 1) { local.hints++; paintSlots(); }
          input.focus();
        };
        paintSlots();
        setTimeout(() => input.focus(), 30);
      },
      update(stage, v, revealed) {
        const locked = local.answer !== null || revealed;
        local.input.disabled = locked;
        local.guess.disabled = locked;
        local.hint.disabled = locked;
        if (local.answer !== null && !revealed) local.msg.textContent = 'Rätt! 🎉';
        if (revealed) {
          [...local.slots.children].forEach((s, i) => { s.textContent = v.result.secret[i]; });
          local.msg.textContent = `Svaret var: ${v.result.secret}`;
          local.explain.textContent = v.result.explain;
        }
      },
    },
  };

  // Den största saken ritas 170 px hög, den mindre i proportion (minst en liten prick)
  function setSizes(emA, emB, logv) {
    const big = 170;
    const r = 10 ** logv;
    const sa = r >= 1 ? big / r : big, sb = r >= 1 ? big : big * r;
    emA.style.fontSize = Math.max(3, sa) + 'px';
    emB.style.fontSize = Math.max(3, sb) + 'px';
  }

  function paintTyping(target, typed) {
    const box = local.target;
    box.replaceChildren();
    let i = 0;
    while (i < typed.length && i < target.length && typed[i].toLowerCase() === target[i].toLowerCase()) i++;
    const ok = el('span', 'ok', target.slice(0, i));
    const wrongLen = Math.min(Math.max(0, typed.length - i), target.length - i);
    const bad = el('span', 'bad', target.slice(i, i + wrongLen));
    box.append(ok, bad, document.createTextNode(target.slice(i + wrongLen)));
  }

  // ---------- Ritning ----------
  function renderBoard(container, players, showGain) {
    container.replaceChildren();
    [...players].sort((a, b) => b.score - a.score).forEach((p, i) => {
      const line = el('div', 'line' + (p.id === myId ? ' me' : ''));
      line.style.setProperty('--c', p.color);
      line.append(el('span', 'pos', `${i + 1}.`), el('span', 'name', p.name));
      if (showGain && p.detail) line.append(el('span', 'detail', p.detail));
      if (showGain && p.gained) line.append(el('span', 'gain', `+${p.gained}`));
      line.append(el('span', 'pts', fmt(p.score)));
      container.append(line);
    });
  }

  function renderLobby(v) {
    show('lobby');
    $('lobbyTitle').textContent = mode === 'solo' ? 'Spela ensam' : 'Lobby';
    $('addrCard').style.display = v.lan ? '' : 'none';
    if (v.lan && v.lan.code) {
      $('addrTitle').textContent = 'Kompisarna öppnar samma sida, skriver in rumskoden och klickar "Gå med"';
      $('addrText').textContent = `Rumskod: ${v.lan.code}`;
    } else if (v.lan) {
      const port = v.lan.port !== DEFAULT_PORT ? ':' + v.lan.port : '';
      const ips = v.lan.ips.length ? v.lan.ips : ['localhost'];
      $('addrText').textContent = ips.slice(0, 3).map(ip => ip + port).join('  eller  ');
    }
    $('playerCount').textContent = mode === 'solo' ? 'Spelare' : `Spelare (${v.players.length}/${MAX_PLAYERS})`;
    const list = $('lobbyPlayers');
    list.replaceChildren();
    for (const p of v.players) {
      const chip = el('span', 'chip', p.name + (p.id === myId ? ' (du)' : ''));
      chip.style.setProperty('--c', p.color);
      list.append(chip);
    }

    const games = $('games');
    games.replaceChildren();
    for (const [type, g] of Object.entries(GAMES)) {
      const b = el('button', type === v.gameType ? 'on' : '');
      b.append(el('span', 'gicon', g.icon), el('span', 'gname', g.name), el('span', 'gdesc', g.desc));
      b.disabled = !canControl() && type !== v.gameType;
      b.onclick = () => {
        if (!canControl()) return;
        game.gameType = type;
        game.count = countFor(type);
        store('quiz-game', type);
        broadcast();
      };
      games.append(b);
    }

    $('catBox').style.display = v.gameType === 'quiz' ? '' : 'none';
    const cats = $('cats');
    cats.replaceChildren();
    for (const [c, size] of v.cats) {
      const b = el('button', c === v.cat ? 'on' : '', `${c} (${size})`);
      b.disabled = !canControl() && c !== v.cat;
      b.onclick = () => { if (!canControl()) return; game.cat = c; store('quiz-cat', c); broadcast(); };
      cats.append(b);
    }
    const counts = $('counts');
    counts.replaceChildren();
    for (const n of GAMES[v.gameType].counts) {
      const b = el('button', n === v.count ? 'on' : '', String(n));
      b.disabled = !canControl() && n !== v.count;
      b.onclick = () => { if (!canControl()) return; game.count = n; store('quiz-count-' + game.gameType, n); broadcast(); };
      counts.append(b);
    }

    const size = (v.cats.find(([c]) => c === v.cat) || [0, 0])[1];
    $('btnStart').style.display = canControl() ? '' : 'none';
    $('btnStart').disabled = v.gameType === 'quiz' && size === 0;
    $('lobbyInfo').textContent = mode === 'client'
      ? 'Väntar på att värden startar…'
      : mode === 'host' && v.players.length === 1 ? 'Väntar på kompisar… Starta när alla är med.' : '';
  }

  function verdictFor(v, me) {
    if (!me) return ['', ''];
    if (me.gained > 0) {
      const head = { quiz: 'Rätt!', color: 'Rätt!', math: 'Rätt!', word: 'Rätt!', estimate: 'Bra gissat!', size: 'Bra uppskattat!', paint: me.detail.replace(' ⭐', '') + '!' }[v.kind]
        || me.detail.replace(' ⭐', '');
      return [`${head} +${me.gained}`, 'good'];
    }
    if (!me.answered) return ['Tiden tog slut!', 'bad'];
    if (me.detail === 'Tjuvstart!') return ['Tjuvstart!', 'bad'];
    if (v.kind === 'estimate' || v.kind === 'size') return ['Långt ifrån!', 'bad'];
    if (v.kind === 'clicks') return ['0 klick…', 'bad'];
    if (v.kind === 'paint') return ['Långt ifrån rätt färger!', 'bad'];
    if (v.kind === 'wordle') return ['Inte den här gången!', 'bad'];
    return ['Fel svar!', 'bad'];
  }

  function renderRound(v, fresh) {
    show('question');
    const me = v.players.find(p => p.id === myId);
    const revealed = v.phase === 'reveal';
    const g = GAMES[v.game];
    $('qNum').textContent = `Runda ${v.n}/${v.total}`;
    $('qCat').textContent = `${g.icon} ${g.name}${v.game === 'quiz' ? ' · ' + v.data.cat : ''}`;

    const stage = $('stage');
    if (fresh) {
      stage.replaceChildren();
      KINDS[v.kind].build(stage, v.data);
    }
    KINDS[v.kind].update(stage, v, revealed);

    const verdict = $('verdict');
    const [text, cls] = revealed ? verdictFor(v, me) : ['', ''];
    verdict.className = 'verdict ' + cls;
    verdict.textContent = text;

    const answered = v.players.filter(p => p.answered).length;
    let status = '';
    if (!revealed && mode !== 'solo') {
      status = local.answer !== null
        ? `Klart! Väntar på de andra… (${answered}/${v.players.length})`
        : `${answered}/${v.players.length} är klara`;
    }
    if (revealed && !canControl()) status = v.n >= v.total ? 'Resultatet kommer snart…' : 'Nästa runda kommer snart…';
    $('qStatus').textContent = status;

    const board = $('revealBoard');
    if (revealed) renderBoard(board, v.players, true);
    else board.replaceChildren();
    $('nextRow').style.display = revealed && canControl() ? '' : 'none';
    $('btnNext').textContent = v.n >= v.total ? 'Visa resultat (Enter)' : 'Nästa runda (Enter)';
  }

  function renderFinal(v) {
    show('final');
    const sorted = [...v.players].sort((a, b) => b.score - a.score);
    const podium = $('podium');
    podium.replaceChildren();
    const places = [[1, 120, '🥈'], [0, 160, '🥇'], [2, 90, '🥉']];
    for (const [idx, h, medal] of places) {
      const p = sorted[idx];
      if (!p) continue;
      const step = el('div', 'step');
      step.append(el('div', 'pname', p.name), el('div', '', fmt(p.score)));
      const block = el('div', 'block', medal);
      block.style.height = h + 'px';
      block.style.background = p.color;
      step.append(block);
      podium.append(step);
    }
    renderBoard($('finalBoard'), v.players, false);
    $('btnAgain').style.display = canControl() ? '' : 'none';
    $('finalInfo').textContent = canControl() ? '' : 'Väntar på att värden startar en ny omgång…';
  }

  function render(v) {
    const prev = view;
    view = v;
    const same = prev && prev.phase === v.phase && prev.n === v.n;
    const freshRound = v.phase === 'round' && !same;
    if (freshRound) {
      local = { start: performance.now(), answer: null, lastTick: 0 };
      sfx.start();
    }
    if (v.phase === 'round') deadline = performance.now() + Math.max(0, v.remaining - GRACE);
    if (v.phase === 'reveal') {
      revealDeadline = performance.now() + v.revealLeft;
      if (!local) local = { start: 0, answer: null }; // gick med mitt i en runda
      if (!same) {
        const me = v.players.find(p => p.id === myId);
        if (me && me.gained > 0) sfx.good(); else sfx.bad();
      }
    }
    if (v.phase === 'final' && !same) sfx.win();

    if (v.phase === 'lobby') renderLobby(v);
    else if (v.phase === 'round' || v.phase === 'reveal') {
      // Bygg om spelytan vid ny runda, eller om man kommer in mitt i ett avslöjande
      const needBuild = freshRound || (v.phase === 'reveal' && (!prev || prev.n !== v.n));
      renderRound(v, needBuild);
    } else if (v.phase === 'final') renderFinal(v);
  }

  // Tidsstapel och tidsstyrda spel animeras lokalt
  function frame() {
    if (view && $('question').classList.contains('active')) {
      const now = performance.now();
      if (view.phase === 'round') {
        const left = Math.max(0, deadline - now);
        $('timerFill').style.width = (left / view.limit * 100) + '%';
        $('timer').classList.toggle('low', left < 3000);
        const secs = Math.ceil(left / 1000);
        $('qTime').textContent = `⏱ ${secs}`;
        const kind = KINDS[view.kind];
        if (kind.tick && local) kind.tick(now);
        const timed = ['quiz', 'math', 'estimate', 'typing', 'paint', 'word', 'wordle', 'size'].includes(view.kind);
        if (timed && secs <= 5 && secs > 0 && secs !== local.lastTick && local.answer === null) { local.lastTick = secs; sfx.tick(); }
      } else {
        $('timerFill').style.width = '0%';
        const left = Math.ceil(Math.max(0, revealDeadline - now) / 1000);
        $('qTime').textContent = left ? `Vidare om ${left}` : '';
      }
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
