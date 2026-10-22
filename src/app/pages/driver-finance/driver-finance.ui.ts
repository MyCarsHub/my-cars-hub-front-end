/*
 * Class strings shared by the four finance pages. Whole strings on purpose: Tailwind finds
 * a utility by scanning the source, so a class assembled at runtime would never be built.
 * No hex anywhere — every colour is a token of `styles.css` or a Tailwind palette step.
 */

/**
 * Top padding follows the shell: `--page-top` is set by the driver shell when its top bar
 * is in the flow (below `lg`); without it the page keeps clear of the floating menu button,
 * the same fallback as `app-default-page-layout`.
 */
export const PAGE =
  'block px-4 pt-[var(--page-top,calc(4.5rem+env(safe-area-inset-top)))] pb-28 sm:px-8 sm:pb-16 lg:pt-8';
export const STACK = 'flex flex-col gap-4';
export const H1 = 'm-0 text-2xl sm:text-3xl font-bold tracking-tight leading-tight text-neutral-900';
export const LEAD = 'm-0 text-base text-neutral-600';
export const CARD = 'bg-white border border-neutral-200 rounded-2xl shadow-sm overflow-hidden min-w-0';
export const CARD_HEAD = 'px-4 sm:px-6 pt-5 pb-1';
export const CARD_BODY = 'px-4 sm:px-6 pt-3 pb-4 sm:pb-6';
export const H2 = 'm-0 text-base font-semibold text-neutral-800';
export const EYEBROW = 'text-xs font-medium uppercase tracking-wide text-neutral-500';
export const SKELETON = 'rounded-2xl bg-neutral-200 animate-pulse';

const CHIP =
  'shrink-0 min-h-11 px-4 rounded-full border text-sm cursor-pointer whitespace-nowrap transition-colors ' +
  'focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2';
export const CHIP_ON = `${CHIP} font-semibold bg-primary-500 border-primary-500 text-white`;
export const CHIP_OFF = `${CHIP} font-medium bg-white border-neutral-200 text-neutral-700 hover:bg-neutral-50`;

export const BTN_PRIMARY =
  'inline-flex items-center justify-center gap-2 min-h-11 px-5 rounded-xl bg-primary-500 text-sm ' +
  'font-semibold text-white hover:bg-primary-600 cursor-pointer focus:outline-none ' +
  'focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2';
export const BTN_OUTLINE =
  'inline-flex items-center justify-center gap-2 min-h-11 px-5 rounded-xl border border-neutral-300 ' +
  'bg-white text-sm font-semibold text-neutral-800 hover:bg-neutral-50 cursor-pointer ' +
  'focus:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400';
/** Floating «Novo …» of phones. Same orange as every primary action — never a darker one. */
export const FAB =
  'fixed right-4 bottom-[calc(1rem+env(safe-area-inset-bottom)+var(--consent-banner-h,0px))] z-30 inline-flex ' +
  'items-center gap-2 min-h-[52px] px-5 rounded-full bg-primary-500 text-[15px] font-semibold ' +
  'text-white shadow-lg cursor-pointer focus:outline-none focus-visible:ring-2 ' +
  'focus-visible:ring-primary-500 focus-visible:ring-offset-2 active:scale-[0.98]';
export const RETRY =
  'ml-1 min-h-11 inline-flex items-center underline font-medium cursor-pointer ' +
  'focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-500 rounded-sm';
