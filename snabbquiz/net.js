// Direktkoppling mellan webbläsare (WebRTC via PeerJS) med rumskoder.
// Används när spelen körs som webbsida, t.ex. på GitHub Pages, där det inte finns någon egen server.
// Värdens webbläsare gör samma jobb som relay.js: den delar ut id:n och skickar spelläget till alla.
// Objekten som skapas här beter sig som en WebSocket mot relay.js, så spelkoden behöver nästan inte ändras.
(() => {
  const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // inga I/O som kan förväxlas med 1/0
  const randomCode = () => Array.from({ length: 4 }, () => LETTERS[Math.floor(Math.random() * LETTERS.length)]).join('');
  const cleanCode = s => String(s || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4);

  // Flera STUN-servrar hjälper de flesta hemma-/mobilnät att hitta varandra.
  // TURN-servrarna är reservvägen när en brandvägg stoppar direktkontakt (skolor, jobb, en del mobilnät).
  const PEER_OPTIONS = {
    debug: 0,
    config: {
      iceServers: [
        { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302', 'stun:stun.cloudflare.com:3478'] },
        { urls: ['turn:eu-0.turn.peerjs.com:3478', 'turn:us-0.turn.peerjs.com:3478'], username: 'peerjs', credential: 'peerjsp' },
      ],
      sdpSemantics: 'unified-plan',
    },
  };
  const newPeer = id => (id ? new window.Peer(id, PEER_OPTIONS) : new window.Peer(PEER_OPTIONS));

  // En värd vars flik hamnar i bakgrunden skulle annars frysa spelet för alla kompisar, eftersom webbläsare
  // stoppar requestAnimationFrame i dolda flikar. Så länge man är värd och fliken är dold tickar vi i stället
  // med en timer i en Web Worker (den stryps inte). Ensamspel och synliga flikar påverkas inte.
  let hosting = 0;
  let ticker = null;
  const nativeRAF = window.requestAnimationFrame.bind(window);
  const nativeCancel = window.cancelAnimationFrame.bind(window);
  const frames = new Map();
  let frameSeq = 0;
  window.requestAnimationFrame = cb => {
    const id = ++frameSeq;
    const entry = { cb, native: 0 };
    frames.set(id, entry);
    entry.native = nativeRAF(t => { if (frames.delete(id)) cb(t); });
    return id;
  };
  window.cancelAnimationFrame = id => {
    const entry = frames.get(id);
    if (entry) { nativeCancel(entry.native); frames.delete(id); }
  };
  const flushHiddenFrames = () => {
    if (hosting <= 0 || !document.hidden) return;
    const now = performance.now();
    for (const [id, entry] of [...frames]) {
      nativeCancel(entry.native);
      frames.delete(id);
      try { entry.cb(now); } catch (e) { console.error(e); }
    }
  };
  function startTicker() {
    if (ticker || typeof Worker !== 'function') return;
    try {
      const url = URL.createObjectURL(new Blob(['setInterval(function(){postMessage(0)},33)'], { type: 'text/javascript' }));
      ticker = new Worker(url);
      ticker.onmessage = flushHiddenFrames;
    } catch { ticker = null; }
  }
  function stopTicker() {
    if (ticker) { ticker.terminate(); ticker = null; }
  }

  function fakeSocket() {
    return { readyState: 0, onopen: null, onmessage: null, onclose: null };
  }
  const deliver = (sock, msg) => sock.onmessage && sock.onmessage({ data: typeof msg === 'string' ? msg : JSON.stringify(msg) });

  // Värden: skapar ett rum och tar emot kompisar
  function host(game, maxFriends) {
    const sock = fakeSocket();
    const friends = new Map();
    let nextId = 1;
    let peer = null;
    let code = '';
    let closed = false;
    let opened = false;
    let reconnectTimer = null;
    hosting++;
    startTicker();

    // Tappar värden kontakten med PeerJS-servern kan ingen ny kompis gå med.
    // Då kopplar vi upp oss igen i bakgrunden med samma rumskod; kompisar som redan är med påverkas inte.
    const keepRegistered = p => {
      clearTimeout(reconnectTimer);
      const tryOnce = n => {
        if (closed || peer !== p || p.destroyed || !p.disconnected) return;
        try { p.reconnect(); } catch {}
        reconnectTimer = setTimeout(() => tryOnce(n + 1), Math.min(2000 + n * 1000, 8000));
      };
      reconnectTimer = setTimeout(() => tryOnce(0), 400);
    };

    const open = attempt => {
      code = randomCode();
      const p = (peer = newPeer(`${game}-${code}`.toLowerCase()));
      p.on('open', () => {
        if (peer !== p) return;
        if (opened) return; // kom tillbaka efter en återanslutning: spelet behöver inte veta
        opened = true;
        sock.readyState = 1;
        sock.onopen && sock.onopen();
      });
      p.on('disconnected', () => { if (opened && !closed) keepRegistered(p); });
      p.on('error', err => {
        // Koden var upptagen: prova en ny
        if (!opened && err.type === 'unavailable-id' && attempt < 8) { p.destroy(); open(attempt + 1); return; }
        if (opened && ['network', 'server-error', 'socket-error', 'socket-closed', 'disconnected', 'unavailable-id'].includes(err.type)) return;
        deliver(sock, { t: 'error', msg: 'Kunde inte skapa ett rum. Kolla att du har internet och försök igen.' });
      });
      p.on('connection', conn => {
        conn.on('data', raw => {
          let m;
          try { m = JSON.parse(raw); } catch { return; }
          if (m.t === 'join') {
            if (conn.playerId) return; // redan med
            if (friends.size >= maxFriends) {
              conn.send(JSON.stringify({ t: 'error', msg: `Spelet är fullt (max ${maxFriends + 1} spelare).` }));
              setTimeout(() => conn.close(), 300);
              return;
            }
            conn.playerId = nextId++;
            friends.set(conn.playerId, conn);
            conn.send(JSON.stringify({ t: 'welcome', id: conn.playerId }));
            deliver(sock, { t: 'joined', id: conn.playerId, name: String(m.name || 'Kompis').slice(0, 12), cls: m.cls });
          } else if (conn.playerId && m.t !== 'joined' && m.t !== 'left') {
            deliver(sock, { ...m, id: conn.playerId });
          }
        });
        conn.on('close', () => {
          if (conn.playerId && friends.delete(conn.playerId) && !closed) deliver(sock, { t: 'left', id: conn.playerId });
        });
        conn.on('error', () => { try { conn.close(); } catch {} });
      });
    };

    sock.send = data => {
      let m = null;
      if (data.length < 200) { try { m = JSON.parse(data); } catch {} }
      if (m && m.t === 'host') {
        deliver(sock, { t: 'hosted', ips: [], port: 0, code });
        return;
      }
      // Allt annat från värden skickas vidare till alla kompisar
      for (const conn of friends.values()) if (conn.open) { try { conn.send(data); } catch {} }
    };
    sock.close = () => {
      if (closed) return;
      closed = true;
      clearTimeout(reconnectTimer);
      if (--hosting <= 0) { hosting = 0; stopTicker(); }
      sock.readyState = 3;
      for (const conn of friends.values()) { try { conn.send(JSON.stringify({ t: 'hostLeft' })); } catch {} }
      setTimeout(() => peer && peer.destroy(), 200);
    };
    open(0);
    return sock;
  }

  // Kompisen: går med i ett rum med en kod
  function join(game, rawCode) {
    const sock = fakeSocket();
    const code = cleanCode(rawCode);
    let conn = null;
    let done = false;
    const peer = newPeer();
    const lost = () => {
      if (done) return;
      done = true;
      sock.readyState = 3;
      sock.onclose && sock.onclose();
    };
    peer.on('open', () => {
      conn = peer.connect(`${game}-${code}`.toLowerCase(), { reliable: true });
      conn.on('open', () => {
        sock.readyState = 1;
        sock.onopen && sock.onopen();
      });
      conn.on('data', d => deliver(sock, d));
      conn.on('close', lost);
      conn.on('error', lost);
      // Brandväggen stoppade direktkontakten: säg det i stället för att bara vänta tills tiden går ut
      conn.on('iceStateChanged', st => {
        if (st === 'failed' && sock.readyState !== 1 && !done) {
          done = true;
          deliver(sock, { t: 'error', msg: 'Kunde inte koppla ihop er. Nätverket (t.ex. skolans eller jobbets wifi) kan blockera det. Prova samma wifi som värden eller en annan uppkoppling.' });
        }
      });
    });
    peer.on('error', err => {
      if (done) return;
      if (err.type === 'peer-unavailable') deliver(sock, { t: 'error', msg: `Hittade inget spel med rumskoden ${code}. Kolla koden och att värden har skapat ett spel.` });
      else if (sock.readyState !== 1) deliver(sock, { t: 'error', msg: 'Kunde inte ansluta. Kolla att du har internet och försök igen.' });
      else lost();
    });
    sock.send = data => { if (conn && conn.open) { try { conn.send(data); } catch {} } };
    sock.close = () => { done = true; sock.readyState = 3; setTimeout(() => peer.destroy(), 100); };
    return sock;
  }

  window.GameNet = {
    // Direktkoppling används i webbläsaren när PeerJS har laddats (inte i desktop-appen)
    online: !window.net && typeof window.Peer === 'function',
    host,
    join,
    cleanCode,
  };
})();
