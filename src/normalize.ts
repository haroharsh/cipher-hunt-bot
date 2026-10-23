export interface NormalizeOptions {
  collapseSpaces?: boolean;
  stripSpaces?: boolean;
  stripPunctuation?: boolean;
}

/** Default: trim + case-insensitive. Extra rules are opt-in. */
export function normalize(input: string, opts: NormalizeOptions = {}): string {
  let s = input.trim().toLowerCase();
  if (opts.stripPunctuation) s = s.replace(/[^\p{L}\p{N}\s]/gu, '');
  if (opts.collapseSpaces) s = s.replace(/\s+/g, ' ').trim();
  if (opts.stripSpaces) s = s.replace(/\s+/g, '');
  return s;
}
