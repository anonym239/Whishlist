// Liefert die Seite für einen Listen-Link (/abc123) aus und setzt dabei eine passende
// Link-Vorschau (Titel, Text, Bild) für WhatsApp, Telegram, iMessage usw.
import { getStore } from '@netlify/blobs';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const OCC = { Geburtstag: '🎂', Weihnachten: '🎄', Hochzeit: '💍', Sonstiges: '🎁' };

export default async (req, context) => {
  const url = new URL(req.url);
  const res = await fetch(new URL('/index.html', url.origin));
  let html = await res.text();
  const slug = String(context.params?.slug || '').toLowerCase();
  if (/^[a-z0-9]{6,12}$/.test(slug)) {
    try {
      const w = await getStore('wishlist').get('w:' + slug, { type: 'json' });
      if (w) {
        const items = (w.items || []).filter(i => !i.got);
        const pick = [...items].sort((a, b) => (b.top ? 1 : 0) - (a.top ? 1 : 0) || (b.pri || 0) - (a.pri || 0))
          .find(i => /^https?:\/\//i.test(i.img || '') || /^\/img\/[a-f0-9]{32}$/.test(i.img || ''));
        const img = pick ? new URL(pick.img, url.origin).href : url.origin + '/og.png';
        const [, m, d] = String(w.bd || '').split('-');
        const title = `Wunschliste von ${w.name} ${OCC[w.occasion] || '🎁'}`;
        const desc = `${w.occasion}${d ? ` am ${+d}.${+m}.` : ''} · ${items.length} ${items.length === 1 ? 'Wunsch' : 'Wünsche'} – schau rein und reserviere, was du schenken möchtest.`;
        const meta = `<!--og-->
<meta property="og:type" content="website">
<meta property="og:site_name" content="Wunschliste">
<meta property="og:url" content="${esc(url.origin + '/' + slug)}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:image" content="${esc(img)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="description" content="${esc(desc)}">
<!--/og-->`;
        html = html.replace(/<!--og-->[\s\S]*?<!--\/og-->/, meta).replace(/<title>[^<]*<\/title>/, `<title>${esc(title)}</title>`);
      }
    } catch { /* bei Fehlern einfach die normale Seite ausliefern */ }
  }
  return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=0, must-revalidate' } });
};

export const config = { path: '/:slug', excludedPath: ['/api', '/img/*'], preferStatic: true };
