// Liefert hochgeladene Fotos aus (getrennt von der Liste gespeichert)
import { getStore } from '@netlify/blobs';

export default async (req, context) => {
  const key = context.params?.key || new URL(req.url).pathname.split('/').pop();
  if (!/^[a-f0-9]{32}$/.test(key)) return new Response('Nicht gefunden', { status: 404 });
  const r = await getStore('images').getWithMetadata(key, { type: 'arrayBuffer' });
  if (!r) return new Response('Nicht gefunden', { status: 404 });
  return new Response(r.data, { headers: {
    'content-type': /^image\/(jpeg|png|webp|gif)$/.test(r.metadata?.type) ? r.metadata.type : 'image/jpeg',
    'cache-control': 'public, max-age=31536000, immutable', 'x-content-type-options': 'nosniff' } });
};

export const config = { path: '/img/:key' };
