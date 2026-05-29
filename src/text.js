export function normalizeWhitespace(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function compactText(value) {
  return normalizeWhitespace(value).replace(/\s+/g, ' ').trim();
}

export function textLines(value) {
  return normalizeWhitespace(value)
    .split(/\r?\n/)
    .map((line) => compactText(line))
    .filter(Boolean);
}

export function uniqueStrings(values) {
  const seen = new Set();
  const output = [];

  for (const value of values || []) {
    const normalized = compactText(value);
    if (!normalized) continue;

    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;

    seen.add(key);
    output.push(normalized);
  }

  return output;
}

export function toNumber(value) {
  if (value === null || value === undefined || value === '') return null;

  const normalized = String(value).replace(/[$,\s]/g, '').trim();
  const parsed = Number(normalized);

  return Number.isFinite(parsed) ? parsed : null;
}

export function truncateText(value, maxLength = 500) {
  const normalized = compactText(value);
  if (normalized.length <= maxLength) return normalized || null;

  return `${normalized.slice(0, maxLength - 1).trim()}...`;
}

export function stableHash(value) {
  const text = String(value || '');
  let hash = 5381;

  for (let index = 0; index < text.length; index += 1) {
    hash = ((hash << 5) + hash) + text.charCodeAt(index);
    hash &= 0xffffffff;
  }

  return Math.abs(hash).toString(36);
}
