import { JSDOM } from 'jsdom';
import createDOMPurify from 'dompurify';

export function sanitizeSvg(bytes) {
  const source = Buffer.from(bytes ?? []).toString('utf8');
  if (!source.trim() || source.length > 20 * 1024 * 1024) return null;
  const window = new JSDOM('').window;
  try {
    const purifier = createDOMPurify(window);
    purifier.addHook('uponSanitizeAttribute', (_node, data) => {
      const name = data.attrName.toLowerCase();
      if (name.startsWith('on') || name === 'style') data.keepAttr = false;
      if ((name === 'href' || name === 'xlink:href') && !data.attrValue.startsWith('#')) data.keepAttr = false;
      if (/url\s*\(/i.test(data.attrValue) && !/^url\(#[A-Za-z0-9_.:-]+\)$/i.test(data.attrValue.trim())) data.keepAttr = false;
    });
    const clean = purifier.sanitize(source, {
      USE_PROFILES: { svg: true, svgFilters: true },
      ADD_TAGS: ['use'],
      ADD_ATTR: ['href', 'xlink:href'],
      FORBID_TAGS: ['script', 'style', 'foreignObject', 'iframe', 'object', 'embed', 'audio', 'video', 'image'],
      FORBID_ATTR: ['style', 'xml:base'],
    });
    const document = new window.DOMParser().parseFromString(clean, 'image/svg+xml');
    if (document.querySelector('parsererror') || document.documentElement.localName !== 'svg') return null;
    return Buffer.from(new window.XMLSerializer().serializeToString(document.documentElement));
  } finally {
    window.close();
  }
}
