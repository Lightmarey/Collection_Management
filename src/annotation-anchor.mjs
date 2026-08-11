const DEFAULT_CONTEXT_LENGTH = 32;

function asText(value) {
  return typeof value === 'string' ? value : value == null ? '' : String(value);
}

function asOffset(value, fallback = 0) {
  const offset = Number(value);
  return Number.isFinite(offset) ? Math.max(0, Math.trunc(offset)) : fallback;
}

export function plainText(value) {
  return asText(value)
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
}

export function createTextAnchor({ text, start, end, exact, prefix, suffix, contextLength = DEFAULT_CONTEXT_LENGTH } = {}) {
  const source = plainText(text);
  const anchorStart = Math.min(asOffset(start), source.length);
  const anchorEnd = Math.max(anchorStart, Math.min(asOffset(end, anchorStart), source.length));
  const quote = asText(exact) || source.slice(anchorStart, anchorEnd);
  if (!quote) throw new Error('annotation exact text is required');
  const length = Math.max(0, Math.trunc(Number(contextLength) || DEFAULT_CONTEXT_LENGTH));
  return {
    exact: quote,
    prefix: prefix === undefined ? source.slice(Math.max(0, anchorStart - length), anchorStart) : asText(prefix),
    suffix: suffix === undefined ? source.slice(anchorEnd, Math.min(source.length, anchorEnd + length)) : asText(suffix),
    start: anchorStart,
    end: anchorEnd,
  };
}

function contextScore(source, candidate, anchor) {
  const prefix = asText(anchor.prefix);
  const suffix = asText(anchor.suffix);
  const candidateEnd = candidate + asText(anchor.exact).length;
  const prefixMatches = prefix && source.slice(Math.max(0, candidate - prefix.length), candidate) === prefix;
  const suffixMatches = suffix && source.slice(candidateEnd, candidateEnd + suffix.length) === suffix;
  return Number(Boolean(prefixMatches)) * 2 + Number(Boolean(suffixMatches));
}

export function locateTextAnchor(text, anchor = {}) {
  const source = plainText(text);
  const exact = asText(anchor.exact || anchor.quote);
  if (!exact) return { status: 'needs_repair', start: null, end: null };

  const candidates = [];
  let index = source.indexOf(exact);
  while (index !== -1) {
    candidates.push({ index, score: contextScore(source, index, { ...anchor, exact }) });
    index = source.indexOf(exact, index + Math.max(1, exact.length));
  }
  if (!candidates.length) return { status: 'needs_repair', start: null, end: null, exact };

  const expected = asOffset(anchor.start, candidates[0].index);
  candidates.sort((left, right) => right.score - left.score || Math.abs(left.index - expected) - Math.abs(right.index - expected));
  const match = candidates[0].index;
  return { status: 'resolved', start: match, end: match + exact.length, exact };
}
