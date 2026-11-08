// Backend: Netlify Function + Netlify Blobs (kostenlos, kein API-Key, keine externe DB)
import { getStore } from '@netlify/blobs';
import { scryptSync, randomBytes, timingSafeEqual, createHash } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

// ---------- Produktbild aus einem Shop-Link erkennen ----------
// Nur öffentliche Adressen abrufen (keine internen Server/IPs)
const privateIp = ip => {
  if (isIP(ip) === 6) { const l = ip.toLowerCase(); if (l.startsWith('::ffff:')) return privateIp(l.slice(7)); return l === '::1' || l === '::' || /^f[cd]/.test(l) || /^fe[89ab]/.test(l); }
  const [a, b] = ip.split('.').map(Number);
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
};
const safeUrl = async raw => {
  let u; try { u = new URL(raw); } catch { return null; }
  if (!/^https?:$/.test(u.protocol) || u.username || u.password || (u.port && !['80', '443'].includes(u.port))) return null;
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (/^localhost$|\.local$|\.internal$/i.test(host)) return null;
  try { const r = isIP(host) ? [{ address: host }] : await lookup(host, { all: true }); if (!r.length || r.some(x => privateIp(x.address))) return null; } catch { return null; }
  return u;
};
const decode = t => t.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").replace(/&#x2F;/gi, '/').replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim();
const findImage = (html, base) => {
  const abs = v => { try { const u = new URL(decode(v), base); return /^https?:$/.test(u.protocol) ? u.href : ''; } catch { return ''; } };
  // 1. og:image / twitter:image (Attribut-Reihenfolge egal)
  for (const m of html.matchAll(/<meta\b[^>]*>/gi)) {
    const tag = m[0], key = (tag.match(/(?:property|name|itemprop)\s*=\s*["']([^"']+)["']/i) || [])[1]?.toLowerCase();
    if (['og:image', 'og:image:url', 'og:image:secure_url', 'twitter:image', 'twitter:image:src', 'image'].includes(key)) {
      const c = (tag.match(/content\s*=\s*"([^"]+)"/i) || tag.match(/content\s*=\s*'([^']+)'/i) || [])[1];
      const r = c && abs(c); if (r) return r;
    }
  }
  // 2. Strukturierte Produktdaten (JSON-LD)
  for (const m of html.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    const im = m[1].match(/"image"\s*:\s*(?:\[\s*)?(?:\{[^}]*?"url"\s*:\s*)?"([^"]+)"/i);
    const r = im && abs(im[1].replace(/\\\//g, '/')); if (r) return r;
  }
  // 3. <link rel="image_src">, Amazon-Hauptbild
  const l = html.match(/<link[^>]*rel\s*=\s*["']image_src["'][^>]*href\s*=\s*["']([^"']+)["']/i) || html.match(/data-old-hires\s*=\s*"([^"]+)"/i) || html.match(/id="landingImage"[^>]*src="([^"]+)"/i);
  return l ? abs(l[1]) : '';
};
const fetchProductImage = async raw => {
  let u = await safeUrl(raw); if (!u) return '';
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 7000);
  try {
    let res;
    for (let hop = 0; hop < 4; hop++) { // Weiterleitungen einzeln prüfen
      res = await fetch(u, { redirect: 'manual', signal: ctl.signal, headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36', accept: 'text/html,application/xhtml+xml', 'accept-language': 'de-DE,de;q=0.9' } });
      if (res.status >= 300 && res.status < 400 && res.headers.get('location')) { u = await safeUrl(new URL(res.headers.get('location'), u).href); if (!u) return ''; continue; }
      break;
    }
    if (!res.ok || !/html/i.test(res.headers.get('content-type') || '')) return '';
    // höchstens 1,5 MB lesen
    const reader = res.body.getReader(), parts = []; let size = 0;
    while (size < 1500000) { const { done, value } = await reader.read(); if (done) break; parts.push(value); size += value.length; }
    reader.cancel().catch(() => {});
    const html = new TextDecoder().decode(Buffer.concat(parts));
    const img = findImage(html, u.href);
    return img.length <= 1000 ? img : '';
  } catch { return ''; } finally { clearTimeout(t); }
};

const J = (o, s = 200) => Response.json(o, { status: s });
const str = (v, n) => String(v ?? '').trim().slice(0, n);
const http = u => /^https?:\/\//i.test(u || '');
const isDate = s => /^\d{4}-\d{2}-\d{2}$/.test(s || '');
const hash = (v, salt) => scryptSync(String(v), salt, 32);
const same = (hex, v, salt) => timingSafeEqual(Buffer.from(hex, 'hex'), hash(v, salt));
const rnd = n => randomBytes(n).toString('hex');
const sha = v => createHash('sha256').update(String(v)).digest('hex');
// Kurzer Code zum Aufheben auf einem anderen Gerät (ohne leicht verwechselbare Zeichen)
const ABC = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const mkCode = () => Array.from(randomBytes(6), b => ABC[b % ABC.length]).join('');
const normCode = c => String(c ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12);
const DAY = 86400000, SESSION_MS = 30 * DAY;
// Jedes Zubehör braucht eine feste Kennung (älteres Zubehör hatte keine) – immer gleich berechnet
const okX = v => Number.isSafeInteger(Number(v)) && Number(v) > 0;
const fixX = i => (i.extras || []).map((x, k) => ({ ...x, xid: okX(x.xid) ? Number(x.xid) : Number(i.id) * 100 + k }));
const isImg = u => http(u) || /^\/img\/[a-f0-9]{32}$/.test(u || '') || /^data:image\//.test(u || '');

// Was Gäste sehen dürfen (geheime Schlüssel nie herausgeben, bekommene Wünsche ausblenden)
const forGuests = w => ({ ...w, items: w.items.filter(i => !i.got).map(({ rk, rc, rv, got, ...i }) => ({ ...i,
  parts: (i.parts || []).map(({ rk, rc, ...p }) => p), extras: (i.extras || []).map(({ rk, rc, rv, ...x }) => x) })) });
// Was der Besitzer sieht (keine Reservierungen – die Überraschung bleibt)
const forOwner = w => ({ ...w, items: w.items.map(({ res, by, rk, rc, rv, parts, ...i }) => ({ ...i, extras: (i.extras || []).map(({ res, by, rk, rc, rv, ...x }) => x) })) });

// Hochgeladene Fotos getrennt ablegen (Liste bleibt klein und schnell)
const storeImg = async u => {
  if (!/^data:image\//.test(u || '')) return isImg(u) ? u : '';
  const m = u.match(/^data:(image\/(?:jpeg|png|webp|gif));base64,([a-z0-9+/=]+)$/i); if (!m) return '';
  const buf = Buffer.from(m[2], 'base64'); if (!buf.length || buf.length > 600000) return '';
  const key = sha(u).slice(0, 32);
  await getStore('images').set(key, buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length), { metadata: { type: m[1] } });
  return '/img/' + key;
};

// Schutz gegen Passwort-Raten: nach zu vielen Fehlversuchen kurz sperren
const MAX_EMAIL = 5, MAX_IP = 20, LOCK_MS = 15 * 60 * 1000;
const mins = ms => Math.max(1, Math.ceil(ms / 60000));

export default async (req, context) => {
  if (req.method !== 'POST') return J({ error: 'Nur POST' }, 405);
  let d; try { d = await req.json(); } catch { return J({ error: 'Ungültige Anfrage' }, 400); }
  const st = getStore('wishlist'), a = d.action;

  // Einmalige Aufräum-Aktion (vom Betreiber gewünscht): alle Reservierungen und Anteile auf allen Listen aufheben.
  // Läuft genau einmal beim ersten Aufruf nach dem Update; die Wünsche selbst bleiben unverändert.
  const MIG = 'mig:reset-reservations-2026-11-08';
  if (!(await st.get(MIG))) {
    const { blobs } = await st.list({ prefix: 'w:' }); let changed = 0;
    for (const b of blobs) {
      const w = await st.get(b.key, { type: 'json' }); if (!w) continue; let ch = false;
      for (const i of w.items || []) {
        if (i.res || i.parts?.length || i.by || i.rk) ch = true;
        ['by', 'rk', 'rc', 'rv', 'parts'].forEach(k => delete i[k]); i.res = false;
        for (const x of i.extras || []) { if (x.res || x.by) ch = true; ['by', 'rk', 'rc', 'rv'].forEach(k => delete x[k]); x.res = false; }
      }
      if (ch) { await st.setJSON(b.key, w); changed++; }
    }
    await st.setJSON(MIG, { at: new Date().toISOString(), lists: blobs.length, changed });
    console.log(`[aufräumen] Alle Reservierungen aufgehoben: ${changed} von ${blobs.length} Listen geändert`);
  }
  // ältere Einträge (erste Version) automatisch ergänzen
  const getW = async s => { const w = await st.get('w:' + str(s, 12), { type: 'json' }); if (w) { w.occasion ||= 'Geburtstag'; w.items = (w.items || []).map(i => ({ pri: 0, res: false, ...i, extras: fixX(i) })); } return w; };
  const getU = async e => { const u = await st.get('u:' + str(e, 120).toLowerCase(), { type: 'json' }); if (u && !u.lists) u.lists = u.slug ? [u.slug] : []; return u; };
  const login = async email => { const token = rnd(24); await st.setJSON('s:' + token, { email, exp: Date.now() + SESSION_MS }); return token; };
  // Anmeldung prüfen: läuft nach 30 Tagen ohne Nutzung ab (ältere Anmeldungen werden umgestellt)
  const session = async tk => {
    if (!/^[a-f0-9]{48}$/.test(tk)) return null;
    const raw = await st.get('s:' + tk); if (!raw) return null;
    let s; try { s = raw.startsWith('{') ? JSON.parse(raw) : { email: raw, exp: 0 }; } catch { return null; }
    const now = Date.now();
    if (s.exp && s.exp < now) { await st.delete('s:' + tk); return null; }
    if (!s.exp || s.exp - now < SESSION_MS / 2) await st.setJSON('s:' + tk, { email: s.email, exp: now + SESSION_MS });
    return s.email;
  };
  const ip = context?.ip || req.headers.get('x-nf-client-connection-ip') || 'unbekannt';
  // Liefert Minuten bis zur Entsperrung (0 = nicht gesperrt)
  const lockedFor = async keys => { const now = Date.now(); for (const k of keys) { const f = await st.get('f:' + k, { type: 'json' }); if (f?.until > now) return mins(f.until - now); } return 0; };
  // Zählt einen Fehlversuch im 15-Minuten-Fenster, gibt verbleibende Versuche zurück
  const failed = async (k, max) => { const now = Date.now(); let f = await st.get('f:' + k, { type: 'json' });
    if (!f || now - f.first > LOCK_MS || (f.until && f.until <= now)) f = { n: 0, first: now, until: 0 };
    f.n++; if (f.n >= max) f.until = now + LOCK_MS; await st.setJSON('f:' + k, f); return max - f.n; };
  const guard = async email => { const m = await lockedFor(['e:' + email, 'ip:' + ip]); return m ? J({ error: `Zu viele Fehlversuche. Bitte in ${m} Minute${m > 1 ? 'n' : ''} nochmal versuchen.`, locked: m }, 429) : null; };
  const wrong = async (email, msg) => { const left = await failed('e:' + email, MAX_EMAIL); await failed('ip:' + ip, MAX_IP);
    if (left <= 0) return J({ error: `Zu viele Fehlversuche. Bitte in ${mins(LOCK_MS)} Minuten nochmal versuchen.`, locked: mins(LOCK_MS) }, 429);
    return J({ error: msg + (left <= 3 ? ` (noch ${left} Versuch${left > 1 ? 'e' : ''})` : '') }, 401); };

  // ---------- öffentlich ----------
  if (a === 'ping') return J({ ok: true });

  // Produktbild zu einem Shop-Link suchen (leise: bei Fehler einfach leer)
  if (a === 'ogimg') return J({ img: http(d.url) ? await fetchProductImage(str(d.url, 1000)) : '' });

  if (a === 'get') {
    const w = await getW(d.slug);
    return w ? J(forGuests(w)) : J({ error: 'Liste nicht gefunden' }, 404);
  }

  // Gäste: reservieren (ganzer Wunsch oder einzelnes Zubehör) und zusammenlegen.
  // Wer reserviert, bekommt einen geheimen Schlüssel – nur damit lässt sich die Reservierung wieder aufheben.
  if (a === 'guest' || a === 'reserve') {
    const w = await getW(d.slug); if (!w) return J({ error: 'Liste nicht gefunden' }, 404);
    const it = w.items.find(i => i.id === Number(d.id) && !i.got); if (!it) return J({ error: 'Wunsch nicht gefunden' }, 404);
    const op = a === 'reserve' ? 'res' : d.op, key = str(d.key, 64), by = str(d.by, 30), done = async o => { await st.setJSON('w:' + w.slug, w); return J({ ok: true, ...o }); };
    // Zubehör nur über seine Kennung – fehlt sie, niemals stattdessen den ganzen Wunsch reservieren
    const t = 'xid' in d ? (okX(d.xid) ? (it.extras || []).find(x => x.xid === Number(d.xid)) : null) : it;
    if (!t) return J({ error: 'Zubehör nicht gefunden' }, 404);
    // Schlüssel (gleiches Gerät) oder Code (anderes Gerät) prüfen; falsche Codes zählen als Fehlversuch
    const code = normCode(d.code);
    const proven = async (rk, rc) => {
      if (rk && key && sha(key) === rk) return true;
      if (rc && code) { const m = await lockedFor(['ip:' + ip]); if (m) return false; if (sha(code) === rc) return true; await failed('ip:' + ip, MAX_IP); }
      return false;
    };
    const denied = msg => J({ error: code ? 'Der Code stimmt nicht' : msg, needCode: true }, 403);
    if (op === 'res') {
      if (d.on) {
        if (t.res) return J({ error: 'Das hat gerade schon jemand reserviert' }, 409);
        if (t === it && it.parts?.length) return J({ error: 'Hier wird schon zusammengelegt – gib einfach auch etwas dazu' }, 409);
        delete t.rk; delete t.rc; delete t.rv; t.res = true; if (by) t.by = by; else delete t.by;
        if (a === 'reserve') return done(); // alte Seitenversion: ohne Schutz, damit sie wieder aufgehoben werden kann
        const k = rnd(16), c = mkCode(); t.rk = sha(k); t.rc = sha(c); t.rv = 2;
        return done({ key: k, code: c });
      }
      if (!t.res) return J({ ok: true });
      // Geschützt sind nur Reservierungen mit Code (rv 2); ältere lassen sich wie früher aufheben
      if (t.rv === 2 && !(await proven(t.rk, t.rc))) return denied('Nur wer reserviert hat, kann die Reservierung aufheben – mit dem Code geht es auch auf einem anderen Gerät');
      t.res = false; delete t.by; delete t.rk; delete t.rc; delete t.rv; return done();
    }
    if (op === 'chip' && t === it) {
      it.parts ||= [];
      if (d.on) {
        if (it.res) return J({ error: 'Das hat schon jemand komplett reserviert' }, 409);
        const amt = Math.round(Number(String(d.amt ?? '').replace(',', '.')) * 100) / 100;
        if (!(amt >= 1 && amt <= 10000)) return J({ error: 'Bitte einen Betrag zwischen 1 und 10.000 € angeben' }, 400);
        if (it.parts.length >= 30) return J({ error: 'Es geben schon sehr viele etwas dazu' }, 400);
        const k = rnd(16), c = mkCode(), pid = rnd(4); it.parts.push({ pid, amt, ...(by ? { by } : {}), rk: sha(k), rc: sha(c) });
        return done({ key: k, pid, code: c });
      }
      let p = it.parts.find(p => p.pid === str(d.pid, 8) && key && sha(key) === p.rk);
      if (!p && code) { p = it.parts.find(p => p.rc && sha(code) === p.rc); if (!p && !(await lockedFor(['ip:' + ip]))) await failed('ip:' + ip, MAX_IP); }
      if (!p) return denied('Nur wer etwas dazugegeben hat, kann es zurücknehmen – mit dem Code geht es auch auf einem anderen Gerät');
      it.parts = it.parts.filter(x => x !== p); return done();
    }
    return J({ error: 'Unbekannte Aktion' }, 400);
  }

  if (a === 'register') {
    const email = str(d.email, 120).toLowerCase(), name = str(d.name, 40), bd = str(d.bd, 10), pw = String(d.pw ?? '');
    const q = str(d.q, 120), qa = str(d.qa, 120).toLowerCase(), occ = str(d.occasion, 30) || 'Geburtstag';
    if (!/^.+@.+\..+$/.test(email) || !name || !isDate(bd) || pw.length < 6 || !q || !qa)
      return J({ error: 'Bitte alle Felder ausfüllen (Passwort min. 6 Zeichen)' }, 400);
    if (await getU(email)) return J({ error: 'E-Mail ist schon registriert' }, 409);
    const salt = rnd(16), qsalt = rnd(16), slug = rnd(5);
    await st.setJSON('u:' + email, { email, salt, hash: hash(pw, salt).toString('hex'), q, qsalt, qhash: hash(qa, qsalt).toString('hex'), lists: [slug] });
    await st.setJSON('w:' + slug, { slug, name, bd, occasion: occ, items: [] });
    return J({ token: await login(email), slug });
  }

  if (a === 'login') {
    const em = str(d.email, 120).toLowerCase(), stop = await guard(em); if (stop) return stop;
    const u = await getU(em);
    if (!u || !same(u.hash, d.pw ?? '', u.salt)) return wrong(em, 'E-Mail oder Passwort falsch');
    await st.delete('f:e:' + em);
    return J({ token: await login(u.email), slug: u.lists[0] });
  }

  // Passwort vergessen: Sicherheitsfrage holen, dann mit Antwort neues Passwort setzen
  if (a === 'resetq') {
    const u = await getU(d.email);
    if (!u) return J({ error: 'E-Mail nicht gefunden' }, 404);
    return u.q ? J({ q: u.q }) : J({ error: 'Für dieses Konto ist keine Sicherheitsfrage hinterlegt' }, 400);
  }
  if (a === 'reset') {
    const em = str(d.email, 120).toLowerCase(), stop = await guard(em); if (stop) return stop;
    const u = await getU(em); if (!u) return J({ error: 'E-Mail nicht gefunden' }, 404);
    if (!u.qhash) return J({ error: 'Für dieses Konto ist keine Sicherheitsfrage hinterlegt' }, 400);
    if (!same(u.qhash, str(d.qa, 120).toLowerCase(), u.qsalt)) return wrong(em, 'Antwort ist falsch');
    await st.delete('f:e:' + em);
    if (String(d.pw ?? '').length < 6) return J({ error: 'Neues Passwort: min. 6 Zeichen' }, 400);
    u.salt = rnd(16); u.hash = hash(d.pw, u.salt).toString('hex');
    await st.setJSON('u:' + u.email, u);
    return J({ token: await login(u.email), slug: u.lists[0] });
  }

  if (a === 'logout') { const tk = str(d.token, 64); if (/^[a-f0-9]{48}$/.test(tk)) await st.delete('s:' + tk); return J({ ok: true }); }

  // ---------- ab hier angemeldet ----------
  const email = await session(str(d.token, 64));
  const u = email && await getU(email);
  if (!u) return J({ error: 'Nicht angemeldet' }, 401);
  const slug = str(d.slug, 12), owns = (u.lists || []).includes(slug);

  if (a === 'me') {
    const lists = [];
    for (const s of u.lists || []) { const w = await getW(s); if (w) lists.push({ slug: s, name: w.name, bd: w.bd, occasion: w.occasion, count: w.items.length }); }
    return J({ lists });
  }

  if (a === 'newlist') {
    const name = str(d.name, 40), bd = str(d.bd, 10), occ = str(d.occasion, 30) || 'Geburtstag';
    if (!name || !isDate(bd)) return J({ error: 'Bitte Name und Datum angeben' }, 400);
    if ((u.lists || []).length >= 10) return J({ error: 'Maximal 10 Listen' }, 400);
    const s = rnd(5);
    await st.setJSON('w:' + s, { slug: s, name, bd, occasion: occ, items: [] });
    u.lists = [...(u.lists || []), s]; await st.setJSON('u:' + u.email, u);
    return J({ slug: s });
  }

  if (!owns) return J({ error: 'Keine Berechtigung' }, 403);
  const w = await getW(slug); if (!w) return J({ error: 'Liste nicht gefunden' }, 404);

  if (a === 'getown') return J(forOwner(w)); // Reservierungen bleiben geheim

  if (a === 'save') {
    const old = new Map(w.items.map(i => [i.id, i]));
    const keep = o => o ? { res: !!o.res, ...(o.by ? { by: o.by } : {}), ...(o.rk ? { rk: o.rk } : {}), ...(o.rc ? { rc: o.rc } : {}), ...(o.rv ? { rv: o.rv } : {}) } : { res: false };
    const items = [];
    for (const i of (Array.isArray(d.items) ? d.items : []).slice(0, 100)) {
      const id = Number(i.id) || Date.now(), o = old.get(id), oldX = new Map((o?.extras || []).map(x => [x.xid, x]));
      const extras = [];
      for (const [k, x] of (Array.isArray(i.extras) ? i.extras : []).slice(0, 8).entries()) {
        if (!str(x?.title, 80)) continue;
        const xid = okX(x.xid) ? Number(x.xid) : id * 100 + k;
        extras.push({ xid, title: str(x.title, 80), why: str(x.why, 60), price: str(x.price, 20), link: http(x.link) ? str(x.link, 1000) : '',
          img: String(x.img || '').length < 300000 ? await storeImg(x.img) : '', ...keep(oldX.get(xid)) });
      }
      items.push({
        id, title: str(i.title, 120), price: str(i.price, 20),
        pri: Math.max(0, Math.min(5, Number(i.pri) || 0)), top: !!i.top, got: !!i.got, note: str(i.note, 140), extras,
        link: http(i.link) ? str(i.link, 1000) : '',
        img: String(i.img || '').length < 700000 ? await storeImg(i.img) : '',
        ...keep(o), ...(o?.parts?.length ? { parts: o.parts } : {})
      });
    }
    w.items = items;
    await st.setJSON('w:' + slug, w);
    // Bild-Adressen zurückgeben, damit die Seite keine Fotos doppelt hochlädt
    return J({ ok: true, items: items.map(i => ({ id: i.id, img: i.img, extras: i.extras.map(x => ({ xid: x.xid, img: x.img })) })) });
  }

  // Neue Runde: bekommene Wünsche entfernen, alle Reservierungen zurücksetzen
  if (a === 'newround') {
    w.items = w.items.filter(i => !i.got).map(({ res, by, rk, rc, rv, parts, ...i }) => ({ ...i, res: false, extras: (i.extras || []).map(({ res, by, rk, rc, rv, ...x }) => ({ ...x, res: false })) }));
    await st.setJSON('w:' + slug, w);
    return J({ ok: true });
  }

  if (a === 'meta') {
    if (d.name) w.name = str(d.name, 40);
    if (isDate(d.bd)) w.bd = d.bd;
    if (d.occasion) w.occasion = str(d.occasion, 30);
    await st.setJSON('w:' + slug, w);
    return J({ ok: true });
  }

  if (a === 'dellist') {
    if (u.lists.length <= 1) return J({ error: 'Die letzte Liste kann nicht gelöscht werden' }, 400);
    await st.delete('w:' + slug);
    u.lists = u.lists.filter(x => x !== slug); await st.setJSON('u:' + u.email, u);
    return J({ ok: true, slug: u.lists[0] });
  }

  return J({ error: 'Unbekannte Aktion' }, 400);
};

export const config = { path: '/api' };
