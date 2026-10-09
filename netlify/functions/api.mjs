// Backend: Netlify Function + Netlify Blobs (kostenlos, kein API-Key, keine externe DB)
import { getStore } from '@netlify/blobs';
import { scryptSync, randomBytes, timingSafeEqual } from 'node:crypto';

const J = (o, s = 200) => Response.json(o, { status: s });
const str = (v, n) => String(v ?? '').trim().slice(0, n);
const http = u => /^https?:\/\//i.test(u);

export default async req => {
  if (req.method !== 'POST') return J({ error: 'Nur POST' }, 405);
  let d; try { d = await req.json(); } catch { return J({ error: 'Ungültige Anfrage' }, 400); }
  const st = getStore('wishlist'), a = d.action;
  const me = async () => {
    const e = await st.get('s:' + str(d.token, 64));
    return e ? st.get('u:' + e, { type: 'json' }) : null;
  };

  if (a === 'ping') return J({ ok: true });

  if (a === 'get') {
    const w = await st.get('w:' + str(d.slug, 12), { type: 'json' });
    return w ? J(w) : J({ error: 'Liste nicht gefunden' }, 404);
  }
  if (a === 'me') {
    const u = await me();
    return u ? J({ slug: u.slug }) : J({ error: 'Nicht angemeldet' }, 401);
  }
  if (a === 'save') {
    const u = await me(); if (!u) return J({ error: 'Nicht angemeldet' }, 401);
    const w = await st.get('w:' + u.slug, { type: 'json' });
    w.items = (Array.isArray(d.items) ? d.items : []).slice(0, 100).map(i => ({
      id: Number(i.id) || Date.now(),
      title: str(i.title, 120),
      price: str(i.price, 20),
      link: http(i.link) ? str(i.link, 1000) : '',
      img: (http(i.img) || /^data:image\//.test(i.img || '')) && String(i.img).length < 700000 ? i.img : ''
    }));
    await st.setJSON('w:' + u.slug, w);
    return J({ ok: true });
  }
  if (a === 'register') {
    const email = str(d.email, 120).toLowerCase(), name = str(d.name, 40), bd = str(d.bd, 10), pw = String(d.pw ?? '');
    if (!/^.+@.+\..+$/.test(email) || !name || !/^\d{4}-\d{2}-\d{2}$/.test(bd) || pw.length < 6)
      return J({ error: 'Bitte Name, Geburtstag, gültige E-Mail und Passwort (min. 6 Zeichen) angeben' }, 400);
    if (await st.get('u:' + email)) return J({ error: 'E-Mail ist schon registriert' }, 409);
    const salt = randomBytes(16).toString('hex'), slug = randomBytes(5).toString('hex'), token = randomBytes(24).toString('hex');
    await st.setJSON('u:' + email, { email, slug, salt, hash: scryptSync(pw, salt, 32).toString('hex') });
    await st.setJSON('w:' + slug, { slug, name, bd, items: [] });
    await st.set('s:' + token, email);
    return J({ token, slug });
  }
  if (a === 'login') {
    const u = await st.get('u:' + str(d.email, 120).toLowerCase(), { type: 'json' });
    const ok = u && timingSafeEqual(Buffer.from(u.hash, 'hex'), scryptSync(String(d.pw ?? ''), u.salt, 32));
    if (!ok) return J({ error: 'E-Mail oder Passwort falsch' }, 401);
    const token = randomBytes(24).toString('hex');
    await st.set('s:' + token, u.email);
    return J({ token, slug: u.slug });
  }
  return J({ error: 'Unbekannte Aktion' }, 400);
};

export const config = { path: '/api' };
