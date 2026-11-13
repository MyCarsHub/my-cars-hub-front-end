import { ComponentFixture, TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { NotificationService } from '../../../services/notification.service';
import { AdminCoupon } from '../../../types/admin-coupon.types';
import {
  CARD_SIZE,
  CardContent,
  CouponCardRenderer,
  cardContent,
  cardFileName,
  drawCouponCard,
  recolourLogo,
  storyHeadline,
} from './coupon-card-image';
import { CouponShare } from './coupon-share';

const BEMVINDO20: AdminCoupon = {
  couponId: 'mch_1',
  mode: 'OPEN_CODE',
  status: 'ACTIVE',
  companyId: null,
  planCode: 'ALL',
  allPlans: true,
  amountOffCents: null,
  percentOff: 20,
  duration: 'REPEATING',
  durationMonths: 3,
  timesRedeemed: 4,
  maxRedemptions: 100,
  promotionCode: 'BEMVINDO20',
  expiresAt: '2026-12-13T10:00:00',
  createdAt: '2026-11-13T10:00:00',
};

/** As cores do logo real (`public/svg/logo-my-cars-hub-complete-dark.svg`). */
const LOGO_SVG =
  '<svg width="1033" height="137"><path d="M1" fill="#F4F4F5"/><path d="M2" fill="#e3230c"/></svg>';

describe('imagem do cupom', () => {
  it('o texto do cartão sai do cupom (prancha G)', () => {
    expect(cardContent(BEMVINDO20, 'BEMVINDO20')).toEqual<CardContent>({
      headline: '20% OFF',
      benefit: 'nos primeiros 3 meses',
      plans: 'Planos Starter, Pro e Scale',
      code: 'BEMVINDO20',
      validity: 'Válido até 13/12/2026',
      host: 'mycarshub.app.br',
    });
  });

  it('valor fixo: reais inteiros sem centavos; um plano só; uma vez; sem validade', () => {
    const content = cardContent(
      {
        ...BEMVINDO20,
        planCode: 'PRO_MONTHLY_STRIPE',
        allPlans: false,
        percentOff: null,
        amountOffCents: 3000,
        duration: 'ONCE',
        durationMonths: null,
        expiresAt: null,
      },
      'PRO30',
    );
    expect(content.headline).toBe('R$ 30 OFF');
    expect(content.plans).toBe('Plano Pro');
    expect(content.benefit).toBe('na próxima fatura');
    expect(content.validity).toBeNull();
    expect(cardContent({ ...BEMVINDO20, percentOff: null, amountOffCents: 2990 }, 'X').headline).toBe('R$ 29,90 OFF');
  });

  it('no story o OFF desce para a linha de baixo', () => {
    expect(storyHeadline('20% OFF')).toEqual(['20%', 'OFF']);
    expect(storyHeadline('R$ 30 OFF')).toEqual(['R$ 30', 'OFF']);
  });

  it('logo: no laranja toda branca; no branco, o símbolo no laranja da marca', () => {
    const orange = recolourLogo(LOGO_SVG, 'ORANGE');
    expect(orange).not.toMatch(/#F4F4F5|#E3230C/i);
    expect(orange.match(/#FFFFFF/g)).toHaveLength(2);
    const white = recolourLogo(LOGO_SVG, 'WHITE');
    expect(white).toContain('fill="#F63B04"');
    expect(white).toContain('fill="#262626"');
  });

  it('nome do arquivo diz o código e o formato', () => {
    expect(cardFileName('BEMVINDO20', 'SQUARE')).toBe('cupom-BEMVINDO20-quadrado.png');
    expect(cardFileName('MCH-7KQ2M9XA', 'STORY')).toBe('cupom-MCH-7KQ2M9XA-story.png');
  });

  describe('desenho', () => {
    /** Um contexto 2D de mentira que guarda o que foi escrito e com que cor. */
    const fakeContext = () => {
      const texts: { text: string; color: string; font: string }[] = [];
      const fills: string[] = [];
      const images: unknown[][] = [];
      const ctx = {
        font: '',
        fillStyle: '',
        textBaseline: '',
        textAlign: '',
        measureText: (text: string) => ({ width: text.length * 10 }),
        fillText(text: string) {
          texts.push({ text, color: String(this.fillStyle), font: this.font });
        },
        fillRect() {
          fills.push(String(this.fillStyle));
        },
        fill() {
          fills.push(String(this.fillStyle));
        },
        drawImage: (...args: unknown[]) => images.push(args),
        beginPath: () => undefined,
        moveTo: () => undefined,
        arcTo: () => undefined,
        closePath: () => undefined,
      };
      return { ctx: ctx as unknown as CanvasRenderingContext2D, texts, fills, images };
    };

    it('quadrado laranja: fundo laranja, texto branco, código laranja na caixa branca', () => {
      const { ctx, texts, fills, images } = fakeContext();
      const logo = {} as CanvasImageSource;
      drawCouponCard(ctx, cardContent(BEMVINDO20, 'BEMVINDO20'), 'SQUARE', 'ORANGE', logo, 1033 / 137);
      expect(fills[0]).toBe('#F63B04');
      expect(texts.map((t) => t.text)).toEqual([
        '20% OFF',
        'nos primeiros 3 meses',
        'Planos Starter, Pro e Scale',
        'Use o código',
        'BEMVINDO20',
        'Válido até 13/12/2026',
        'mycarshub.app.br',
      ]);
      const code = texts.find((t) => t.text === 'BEMVINDO20');
      expect(code?.color).toBe('#F63B04');
      expect(code?.font).toContain('JetBrains Mono');
      expect(fills).toContain('#FFFFFF');
      expect(images).toHaveLength(1);
      expect(images[0][1]).toBe(88);
    });

    it('story branco: título laranja em duas linhas e "Assine em" embaixo', () => {
      const { ctx, texts, fills } = fakeContext();
      drawCouponCard(ctx, cardContent(BEMVINDO20, 'BEMVINDO20'), 'STORY', 'WHITE', null, 0);
      expect(fills[0]).toBe('#FFFFFF');
      expect(texts.slice(0, 2).map((t) => [t.text, t.color])).toEqual([
        ['20%', '#F63B04'],
        ['OFF', '#F63B04'],
      ]);
      expect(texts.at(-1)?.text).toBe('Assine em mycarshub.app.br');
      expect(CARD_SIZE.STORY).toEqual({ width: 1080, height: 1920 });
    });
  });
});

describe('CouponShare', () => {
  let fixture: ComponentFixture<CouponShare>;
  let render: ReturnType<typeof vi.fn>;
  let notify: Record<'success' | 'error' | 'warning', ReturnType<typeof vi.fn>>;
  let writeText: ReturnType<typeof vi.fn>;
  const PNG = new Blob(['png'], { type: 'image/png' });

  const q = <T extends HTMLElement>(testId: string): T =>
    (fixture.nativeElement as HTMLElement).querySelector(`[data-testid="${testId}"]`) as T;

  const mount = async (coupon: AdminCoupon = BEMVINDO20, company: string | null = null): Promise<void> => {
    fixture = TestBed.createComponent(CouponShare);
    fixture.componentRef.setInput('coupon', coupon);
    fixture.componentRef.setInput('company', company);
    fixture.detectChanges();
    await fixture.whenStable();
    await Promise.resolve();
    fixture.detectChanges();
  };

  const setNavigator = (props: Record<string, unknown>): void => {
    for (const [key, value] of Object.entries(props)) {
      Object.defineProperty(window.navigator, key, { value, configurable: true });
    }
  };

  beforeEach(() => {
    TestBed.resetTestingModule();
    render = vi.fn(() => Promise.resolve(PNG));
    notify = { success: vi.fn(), error: vi.fn(), warning: vi.fn() };
    writeText = vi.fn(() => Promise.resolve());
    setNavigator({ clipboard: { writeText }, share: undefined, canShare: undefined });
    Object.defineProperty(URL, 'createObjectURL', { value: vi.fn(() => 'blob:cupom'), configurable: true });
    Object.defineProperty(URL, 'revokeObjectURL', { value: vi.fn(), configurable: true });
    TestBed.configureTestingModule({
      imports: [CouponShare],
      providers: [
        { provide: CouponCardRenderer, useValue: { render } },
        { provide: NotificationService, useValue: notify },
      ],
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('gera a imagem quadrada laranja e mostra a mensagem com o código em destaque', async () => {
    await mount();
    expect(render).toHaveBeenCalledWith(cardContent(BEMVINDO20, 'BEMVINDO20'), 'SQUARE', 'ORANGE');
    expect(q<HTMLImageElement>('share-image').getAttribute('src')).toBe('blob:cupom');
    expect(q<HTMLImageElement>('share-image').alt).toBe('Imagem do cupom BEMVINDO20');
    expect(q('share-message').textContent).toContain('Oi! Tem desconto para você assinar o MyCarsHub.');
    expect(q('share-message-code').textContent?.trim()).toBe('BEMVINDO20');
  });

  it('trocar para Story e Branco gera de novo', async () => {
    await mount();
    q('share-format-story').click();
    q('share-tone-white').click();
    await fixture.whenStable();
    expect(render).toHaveBeenLastCalledWith(expect.anything(), 'STORY', 'WHITE');
  });

  it('no celular, Compartilhar imagem abre a folha do sistema com a imagem e a mensagem', async () => {
    const share = vi.fn(() => Promise.resolve());
    setNavigator({ share, canShare: vi.fn(() => true) });
    await mount();
    q('share-image-button').click();
    await fixture.whenStable();
    expect(share).toHaveBeenCalledTimes(1);
    const data = (share.mock.calls[0] as unknown as [ShareData])[0];
    expect(data.files?.[0].name).toBe('cupom-BEMVINDO20-quadrado.png');
    expect(data.files?.[0].type).toBe('image/png');
    expect(data.text).toContain('Use o código:\nBEMVINDO20');
    expect(notify.success).not.toHaveBeenCalled();
  });

  it('fechar a folha do sistema não baixa nada', async () => {
    setNavigator({
      share: vi.fn(() => Promise.reject(new DOMException('cancelado', 'AbortError'))),
      canShare: vi.fn(() => true),
    });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    await mount();
    q('share-image-button').click();
    await fixture.whenStable();
    expect(click).not.toHaveBeenCalled();
  });

  it('no computador (sem compartilhar arquivo), baixa a imagem e avisa', async () => {
    setNavigator({ share: vi.fn(), canShare: vi.fn(() => false) });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    await mount();
    q('share-image-button').click();
    await fixture.whenStable();
    expect(click).toHaveBeenCalledTimes(1);
    const link = click.mock.contexts[0] as HTMLAnchorElement;
    expect(link.download).toBe('cupom-BEMVINDO20-quadrado.png');
    expect(notify.success).toHaveBeenCalledWith('Imagem baixada.');
  });

  it('Copiar mensagem e Copiar código usam a área de transferência com aviso', async () => {
    await mount();
    q('share-copy-message').click();
    await fixture.whenStable();
    expect(writeText).toHaveBeenLastCalledWith(expect.stringContaining('Vale até 13/12/2026. Assine em mycarshub.app.br'));
    expect(notify.success).toHaveBeenLastCalledWith('Mensagem copiada.');
    q('share-copy-code').click();
    await fixture.whenStable();
    expect(writeText).toHaveBeenLastCalledWith('BEMVINDO20');
    expect(notify.success).toHaveBeenLastCalledWith('Código copiado.');
  });

  it('código de empresa: a mensagem fala com a empresa', async () => {
    await mount({ ...BEMVINDO20, mode: 'PROMOTION_CODE', companyId: 'co', promotionCode: 'MCH-7KQ2M9XA' }, 'Alfa Rent a Car');
    expect(q('share-message').textContent).toContain('Separei um desconto só para a Alfa Rent a Car');
    expect(q('share-message').textContent).toContain('É de uso único');
  });

  it('se a imagem não sai, avisa, deixa tentar de novo e a mensagem continua', async () => {
    render.mockReturnValueOnce(Promise.reject(new Error('canvas')));
    await mount();
    expect(q('share-image-error')).not.toBeNull();
    expect(q<HTMLButtonElement>('share-image-button').disabled).toBe(true);
    expect(q('share-message')).not.toBeNull();
    q('share-image-retry').click();
    await fixture.whenStable();
    await Promise.resolve();
    fixture.detectChanges();
    expect(q('share-image')).not.toBeNull();
  });
});
