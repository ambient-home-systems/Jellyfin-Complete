// Language codes (ADR-043). Jellyfin's libraries prefer a two-letter ISO 639-1 code ("en"), audio tracks are tagged with
// three-letter ISO 639-2 codes ("eng"; French as "fre" or "fra"), users' audio preferences are three-letter, and TMDb's
// images use two-letter codes ("xx" or none for no text). These say whether two codes mean the same language.

/** ISO 639-1 → its ISO 639-2 codes (bibliographic and terminology, where they differ) and English name. */
const LANGS: Record<string, { codes: string[]; name: string }> = {
  en: { codes: ['eng'], name: 'English' }, fr: { codes: ['fre', 'fra'], name: 'French' }, es: { codes: ['spa'], name: 'Spanish' },
  de: { codes: ['ger', 'deu'], name: 'German' }, it: { codes: ['ita'], name: 'Italian' }, pt: { codes: ['por'], name: 'Portuguese' },
  nl: { codes: ['dut', 'nld'], name: 'Dutch' }, da: { codes: ['dan'], name: 'Danish' }, sv: { codes: ['swe'], name: 'Swedish' },
  no: { codes: ['nor', 'nob', 'nno'], name: 'Norwegian' }, nb: { codes: ['nob', 'nor'], name: 'Norwegian' }, fi: { codes: ['fin'], name: 'Finnish' },
  is: { codes: ['ice', 'isl'], name: 'Icelandic' }, pl: { codes: ['pol'], name: 'Polish' }, cs: { codes: ['cze', 'ces'], name: 'Czech' },
  sk: { codes: ['slo', 'slk'], name: 'Slovak' }, hu: { codes: ['hun'], name: 'Hungarian' }, ro: { codes: ['rum', 'ron'], name: 'Romanian' },
  el: { codes: ['gre', 'ell'], name: 'Greek' }, tr: { codes: ['tur'], name: 'Turkish' }, ru: { codes: ['rus'], name: 'Russian' },
  uk: { codes: ['ukr'], name: 'Ukrainian' }, bg: { codes: ['bul'], name: 'Bulgarian' }, hr: { codes: ['hrv', 'scr'], name: 'Croatian' },
  sr: { codes: ['srp', 'scc'], name: 'Serbian' }, sl: { codes: ['slv'], name: 'Slovenian' }, lt: { codes: ['lit'], name: 'Lithuanian' },
  lv: { codes: ['lav'], name: 'Latvian' }, et: { codes: ['est'], name: 'Estonian' }, he: { codes: ['heb'], name: 'Hebrew' },
  ar: { codes: ['ara'], name: 'Arabic' }, fa: { codes: ['per', 'fas'], name: 'Persian' }, hi: { codes: ['hin'], name: 'Hindi' },
  bn: { codes: ['ben'], name: 'Bengali' }, ta: { codes: ['tam'], name: 'Tamil' }, te: { codes: ['tel'], name: 'Telugu' },
  th: { codes: ['tha'], name: 'Thai' }, vi: { codes: ['vie'], name: 'Vietnamese' }, id: { codes: ['ind'], name: 'Indonesian' },
  ms: { codes: ['may', 'msa'], name: 'Malay' }, tl: { codes: ['tgl', 'fil'], name: 'Filipino' }, zh: { codes: ['chi', 'zho', 'cmn', 'yue'], name: 'Chinese' },
  ja: { codes: ['jpn'], name: 'Japanese' }, ko: { codes: ['kor'], name: 'Korean' }, ca: { codes: ['cat'], name: 'Catalan' },
  eu: { codes: ['baq', 'eus'], name: 'Basque' }, gl: { codes: ['glg'], name: 'Galician' }, cy: { codes: ['wel', 'cym'], name: 'Welsh' },
  ga: { codes: ['gle'], name: 'Irish' }, af: { codes: ['afr'], name: 'Afrikaans' }, sq: { codes: ['alb', 'sqi'], name: 'Albanian' },
  mk: { codes: ['mac', 'mkd'], name: 'Macedonian' }, ka: { codes: ['geo', 'kat'], name: 'Georgian' }, hy: { codes: ['arm', 'hye'], name: 'Armenian' },
  ur: { codes: ['urd'], name: 'Urdu' }, sw: { codes: ['swa'], name: 'Swahili' }, la: { codes: ['lat'], name: 'Latin' },
};
const BY3 = new Map<string, string>();
for (const [two, l] of Object.entries(LANGS)) for (const c of l.codes) if (!BY3.has(c)) BY3.set(c, two);

/** A code's ISO 639-1 form ("fre" → "fr", "en-US" → "en"), or null for none, undetermined or no text. */
export function lang2(code: string | null | undefined): string | null {
  const c = (code ?? '').trim().toLowerCase().split(/[-_]/)[0] ?? '';
  if (!c || c === 'und' || c === 'xx' || c === 'zxx' || c === 'mis' || c === 'mul' || c === 'null') return null;
  if (c.length === 2) return c;
  return BY3.get(c) ?? c;
}

/** True when two codes name the same language (and both name one). */
export const sameLanguage = (a: string | null | undefined, b: string | null | undefined): boolean => {
  const x = lang2(a), y = lang2(b);
  return x !== null && x === y;
};

/** A language's English name ("French"), or the code itself if it isn't one of the common ones. */
export const languageName = (code: string | null | undefined): string => {
  const c = lang2(code);
  return c ? LANGS[c]?.name ?? c : 'no language';
};
