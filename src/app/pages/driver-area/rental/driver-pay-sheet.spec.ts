import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { Observable, Subject, of, throwError } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiErrorService } from '../../../services/api-error.service';
import { DriverRentalChargesService } from '../../../services/driver-rental-charges.service';
import { ExternalNavigationService } from '../../../services/external-navigation.service';
import { NotificationService } from '../../../services/notification.service';
import { DriverCharge, DriverChargePix } from '../../../types/driver-charges.types';
import {
  DriverPaySheet,
  PIX_COPIED,
  PIX_COPY_FALLBACK,
  PIX_RETRY_WAIT_S,
  validUntil,
} from './driver-pay-sheet';
import { DRIVER_RENTAL_TODAY } from './driver-rental-view';

const flat = (el: Element | null | undefined): string =>
  (el?.textContent ?? '').replace(/\s+/g, ' ').trim();

const TODAY = '2026-10-10';
const PAYLOAD = '00020126580014BR.GOV.BCB.PIX0136a1b2c3d4-e5f6-7890-abcd-ef1234567890';

const charge = (over: Partial<DriverCharge> = {}): DriverCharge => ({
  id: 'c10',
  kind: 'RENTAL_PERIOD',
  amount: 65000,
  status: 'PENDING',
  dueDate: '2026-10-13',
  periodIndex: 10,
  paidAt: null,
  checkoutUrl: 'https://pay.example/i/10',
  ...over,
});

describe('DriverPaySheet', () => {
  let fixture: ComponentFixture<DriverPaySheet>;
  let pixCall: ReturnType<typeof vi.fn>;
  let openExternal: ReturnType<typeof vi.fn>;
  let success: ReturnType<typeof vi.fn>;
  let closed: number;

  const root = () => document.body;
  const q = (sel: string) => (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>(sel);

  function build(pix: () => Observable<DriverChargePix>, c: DriverCharge | null = charge()): void {
    pixCall = vi.fn(pix);
    openExternal = vi.fn(() => true);
    success = vi.fn();
    closed = 0;
    TestBed.configureTestingModule({
      providers: [
        provideNoopAnimations(),
        ApiErrorService,
        { provide: DRIVER_RENTAL_TODAY, useValue: () => TODAY },
        { provide: DriverRentalChargesService, useValue: { pix: pixCall } },
        { provide: ExternalNavigationService, useValue: { openExternal } },
        { provide: NotificationService, useValue: { success, error: vi.fn(), warning: vi.fn() } },
      ],
    });
    fixture = TestBed.createComponent(DriverPaySheet);
    fixture.componentRef.setInput('rentalId', 'r1');
    fixture.componentRef.setInput('chargeTitle', 'Aluguel semanal · semana 11');
    fixture.componentRef.setInput('charge', c);
    fixture.componentInstance.closed.subscribe(() => closed++);
    fixture.detectChanges();
    fixture.detectChanges();
  }

  const ready = () => of({ payload: PAYLOAD, qrCodeBase64: null, expiresAt: null });

  /** jsdom has no clipboard: define one (or none) on the REAL navigator the page reads. */
  function setClipboard(value: unknown): void {
    Object.defineProperty(window.navigator, 'clipboard', { value, configurable: true });
  }

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    document.body.style.overflow = '';
    setClipboard(undefined);
  });

  it('fechado (sem cobrança) não renderiza nada e não pede Pix', () => {
    build(ready, null);
    expect(q('[role="dialog"]')).toBeNull();
    expect(pixCall).not.toHaveBeenCalled();
  });

  it('abre como diálogo "Pagar cobrança" com valor, vencimento e o Pix pedido ao endpoint', () => {
    build(ready);

    const dialog = q('[role="dialog"]')!;
    expect(dialog).not.toBeNull();
    expect(flat(dialog)).toContain('Pagar cobrança');
    expect(flat(dialog)).toContain('Aluguel semanal · semana 11 · vence 13/10/2026');
    expect(flat(q('[data-pay-value]'))).toBe('R$ 650,00');
    expect(pixCall).toHaveBeenCalledWith('r1', 'c10');
    expect(flat(q('[data-pix-code]'))).toBe(PAYLOAD);
    expect(q('[data-pay-late]')).toBeNull();
    expect(flat(dialog)).toContain('O pagamento é confirmado em até 1 minuto');
  });

  it('enquanto o Pix não chega: esqueleto e "Copiar" desabilitado', () => {
    const pending = new Subject<DriverChargePix>();
    build(() => pending);

    expect(q('[data-pix-loading]')).not.toBeNull();
    expect((q('[data-copy]') as HTMLButtonElement).disabled).toBe(true);
  });

  it('atrasada: avisa que pode incluir multa e juros, sem inventar o valor deles', () => {
    build(ready, charge({ dueDate: '2026-10-06' }));

    expect(flat(q('[data-pay-late]'))).toBe('Pode incluir multa e juros por atraso.');
    expect(flat(q('[data-pay-value]'))).toBe('R$ 650,00');
    expect(flat(q('[role="dialog"]'))).toContain('venceu em 06/10/2026');
  });

  describe('Copiar código Pix', () => {
    it('copia pelo clipboard, avisa com o toast do protótipo e fecha', async () => {
      const writeText = vi.fn(() => Promise.resolve());
      setClipboard({ writeText });
      build(ready);

      q('[data-copy]')!.click();
      await fixture.whenStable();

      expect(writeText).toHaveBeenCalledWith(PAYLOAD);
      expect(success).toHaveBeenCalledWith(PIX_COPIED);
      expect(PIX_COPIED).toBe('Código Pix copiado. Cole no app do seu banco.');
      expect(closed).toBe(1);
    });

    it('sem clipboard: seleciona o código, explica, e NÃO diz que copiou', async () => {
      setClipboard(undefined);
      build(ready);

      q('[data-copy]')!.click();
      await fixture.whenStable();
      fixture.detectChanges();

      expect(success).not.toHaveBeenCalled();
      expect(closed).toBe(0);
      expect(flat(q('[data-copy-hint]'))).toBe(PIX_COPY_FALLBACK);
      expect(window.getSelection()?.toString()).toBe(PAYLOAD);
    });

    it('clipboard recusado (permissão): mesmo caminho da seleção', async () => {
      const writeText = vi.fn(() => Promise.reject(new Error('NotAllowedError')));
      setClipboard({ writeText });
      build(ready);

      q('[data-copy]')!.click();
      await fixture.whenStable();
      fixture.detectChanges();

      expect(writeText).toHaveBeenCalled();
      expect(success).not.toHaveBeenCalled();
      expect(q('[data-copy-hint]')).not.toBeNull();
    });
  });

  describe('QR e validade', () => {
    it('mostra o QR (PNG base64 sem prefixo) e "Válido até dd/mm, HH:mm"', () => {
      build(() => of({ payload: PAYLOAD, qrCodeBase64: 'iVBORw0KGgo=', expiresAt: '2026-10-22T23:59:00-03:00' }));

      const img = q('[data-pix-qr]') as HTMLImageElement;
      expect(img.getAttribute('src')).toBe('data:image/png;base64,iVBORw0KGgo=');
      expect(img.getAttribute('alt')).toBe('QR code do Pix');
      expect(flat(q('[data-pix-valid]'))).toBe('Válido até 22/10, 23:59');
    });

    it('sem QR nem validade: só o copia e cola', () => {
      build(ready);
      expect(q('[data-pix-qr]')).toBeNull();
      expect(q('[data-pix-valid]')).toBeNull();
    });

    it('QR que não é base64 não vira src', () => {
      build(() => of({ payload: PAYLOAD, qrCodeBase64: '"><script>', expiresAt: null }));
      expect(q('[data-pix-qr]')).toBeNull();
    });

    it('validade lida no fuso de negócio, de qualquer offset', () => {
      expect(validUntil('2026-10-23T02:59:00Z')).toBe('Válido até 22/10, 23:59');
      expect(validUntil(null)).toBe('');
      expect(validUntil('amanhã')).toBe('');
    });
  });

  describe('Ver fatura', () => {
    it('abre a fatura (checkoutUrl) como link externo', () => {
      build(ready);

      const invoice = q('[data-invoice]')!;
      expect(flat(invoice)).toBe('Ver fatura');
      invoice.click();

      expect(openExternal).toHaveBeenCalledTimes(1);
      expect(openExternal).toHaveBeenCalledWith('https://pay.example/i/10');
    });

    it('não existe "Ver boleto": a cobrança é emitida como Pix', () => {
      build(ready);
      expect(flat(q('[role="dialog"]'))).not.toContain('boleto');
    });

    it('toque duplo abre UMA aba', () => {
      vi.useFakeTimers();
      build(ready);

      q('[data-invoice]')!.click();
      fixture.detectChanges();
      q('[data-invoice]')!.click();

      expect(openExternal).toHaveBeenCalledTimes(1);
      vi.advanceTimersByTime(1000);
      fixture.detectChanges();
      q('[data-invoice]')!.click();
      expect(openExternal).toHaveBeenCalledTimes(2);
    });

    it('sem fatura: o botão não existe', () => {
      build(ready, charge({ checkoutUrl: null }));
      expect(q('[data-invoice]')).toBeNull();
    });
  });

  describe('Pix falhou', () => {
    const unavailable = () =>
      throwError(
        () =>
          new HttpErrorResponse({
            status: 503,
            error: { message: 'Não foi possível gerar o Pix agora. Tente de novo em instantes.' },
          }),
      );

    it('mostra a mensagem do servidor e oferece a página de pagamento no lugar de "Copiar"', () => {
      build(unavailable);

      expect(flat(q('[data-pix-error]'))).toContain(
        'Não foi possível gerar o Pix agora. Tente de novo em instantes.',
      );
      expect(q('[data-copy]')).toBeNull();
      expect(q('[data-invoice]')).toBeNull();
      expect(q('[data-pix-code]')).toBeNull();

      const open = q('[data-open-checkout]')!;
      expect(flat(open)).toBe('Abrir página de pagamento');
      open.click();
      expect(openExternal).toHaveBeenCalledWith('https://pay.example/i/10');
    });

    it('503: "Tentar de novo" só destrava depois da espera, e então pede o Pix de novo', () => {
      vi.useFakeTimers();
      let calls = 0;
      build(() => (++calls === 1 ? unavailable() : ready()));

      const retry = () => q('[data-pix-retry]') as HTMLButtonElement;
      expect(PIX_RETRY_WAIT_S).toBe(5);
      expect(retry().disabled).toBe(true);
      expect(flat(retry())).toBe('Tentar de novo em 5 s');

      retry().click();
      expect(pixCall).toHaveBeenCalledTimes(1);

      vi.advanceTimersByTime(PIX_RETRY_WAIT_S * 1000);
      fixture.detectChanges();
      expect(retry().disabled).toBe(false);
      expect(flat(retry())).toBe('Tentar de novo');

      retry().click();
      fixture.detectChanges();
      expect(pixCall).toHaveBeenCalledTimes(2);
      expect(flat(q('[data-pix-code]'))).toBe(PAYLOAD);
    });

    it('409 de sessão somente leitura: mensagem como veio, sem "Tentar de novo"', () => {
      build(() =>
        throwError(
          () =>
            new HttpErrorResponse({
              status: 409,
              error: { message: 'Pix não disponível em sessão somente leitura.' },
            }),
        ),
      );

      expect(flat(q('[data-pix-error]'))).toContain('Pix não disponível em sessão somente leitura.');
      expect(q('[data-pix-retry]')).toBeNull();
    });

    it('409 do backend: a mensagem como veio, e a saída pela página de pagamento', () => {
      build(() =>
        throwError(
          () =>
            new HttpErrorResponse({
              status: 409,
              error: { message: 'Esta cobrança não tem Pix disponível.' },
            }),
        ),
      );

      expect(flat(q('[data-pix-error]'))).toContain('Esta cobrança não tem Pix disponível.');
      expect(q('[data-open-checkout]')).not.toBeNull();
    });

    it('resposta sem código também é falha, com a mensagem padrão', () => {
      build(() => throwError(() => new Error('Pix sem código')));

      expect(flat(q('[data-pix-error]'))).toContain('Não foi possível gerar o código Pix agora.');
    });
  });

  it('fechar (X) emite closed', () => {
    build(ready);

    root().querySelector<HTMLButtonElement>('[role="dialog"] button[aria-label="Fechar"]')!.click();

    expect(closed).toBe(1);
  });
});
