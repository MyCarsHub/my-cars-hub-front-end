import { DOCUMENT } from '@angular/common';
import { Injectable, inject } from '@angular/core';
import { AdminCoupon } from '../../../types/admin-coupon.types';
import {
  SIGNUP_HOST,
  allPlansNames,
  couponDate,
  couponPlanName,
  durationBenefit,
  isAllPlans,
} from './coupon-copy';

/** Quadrado = feed e WhatsApp; story = story do Instagram e status do WhatsApp. */
export type CardFormat = 'SQUARE' | 'STORY';
/** Laranja pintado com texto branco, ou branco com laranja. */
export type CardTone = 'ORANGE' | 'WHITE';

export const CARD_SIZE: Record<CardFormat, { width: number; height: number }> = {
  SQUARE: { width: 1080, height: 1080 },
  STORY: { width: 1080, height: 1920 },
};

/** O logo real do app; a versão "dark" tem o texto claro e o símbolo vermelho. */
export const LOGO_URL = 'svg/logo-my-cars-hub-complete-dark.svg';
const LOGO_SYMBOL_FILL = '#E3230C';
const LOGO_TEXT_FILL = '#F4F4F5';

const BRAND = '#F63B04';
const WHITE = '#FFFFFF';
const INK = '#262626';

const DISPLAY = "Sora, 'DM Sans', system-ui, sans-serif";
/** Letra de máquina: não confunde O com 0 nem I com 1. */
const MONO = "'JetBrains Mono', ui-monospace, 'SF Mono', monospace";

/** O que vai escrito no cartão. Tudo sai do cupom; nada é digitado à parte. */
export interface CardContent {
  /** "20% OFF" ou "R$ 30 OFF". */
  headline: string;
  /** "nos primeiros 3 meses", "na próxima fatura", "em todas as faturas". */
  benefit: string;
  /** "Planos Starter, Pro e Scale" ou "Plano Pro". */
  plans: string;
  code: string;
  /** "Válido até 13/12/2026", ou `null` sem validade. */
  validity: string | null;
  host: string;
}

const PERCENT = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 });

/** Reais inteiros sem centavos ("R$ 30"), o resto com ("R$ 29,90"): cabe grande no cartão. */
function amountHeadline(cents: number): string {
  const reais = cents / 100;
  const text = Number.isInteger(reais)
    ? reais.toLocaleString('pt-BR')
    : reais.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `R$ ${text}`;
}

export function cardContent(
  coupon: Pick<AdminCoupon, 'planCode' | 'amountOffCents' | 'percentOff' | 'expiresAt'> &
    Partial<Pick<AdminCoupon, 'allPlans' | 'duration' | 'durationMonths'>>,
  code: string,
): CardContent {
  const off =
    coupon.percentOff !== null
      ? `${PERCENT.format(coupon.percentOff)}%`
      : amountHeadline(coupon.amountOffCents ?? 0);
  const date = coupon.expiresAt ? couponDate(coupon.expiresAt) : '—';
  return {
    headline: `${off} OFF`,
    benefit: durationBenefit(coupon),
    plans: isAllPlans(coupon) ? `Planos ${allPlansNames()}` : `Plano ${couponPlanName(coupon.planCode)}`,
    code,
    validity: date !== '—' ? `Válido até ${date}` : null,
    host: SIGNUP_HOST,
  };
}

/** No laranja a logo é toda branca; no branco, o símbolo fica no laranja da marca. */
export function recolourLogo(svg: string, tone: CardTone): string {
  const symbol = tone === 'ORANGE' ? WHITE : BRAND;
  const text = tone === 'ORANGE' ? WHITE : INK;
  return svg.replace(new RegExp(LOGO_SYMBOL_FILL, 'gi'), symbol).replace(new RegExp(LOGO_TEXT_FILL, 'gi'), text);
}

export function cardFileName(code: string, format: CardFormat): string {
  const safe = code.replace(/[^A-Za-z0-9-]/g, '');
  return `cupom-${safe}-${format === 'STORY' ? 'story' : 'quadrado'}.png`;
}

/** "20% OFF" vira ["20%", "OFF"]; "R$ 30 OFF" vira ["R$ 30", "OFF"]. */
export function storyHeadline(headline: string): string[] {
  const words = headline.split(' ');
  const last = words.pop() ?? '';
  return words.length ? [words.join(' '), last] : [last];
}

interface Palette {
  bg: string;
  text: string;
  headline: string;
  codeBg: string;
  codeText: string;
}

const PALETTE: Record<CardTone, Palette> = {
  ORANGE: { bg: BRAND, text: WHITE, headline: WHITE, codeBg: WHITE, codeText: BRAND },
  WHITE: { bg: WHITE, text: INK, headline: BRAND, codeBg: BRAND, codeText: WHITE },
};

interface Line {
  text: string;
  size: number;
  weight: number;
  family: string;
  lineHeight: number;
  color: string;
  /** Espaço acima da linha. */
  before: number;
}

/** Fonte que cabe na largura: diminui até caber, nunca aumenta. */
function fitSize(ctx: CanvasRenderingContext2D, line: Line, maxWidth: number): number {
  let size = line.size;
  ctx.font = `${line.weight} ${size}px ${line.family}`;
  const width = ctx.measureText(line.text).width;
  if (width > maxWidth) size = Math.floor((size * maxWidth) / width);
  return size;
}

function drawLines(ctx: CanvasRenderingContext2D, lines: Line[], x: number, y: number, maxWidth: number): number {
  let top = y;
  for (const line of lines) {
    const size = fitSize(ctx, line, maxWidth);
    const height = size * line.lineHeight;
    top += line.before;
    ctx.font = `${line.weight} ${size}px ${line.family}`;
    ctx.fillStyle = line.color;
    ctx.textBaseline = 'middle';
    ctx.fillText(line.text, x, top + height / 2);
    top += height;
  }
  return top - y;
}

function linesHeight(ctx: CanvasRenderingContext2D, lines: Line[], maxWidth: number): number {
  return lines.reduce((sum, line) => sum + line.before + fitSize(ctx, line, maxWidth) * line.lineHeight, 0);
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

interface CodeBox {
  size: number;
  padX: number;
  padY: number;
  radius: number;
}

function codeBoxHeight(box: CodeBox): number {
  return box.size * 1.15 + box.padY * 2;
}

function drawCode(
  ctx: CanvasRenderingContext2D,
  code: string,
  x: number,
  y: number,
  maxWidth: number,
  box: CodeBox,
  palette: Palette,
): number {
  let size = box.size;
  ctx.font = `700 ${size}px ${MONO}`;
  const natural = ctx.measureText(code).width;
  if (natural + box.padX * 2 > maxWidth) size = Math.floor((size * (maxWidth - box.padX * 2)) / natural);
  ctx.font = `700 ${size}px ${MONO}`;
  const width = ctx.measureText(code).width + box.padX * 2;
  const height = codeBoxHeight(box);
  ctx.fillStyle = palette.codeBg;
  roundRect(ctx, x, y, width, height, box.radius);
  ctx.fill();
  ctx.fillStyle = palette.codeText;
  ctx.textBaseline = 'middle';
  ctx.fillText(code, x + box.padX, y + height / 2);
  return height;
}

/**
 * Desenha o cartão no tamanho final (1080 de largura). Medidas = o dobro do canvas, que
 * desenhou na metade do tamanho. Quadrado: logo, oferta, código e rodapé espaçados por
 * igual. Story: logo em cima, oferta e código no meio, "Assine em" embaixo.
 */
export function drawCouponCard(
  ctx: CanvasRenderingContext2D,
  content: CardContent,
  format: CardFormat,
  tone: CardTone,
  logo: CanvasImageSource | null,
  logoRatio: number,
): void {
  const { width, height } = CARD_SIZE[format];
  const palette = PALETTE[tone];
  const story = format === 'STORY';
  const pad = story ? 112 : 88;
  const inner = width - pad * 2;

  ctx.fillStyle = palette.bg;
  ctx.fillRect(0, 0, width, height);

  const logoHeight = story ? 68 : 56;
  const offer: Line[] = story
    ? [
        // "20%" / "OFF": o OFF desce para a linha de baixo.
        ...storyHeadline(content.headline).map((text) => ({
          text,
          size: 340,
          weight: 800,
          family: DISPLAY,
          lineHeight: 0.95,
          color: palette.headline,
          before: 0,
        })),
        { text: content.benefit, size: 64, weight: 700, family: DISPLAY, lineHeight: 1.2, color: palette.text, before: 56 },
        { text: content.plans, size: 56, weight: 500, family: DISPLAY, lineHeight: 1.3, color: palette.text, before: 20 },
      ]
    : [
        { text: content.headline, size: 192, weight: 800, family: DISPLAY, lineHeight: 1, color: palette.headline, before: 0 },
        { text: content.benefit, size: 56, weight: 700, family: DISPLAY, lineHeight: 1.2, color: palette.text, before: 24 },
        { text: content.plans, size: 42, weight: 500, family: DISPLAY, lineHeight: 1.3, color: palette.text, before: 12 },
      ];
  const label: Line = {
    text: 'Use o código',
    size: story ? 48 : 36,
    weight: 600,
    family: DISPLAY,
    lineHeight: 1.2,
    color: palette.text,
    before: 0,
  };
  const box: CodeBox = story
    ? { size: 116, padX: 52, padY: 32, radius: 36 }
    : { size: 88, padX: 40, padY: 24, radius: 28 };
  const labelGap = story ? 24 : 16;
  const codeBlock = linesHeight(ctx, [label], inner) + labelGap + codeBoxHeight(box);

  const drawLogo = (y: number): void => {
    if (logo) ctx.drawImage(logo, pad, y, logoHeight * logoRatio, logoHeight);
  };

  if (story) {
    const validity: Line | null = content.validity
      ? { text: content.validity, size: 48, weight: 500, family: DISPLAY, lineHeight: 1.2, color: palette.text, before: 36 }
      : null;
    const footer: Line = {
      text: `Assine em ${content.host}`,
      size: 56,
      weight: 700,
      family: DISPLAY,
      lineHeight: 1.2,
      color: palette.text,
      before: 0,
    };
    const middle =
      linesHeight(ctx, offer, inner) + 128 + codeBlock + (validity ? linesHeight(ctx, [validity], inner) : 0);
    const footerHeight = linesHeight(ctx, [footer], inner);
    const gap = (height - pad * 2 - logoHeight - middle - footerHeight) / 2;
    drawLogo(pad);
    let y = pad + logoHeight + gap;
    y += drawLines(ctx, offer, pad, y, inner) + 128;
    y += drawLines(ctx, [label], pad, y, inner) + labelGap;
    y += drawCode(ctx, content.code, pad, y, inner, box, palette);
    if (validity) drawLines(ctx, [validity], pad, y, inner);
    drawLines(ctx, [footer], pad, height - pad - footerHeight, inner);
    return;
  }

  const footerSize = 34;
  const footerHeight = footerSize * 1.2;
  const offerHeight = linesHeight(ctx, offer, inner);
  const gap = (height - pad * 2 - logoHeight - offerHeight - codeBlock - footerHeight) / 3;
  drawLogo(pad);
  let y = pad + logoHeight + gap;
  y += drawLines(ctx, offer, pad, y, inner) + gap;
  y += drawLines(ctx, [label], pad, y, inner) + labelGap;
  drawCode(ctx, content.code, pad, y, inner, box, palette);

  const footerY = height - pad - footerHeight / 2;
  ctx.font = `600 ${footerSize}px ${DISPLAY}`;
  ctx.fillStyle = palette.text;
  ctx.textBaseline = 'middle';
  if (content.validity) {
    ctx.textAlign = 'left';
    ctx.fillText(content.validity, pad, footerY);
  }
  ctx.textAlign = 'right';
  ctx.fillText(content.host, width - pad, footerY);
  ctx.textAlign = 'left';
}

/**
 * Gera a imagem do cupom no navegador: o logo real de `public/svg`, recolorido; as
 * fontes do app; PNG no tamanho final. Nada sai do aparelho para gerar a imagem.
 */
@Injectable({ providedIn: 'root' })
export class CouponCardRenderer {
  private readonly doc = inject(DOCUMENT);
  private readonly logos = new Map<CardTone, Promise<{ image: HTMLImageElement; ratio: number } | null>>();

  async render(content: CardContent, format: CardFormat, tone: CardTone): Promise<Blob> {
    const [logo] = await Promise.all([this.logo(tone), this.fonts()]);
    const { width, height } = CARD_SIZE[format];
    const canvas = this.doc.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D indisponível');
    drawCouponCard(ctx, content, format, tone, logo?.image ?? null, logo?.ratio ?? 0);
    return new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('PNG não gerado'))), 'image/png'),
    );
  }

  /** As fontes do cartão já vêm no `index.html`; aqui só se espera que estejam prontas. */
  private async fonts(): Promise<void> {
    const fonts = this.doc.fonts;
    if (!fonts?.load) return;
    await Promise.all(
      [`800 96px Sora`, `700 28px Sora`, `500 21px Sora`, `600 18px Sora`, `700 44px 'JetBrains Mono'`].map((font) =>
        fonts.load(font).catch(() => []),
      ),
    );
  }

  /** Sem logo (rede caiu), o cartão sai sem ele em vez de não sair. */
  private logo(tone: CardTone): Promise<{ image: HTMLImageElement; ratio: number } | null> {
    let pending = this.logos.get(tone);
    if (!pending) {
      pending = this.loadLogo(tone).catch(() => null);
      this.logos.set(tone, pending);
    }
    return pending;
  }

  private async loadLogo(tone: CardTone): Promise<{ image: HTMLImageElement; ratio: number }> {
    const view = this.doc.defaultView;
    if (!view?.fetch) throw new Error('sem fetch');
    const response = await view.fetch(new URL(LOGO_URL, this.doc.baseURI).toString());
    if (!response.ok) throw new Error(`logo ${response.status}`);
    const svg = recolourLogo(await response.text(), tone);
    const image = new view.Image();
    image.decoding = 'async';
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    await image.decode();
    const ratio = image.naturalWidth && image.naturalHeight ? image.naturalWidth / image.naturalHeight : 1033 / 137;
    return { image, ratio };
  }
}
