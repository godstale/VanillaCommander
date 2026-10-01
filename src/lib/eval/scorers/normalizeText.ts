const FULLWIDTH_OFFSET = 0xfee0;

export function normalizeWidth(text: string): string {
  return text.replace(/[\uff01-\uff5e]/g, (ch) =>
    String.fromCharCode(ch.charCodeAt(0) - FULLWIDTH_OFFSET),
  ).replace(/\u3000/g, ' ');
}

export function normalizeWhitespace(text: string): string {
  return normalizeWidth(text).replace(/\s+/g, ' ').trim();
}

export type NormalizeName = 'trim' | 'case' | 'whitespace' | 'punct' | 'width';

export function applyNormalizations(text: string, rules: NormalizeName[]): string {
  let out = text;
  if (rules.includes('width')) out = normalizeWidth(out);
  if (rules.includes('case')) out = out.toLowerCase();
  if (rules.includes('punct')) {
    out = out.replace(/[\p{P}\p{S}]/gu, '');
  }
  if (rules.includes('whitespace')) out = out.replace(/\s+/g, ' ').trim();
  if (rules.includes('trim')) out = out.trim();
  return out;
}

export function defaultNormalize(text: string): string {
  return applyNormalizations(text, ['trim', 'whitespace', 'width']);
}
