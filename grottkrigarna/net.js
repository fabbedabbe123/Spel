// Direktkoppling mellan webbläsare (WebRTC via PeerJS) med rumskoder.
// Används när spelen körs som webbsida, t.ex. på GitHub Pages, där det inte finns någon egen server.
// Värdens webbläsare gör samma jobb som relay.js: den delar ut id:n och skickar spelläget till alla.
// Objekten som skapas här beter sig som en WebSocket mot relay.js, så spelkoden behöver nästan inte ändras.
(() => {
  const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // inga I/O som kan förväxlas med 1/0
  const randomCode = () => Array.from({ length: 4 }, () => LETTERS[Math.floor(Math.random() * LETTERS.length)]).join('');
  const cleanCode = s => String(s || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4);

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

    const open = attempt => {
      code = randomCode();
      peer = new window.Peer(`${game}-${code}`.toLowerCase());
      peer.on('open', () => {
        sock.readyState = 1;
        sock.onopen && sock.onopen();
      });
      peer.on('error', err => {
        // Koden var upptagen: prova en ny
        if (err.type === 'unavailable-id' && attempt < 5) { peer.destroy(); open(attempt + 1); return; }
        if (sock.readyState === 1 && ['network', 'server-error', 'socket-error', 'socket-closed'].includes(err.type)) return;
        deliver(sock, { t: 'error', msg: 'Kunde inte skapa ett rum. Kolla att du har internet och försök igen.' });
      });
      peer.on('connection', conn => {
        conn.on('data', raw => {
          let m;
          try { m = JSON.parse(raw); } catch { return; }
          if (m.t === 'join') {
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
      for (const conn of friends.values()) if (conn.open) conn.send(data);
    };
    sock.close = () => {
      closed = true;
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
    const peer = new window.Peer();
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
    });
    peer.on('error', err => {
      if (err.type === 'peer-unavailable') deliver(sock, { t: 'error', msg: `Hittade inget spel med rumskoden ${code}. Kolla koden och att värden har skapat ett spel.` });
      else if (sock.readyState !== 1) deliver(sock, { t: 'error', msg: 'Kunde inte ansluta. Kolla att du har internet och försök igen.' });
      else lost();
    });
    sock.send = data => { if (conn && conn.open) conn.send(data); };
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
