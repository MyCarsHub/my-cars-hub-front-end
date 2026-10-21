import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Observable, Subject, of, throwError } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiErrorService } from '../../services/api-error.service';
import { DriverRentalChargesService } from '../../services/driver-rental-charges.service';
import { ExternalNavigationService } from '../../services/external-navigation.service';
import { DriverCharge } from '../../types/driver-charges.types';
import { todayInBusinessTz } from '../../utils/business-clock';
import { DriverCharges } from './driver-charges';

const flat = (el: Element | null | undefined): string =>
  (el?.textContent ?? '').replace(/\s+/g, ' ').trim();

/** `yyyy-MM-dd` of today plus `days` — the same business clock the component reads. */
function dayFromToday(days: number): string {
  const [y, m, d] = todayInBusinessTz().split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

const charge = (over: Partial<DriverCharge> = {}): DriverCharge => ({
  id: 'c-1',
  kind: 'RENTAL_PERIOD',
  amount: 120000,
  status: 'PENDING',
  dueDate: dayFromToday(5),
  periodIndex: 1,
  paidAt: null,
  checkoutUrl: 'https://pay.example/i/abc',
  ...over,
});

describe('DriverCharges', () => {
  let fixture: ComponentFixture<DriverCharges>;
  let listCall: ReturnType<typeof vi.fn>;
  let openExternal: ReturnType<typeof vi.fn>;

  const root = () => fixture.nativeElement as HTMLElement;
  const q = (sel: string) => root().querySelector<HTMLElement>(sel);
  const qa = (sel: string) => Array.from(root().querySelectorAll<HTMLElement>(sel));

  function build(list: () => Observable<DriverCharge[]>, rentalId = 'r-7'): void {
    listCall = vi.fn(list);
    openExternal = vi.fn(() => true);
    TestBed.configureTestingModule({
      providers: [
        ApiErrorService,
        { provide: DriverRentalChargesService, useValue: { list: listCall } },
        { provide: ExternalNavigationService, useValue: { openExternal } },
      ],
    });
    fixture = TestBed.createComponent(DriverCharges);
    fixture.componentRef.setInput('rentalId', rentalId);
    fixture.detectChanges();
  }

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('carga', () => {
    it('pede as cobranças do aluguel recebido, pelo endpoint do motorista', () => {
      build(() => of([charge()]), 'r-42');

      expect(listCall).toHaveBeenCalledTimes(1);
      expect(listCall).toHaveBeenCalledWith('r-42');
    });

    it('mostra o carregando enquanto espera, sem lista nem aviso de vazio', () => {
      const pending = new Subject<DriverCharge[]>();
      build(() => pending);

      expect(q('[data-loading]')).not.toBeNull();
      expect(q('[data-empty]')).toBeNull();
      expect(q('[data-load-error]')).toBeNull();

      pending.next([charge()]);
      fixture.detectChanges();
      expect(q('[data-loading]')).toBeNull();
      expect(q('[data-next]')).not.toBeNull();
    });
  });

  describe('o que vence agora', () => {
    it('mostra valor, data e o botão "Pagar com Pix" que abre o link de pagamento fora do app', () => {
      build(() => of([charge({ dueDate: '2099-11-05', amount: 123456 })]));

      const next = q('[data-next]')!;
      expect(flat(next)).toContain('R$ 1.234,56');
      expect(flat(next)).toContain('Vence em 05/11/2099');
      const button = next.querySelector<HTMLButtonElement>('[data-pay]')!;
      expect(button.textContent?.trim()).toBe('Pagar com Pix');

      button.click();

      expect(openExternal).toHaveBeenCalledTimes(1);
      expect(openExternal).toHaveBeenCalledWith('https://pay.example/i/abc');
    });

    it('depois de tocar, diz que abriu em outra aba e deixa um link de verdade para abrir de novo', () => {
      build(() => of([charge()]));

      q('[data-pay]')!.click();
      fixture.detectChanges();

      const note = q('[data-pay-note]')!;
      expect(flat(note)).toContain('Abrimos o pagamento em outra aba.');
      const again = note.querySelector<HTMLAnchorElement>('[data-pay-again]')!;
      expect(again.getAttribute('href')).toBe('https://pay.example/i/abc');
      expect(again.getAttribute('target')).toBe('_blank');
      expect(again.getAttribute('rel')).toBe('noopener noreferrer');
    });

    it('se o navegador não abrir a aba, o aviso muda mas o link de reserva continua lá', () => {
      build(() => of([charge()]));
      openExternal.mockReturnValue(false);

      q('[data-pay]')!.click();
      fixture.detectChanges();

      expect(flat(q('[data-pay-note]'))).toContain('O navegador não abriu a outra aba.');
      expect(q('[data-pay-again]')).not.toBeNull();
    });

    it('toque duplo abre uma aba só; passado ~1 s o botão volta', () => {
      vi.useFakeTimers();
      build(() => of([charge()]));
      const button = q('[data-pay]') as HTMLButtonElement;

      button.click();
      fixture.detectChanges();
      expect(button.disabled).toBe(true);
      button.click();
      expect(openExternal).toHaveBeenCalledTimes(1);

      vi.advanceTimersByTime(1000);
      fixture.detectChanges();
      expect(button.disabled).toBe(false);
      button.click();
      expect(openExternal).toHaveBeenCalledTimes(2);
    });

    it('vencendo hoje, diz "Vence hoje"', () => {
      build(() => of([charge({ dueDate: todayInBusinessTz() })]));

      expect(flat(q('[data-next]'))).toContain('Vence hoje');
    });

    it('o destaque é o que vence primeiro; os outros ficam na lista de próximas, sem botão', () => {
      build(() =>
        of([
          charge({ id: 'later', dueDate: dayFromToday(40), amount: 90000 }),
          charge({ id: 'soon', dueDate: dayFromToday(3), amount: 110000 }),
        ]),
      );

      expect(flat(q('[data-next]'))).toContain('R$ 1.100,00');
      expect(qa('[data-pay]').length).toBe(1);
      const upcoming = q('[data-upcoming]')!;
      expect(flat(upcoming)).toContain('R$ 900,00');
      expect(upcoming.querySelector('button')).toBeNull();
    });

    it('sem link de pagamento, não finge um botão: manda falar com a locadora', () => {
      build(() => of([charge({ checkoutUrl: null })]));

      expect(q('[data-pay]')).toBeNull();
      expect(flat(q('[data-no-link]'))).toContain('Fale com a locadora');
    });
  });

  describe('vencidas', () => {
    it('ficam em vermelho, antes do resto, com "Pagar agora"', () => {
      build(() =>
        of([
          charge({ id: 'ok', dueDate: dayFromToday(2) }),
          charge({ id: 'late', status: 'PAST_DUE', dueDate: '2020-01-10', amount: 50000 }),
        ]),
      );

      const overdue = q('[data-overdue]')!;
      expect(overdue.className).toContain('border-rose-300');
      expect(flat(overdue)).toContain('Atrasada');
      expect(flat(overdue)).toContain('R$ 500,00');
      expect(flat(overdue)).toContain('Venceu em 10/01/2020');
      const buttons = qa('[data-pay]');
      expect(buttons.map((b) => b.textContent?.trim())).toEqual(['Pagar agora', 'Pagar com Pix']);

      buttons[0].click();
      expect(openExternal).toHaveBeenCalledWith('https://pay.example/i/abc');
    });

    it('uma PENDING que já passou do vencimento também é tratada como atrasada', () => {
      build(() => of([charge({ status: 'PENDING', dueDate: dayFromToday(-3) })]));

      expect(q('[data-overdue]')).not.toBeNull();
      expect(q('[data-next]')).toBeNull();
    });
  });

  describe('pagas', () => {
    it('entram numa lista compacta com a data do pagamento', () => {
      build(() =>
        of([
          charge({
            id: 'p-1',
            status: 'PAID',
            paidAt: '2026-09-12T15:30:00',
            checkoutUrl: null,
            amount: 80000,
          }),
        ]),
      );

      const history = q('[data-history]')!;
      expect(flat(history)).toContain('Pago em 12/09/2026');
      expect(flat(history)).toContain('R$ 800,00');
      expect(q('[data-pay]')).toBeNull();
    });

    it('o que é assunto do operador (falhou, cancelada, liberada, contestada) não aparece', () => {
      build(() =>
        of([
          charge({ id: 'a', status: 'FAILED', checkoutUrl: null }),
          charge({ id: 'b', status: 'CANCELED', checkoutUrl: null }),
          charge({ id: 'c', status: 'RELEASED', checkoutUrl: null }),
          charge({ id: 'd', status: 'DISPUTED', checkoutUrl: null }),
        ]),
      );

      expect(q('[data-empty]')).not.toBeNull();
      expect(flat(root())).not.toMatch(/falhou|cancelada|liberad|contestad/i);
    });
  });

  describe('estados', () => {
    it('sem cobrança nenhuma: "Nenhuma cobrança por enquanto"', () => {
      build(() => of([]));

      expect(flat(q('[data-empty]'))).toBe('Nenhuma cobrança por enquanto');
      expect(q('[data-pay]')).toBeNull();
    });

    it('erro: mostra o aviso com "Tentar novamente", que busca de novo', () => {
      let attempt = 0;
      build(() =>
        ++attempt === 1 ? throwError(() => new HttpErrorResponse({ status: 500 })) : of([charge()]),
      );

      const banner = q('[data-load-error]')!;
      expect(flat(banner)).toContain('Não foi possível carregar os pagamentos.');
      const retry = banner.querySelector<HTMLButtonElement>('button')!;
      expect(retry.textContent?.trim()).toBe('Tentar novamente');

      retry.click();
      fixture.detectChanges();

      expect(listCall).toHaveBeenCalledTimes(2);
      expect(q('[data-load-error]')).toBeNull();
      expect(q('[data-next]')).not.toBeNull();
    });

    it('aluguel de outro motorista (404): mensagem clara, sem quebrar e sem "tentar de novo"', () => {
      build(() => throwError(() => new HttpErrorResponse({ status: 404 })));

      const banner = q('[data-load-error]')!;
      expect(flat(banner)).toContain('Não encontramos os pagamentos deste aluguel.');
      expect(banner.querySelector('button')).toBeNull();
      expect(q('[data-pay]')).toBeNull();
    });

    it('não mostra id, provedor nem código de falha', () => {
      build(() => of([charge({ id: 'uuid-secreto-123' })]));

      expect(root().innerHTML).not.toContain('uuid-secreto-123');
    });
  });

  describe('voltar do pagamento', () => {
    it('ao voltar para a aba, busca de novo em silêncio (sem sumir com o que já está na tela)', () => {
      let attempt = 0;
      build(() =>
        of(
          ++attempt === 1
            ? [charge()]
            : [charge({ status: 'PAID', paidAt: '2026-10-20T12:00:00', checkoutUrl: null })],
        ),
      );
      expect(q('[data-next]')).not.toBeNull();

      document.dispatchEvent(new Event('visibilitychange'));
      fixture.detectChanges();

      expect(listCall).toHaveBeenCalledTimes(2);
      expect(q('[data-next]')).toBeNull();
      expect(q('[data-history]')).not.toBeNull();
    });

    it('uma falha nessa busca silenciosa mantém a lista e não mostra erro', () => {
      let attempt = 0;
      build(() =>
        ++attempt === 1 ? of([charge()]) : throwError(() => new HttpErrorResponse({ status: 500 })),
      );

      document.dispatchEvent(new Event('visibilitychange'));
      fixture.detectChanges();

      expect(q('[data-load-error]')).toBeNull();
      expect(q('[data-next]')).not.toBeNull();
    });

    it('com a primeira carga ainda pendente, voltar para a aba não cancela nem refaz a busca', () => {
      const pending = new Subject<DriverCharge[]>();
      build(() => pending);

      document.dispatchEvent(new Event('visibilitychange'));
      fixture.detectChanges();

      expect(listCall).toHaveBeenCalledTimes(1);
      expect(q('[data-loading]')).not.toBeNull();

      pending.next([charge()]);
      fixture.detectChanges();
      expect(q('[data-next]')).not.toBeNull();
    });

    it('com a primeira carga falha, voltar para a aba não engole o erro nem some com o "Tentar novamente"', () => {
      build(() => throwError(() => new HttpErrorResponse({ status: 500 })));
      expect(q('[data-load-error]')).not.toBeNull();

      document.dispatchEvent(new Event('visibilitychange'));
      fixture.detectChanges();

      expect(listCall).toHaveBeenCalledTimes(1);
      expect(flat(q('[data-load-error]'))).toContain('Tentar novamente');
    });

    it('depois de destruído, a aba não dispara mais busca', () => {
      build(() => of([charge()]));
      fixture.destroy();

      document.dispatchEvent(new Event('visibilitychange'));

      expect(listCall).toHaveBeenCalledTimes(1);
    });
  });
});
