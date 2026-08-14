import type { ParsedDocument } from '../document-import.mjs';
import type { MediaStore } from '../ports/media-store';

export async function localizeDocumentMedia(
  document: ParsedDocument,
  store: MediaStore,
  download: (url: string) => Promise<{ bytes: Uint8Array; mimeType: string } | null>,
): Promise<ParsedDocument> {
  let body = document.body;
  const localized = [];
  for (const media of Array.isArray(document.mediaRefs) ? document.mediaRefs : []) {
    const mediaUrl = typeof media.url === 'string' ? media.url : '';
    let downloaded = null;
    try { downloaded = media.type === 'img' ? await download(mediaUrl) : null; } catch {}
    if (!downloaded) { localized.push({ ...media, local: false }); continue; }
    let stored;
    try { stored = await store.put(downloaded); }
    catch { localized.push({ ...media, local: false }); continue; }
    body = body.replaceAll(mediaUrl, stored.url).replaceAll(mediaUrl.replaceAll('&', '&amp;'), stored.url);
    localized.push({ ...media, originalUrl: mediaUrl, ...stored, local: true });
  }
  return { ...document, body, mediaRefs: localized };
}
