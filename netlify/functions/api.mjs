// Backend: Netlify Function + Netlify Blobs (kostenlos, kein API-Key, keine externe DB)
import { getStore } from '@netlify/blobs';
import { scryptSync, randomBytes, timingSafeEqual } from 'node:crypto';
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

// Schutz gegen Passwort-Raten: nach zu vielen Fehlversuchen kurz sperren
const MAX_EMAIL = 5, MAX_IP = 20, LOCK_MS = 15 * 60 * 1000;
const mins = ms => Math.max(1, Math.ceil(ms / 60000));

export default async (req, context) => {
  if (req.method !== 'POST') return J({ error: 'Nur POST' }, 405);
  let d; try { d = await req.json(); } catch { return J({ error: 'Ungültige Anfrage' }, 400); }
  const st = getStore('wishlist'), a = d.action;
  // ältere Einträge (erste Version) automatisch ergänzen
  const getW = async s => { const w = await st.get('w:' + str(s, 12), { type: 'json' }); if (w) { w.occasion ||= 'Geburtstag'; w.items = (w.items || []).map(i => ({ pri: 0, res: false, ...i })); } return w; };
  const getU = async e => { const u = await st.get('u:' + str(e, 120).toLowerCase(), { type: 'json' }); if (u && !u.lists) u.lists = u.slug ? [u.slug] : []; return u; };
  const login = async email => { const token = rnd(24); await st.set('s:' + token, email); return token; };
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
    return w ? J(w) : J({ error: 'Liste nicht gefunden' }, 404);
  }

  // Gäste reservieren ein Geschenk (der Besitzer sieht das nicht)
  if (a === 'reserve') {
    const w = await getW(d.slug); if (!w) return J({ error: 'Liste nicht gefunden' }, 404);
    const it = w.items.find(i => i.id === Number(d.id)); if (!it) return J({ error: 'Wunsch nicht gefunden' }, 404);
    it.res = !!d.on;
    if (it.res) { const by = str(d.by, 30); if (by) it.by = by; else delete it.by; } else delete it.by; // Name ist freiwillig
    await st.setJSON('w:' + w.slug, w);
    return J({ ok: true });
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

  // ---------- ab hier angemeldet ----------
  const email = await st.get('s:' + str(d.token, 64));
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

  if (a === 'getown') return J({ ...w, items: w.items.map(({ res, by, ...i }) => i) }); // Reservierungen bleiben geheim

  if (a === 'save') {
    const old = new Map(w.items.map(i => [i.id, i]));
    w.items = (Array.isArray(d.items) ? d.items : []).slice(0, 100).map(i => {
      const id = Number(i.id) || Date.now();
      return {
        id, title: str(i.title, 120), price: str(i.price, 20),
        pri: Math.max(0, Math.min(5, Number(i.pri) || 0)), top: !!i.top, note: str(i.note, 140),
        link: http(i.link) ? str(i.link, 1000) : '',
        img: (http(i.img) || /^data:image\//.test(i.img || '')) && String(i.img).length < 700000 ? i.img : '',
        res: !!old.get(id)?.res, ...(old.get(id)?.by ? { by: old.get(id).by } : {})
      };
    });
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
