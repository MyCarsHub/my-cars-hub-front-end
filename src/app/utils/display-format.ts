/**
 * FEAT-0556 — the ONE display rule for person names, vehicle labels and plates.
 *
 * Display-only: stored values are never rewritten (names live in issued
 * contracts). The rule mirrors the backend NameNormalizer in spirit
 * (FEAT-0555) but does not call it.
 *
 * KEY RULE: a text is normalised ONLY when its letters are all upper-case or
 * all lower-case. Text that is already mixed-case is the user's deliberate
 * choice ("da Silva", "McDonald", "D'Ávila") and is returned exactly as typed
 * (apart from trimming and collapsing whitespace).
 *
 * All functions are pure, null/undefined safe and idempotent.
 */

/** pt-BR particles kept lower-case unless they are the first word of a name. */
const NAME_PARTICLES: ReadonlySet<string> = new Set(['de', 'da', 'do', 'dos', 'das', 'e']);

/** Roman numerals that stay upper-case in a name ("João II"). */
const ROMAN_NUMERALS: ReadonlySet<string> = new Set(['II', 'III', 'IV']);

/**
 * Vehicle brands that are acronyms or stylised all-caps (from the FIPE brand
 * list). Brands that merely arrive in caps (KIA, FIAT, JEEP, MINI, AUDI, LEXUS)
 * are words, not acronyms: they get Title Case.
 */
const BRAND_ACRONYMS: ReadonlySet<string> = new Set([
  'BMW', 'BYD', 'VW', 'GM', 'JAC', 'GWM', 'RAM', 'MG', 'DS', 'CAOA',
]);

/** Common model/trim acronyms that must survive an all-caps or all-lower input. */
const MODEL_ACRONYMS: ReadonlySet<string> = new Set([
  ...BRAND_ACRONYMS,
  'SUV', 'GT', 'GTI', 'GTS', 'GTR', 'LT', 'LTZ', 'LS', 'LX', 'EX', 'EXL', 'XLT', 'SRV', 'SRX',
  'TSI', 'TDI', 'TFSI', 'CVT', 'AWD', 'CX', 'RS', 'SR', 'SE', 'LTD', 'GLS', 'GLX', 'GLI', 'ST',
  'SX', 'WRX', 'STI', 'HDI', 'THP', 'AT', 'MT', 'XR', 'XRE', 'XRS',
]);

/** Whole hyphenated tokens made of letter codes (CR-V, HR-V…). */
const HYPHEN_CODES: ReadonlySet<string> = new Set([
  'CR-V', 'HR-V', 'WR-V', 'ZR-V', 'BR-V', 'GT-R', 'EX-L',
]);

function collapse(value: string | null | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').trim();
}

/** True when the text has letters and they are all upper-case or all lower-case. */
function isUniformCase(text: string): boolean {
  if (text.toLowerCase() === text.toUpperCase()) return false; // no letters
  return text === text.toUpperCase() || text === text.toLowerCase();
}

/** Lower-cases the segment and upper-cases its first letter ("(ana" -> "(Ana"). */
function capitalizeFirstLetter(segment: string): string {
  const lower = segment.toLowerCase();
  const i = lower.search(/\p{L}/u);
  if (i < 0) return lower;
  return lower.slice(0, i) + lower.charAt(i).toUpperCase() + lower.slice(i + 1);
}

/** Applies `piece` to each part of `token` split by `separator` (kept in place). */
function mapSegments(token: string, separator: string, piece: (segment: string) => string): string {
  return token.split(separator).map(piece).join(separator);
}

// ---------------------------------------------------------------------------
// Person names
// ---------------------------------------------------------------------------

function personWord(word: string, index: number, previous: string | null): string {
  const lower = word.toLowerCase();
  if (index > 0 && NAME_PARTICLES.has(lower)) return lower;
  if (ROMAN_NUMERALS.has(word.toUpperCase())) return word.toUpperCase();
  const titled = mapSegments(word, '-', (hyphenPart) =>
    hyphenPart
      .split(/(['’])/)
      .map((seg, i) => (i % 2 === 1 ? seg : capitalizeFirstLetter(seg)))
      .join(''),
  );
  // "d'Ávila" right after a particle follows the particle rule (lower-case "d'").
  const afterParticle = previous !== null && NAME_PARTICLES.has(previous.toLowerCase());
  if (afterParticle && /^D['’]/.test(titled)) return 'd' + titled.slice(1);
  return titled;
}

/** "JOÃO DA SILVA" / "joão da silva" -> "João da Silva". Mixed-case input is left as typed. */
export function formatPersonName(value: string | null | undefined): string {
  const text = collapse(value);
  if (!text || text.includes('@') || !isUniformCase(text)) return text;
  const words = text.split(' ');
  return words.map((w, i) => personWord(w, i, i > 0 ? words[i - 1] : null)).join(' ');
}

/** First letter for avatars, consistent with the formatted name. */
export function personInitial(value: string | null | undefined): string {
  return formatPersonName(value).charAt(0).toUpperCase();
}

// ---------------------------------------------------------------------------
// Vehicle brand / model
// ---------------------------------------------------------------------------

function vehicleToken(token: string, acronyms: ReadonlySet<string>, lowerInput: boolean): string {
  const upper = token.toUpperCase();
  if (HYPHEN_CODES.has(upper) || acronyms.has(upper)) return upper;
  // Tokens with digits ("HB20", "SW4", "C4") are codes: upper-case them when the
  // text arrived in lower-case, keep them exactly as they are when it arrived in caps.
  if (/\d/.test(token)) return lowerInput ? upper : token;
  // Per hyphen segment, so "T-CROSS" -> "T-Cross" while "CX-5" keeps its acronym.
  return mapSegments(token, '-', (seg) => {
    const segUpper = seg.toUpperCase();
    if (acronyms.has(segUpper)) return segUpper;
    if (/\d/.test(seg)) return segUpper;
    return capitalizeFirstLetter(seg);
  });
}

function formatVehicleText(value: string | null | undefined, acronyms: ReadonlySet<string>): string {
  const text = collapse(value);
  if (!text || !isUniformCase(text)) return text;
  const lowerInput = text === text.toLowerCase();
  return text
    .split(' ')
    .map((t) => vehicleToken(t, acronyms, lowerInput))
    .join(' ');
}

export function formatBrand(value: string | null | undefined): string {
  return formatVehicleText(value, BRAND_ACRONYMS);
}

export function formatModel(value: string | null | undefined): string {
  return formatVehicleText(value, MODEL_ACRONYMS);
}

/** "Fiat Uno": brand + model, each formatted, empty parts dropped. */
export function formatVehicleLabel(
  brand: string | null | undefined,
  model: string | null | undefined,
): string {
  return [formatBrand(brand), formatModel(model)].filter(Boolean).join(' ');
}

// ---------------------------------------------------------------------------
// Plates
// ---------------------------------------------------------------------------

/**
 * Plate in upper-case; a 7-char plate gets the hyphen ("ABC1D23" -> "ABC-1D23").
 * Empty -> "—" (same output as the per-component copies this replaces).
 * `hyphen: false` is for the driver area, which shows the plate without it.
 */
export function formatPlate(
  plate: string | null | undefined,
  options: { readonly hyphen?: boolean; readonly empty?: string } = {},
): string {
  const p = (plate ?? '').toUpperCase();
  if (options.hyphen !== false && p.length === 7) return `${p.slice(0, 3)}-${p.slice(3)}`;
  return p || (options.empty ?? '—');
}
