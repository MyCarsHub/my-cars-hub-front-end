import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { InsuranceInstallmentsCard } from './insurance-installments-card';
import { InsurancesService } from '../../services/insurances.service';
import { ApiErrorService } from '../../services/api-error.service';
import { NotificationService } from '../../services/notification.service';
import type { InsuranceInstallment } from '../../types/insurance.types';

/**
 * Parcelamento do prêmio: geração do cronograma, pagar/desfazer, e o caso em
 * que o backend recusa apagar um cronograma com parcela paga.
 *
 * O fixture usa o arredondamento REAL do backend (R$ 1.000,00 em 3x →
 * 333,34 / 333,33 / 333,33) para provar que a tela soma exatamente o prêmio em
 * vez de "corrigir" a distribuição dos centavos.
 */
describe('InsuranceInstallmentsCard', () => {
  const INSURANCE_ID = 'ins-1';
  const PREMIUM_CENTS = 100_000;

  function row(
    number: number,
    amountCents: number,
    paid = false,
    paidAmountCents: number | null = null,
  ): InsuranceInstallment {
    return {
      id: `p-${number}`,
      insuranceId: INSURANCE_ID,
      number,
      dueDate: `2026-0${number}-10`,
      amountCents,
      paidDate: paid ? '2026-01-15' : null,
      paidAmountCents: paid ? (paidAmountCents ?? amountCents) : null,
      paid,
    };
  }

  /** Resto distribuído centavo a centavo nas primeiras parcelas. */
  const schedule: InsuranceInstallment[] = [
    row(1, 33_334),
    row(2, 33_333),
    row(3, 33_333),
  ];

  let generateInstallments: ReturnType<typeof vi.fn>;
  let payInstallment: ReturnType<typeof vi.fn>;
  let unpayInstallment: ReturnType<typeof vi.fn>;
  let deleteInstallments: ReturnType<typeof vi.fn>;
  let successToast: ReturnType<typeof vi.fn>;
  let claim: ReturnType<typeof vi.fn>;
  let fixture: ComponentFixture<InsuranceInstallmentsCard>;

  /** Acesso tipado aos membros `protected` exercitados pelo teste. */
  interface CardInternals {
    form: { patchValue(v: Record<string, unknown>): void };
    error(): string | null;
    installments(): InsuranceInstallment[];
    hasSchedule(): boolean;
    totalCents(): number;
    paidCents(): number;
    remainingCents(): number;
    openCents(): number;
    overpaidCents(): number;
    hasOverpayment(): boolean;
    totalMatchesPremium(): boolean;
    generate(): void;
    askPay(r: InsuranceInstallment): void;
    confirmPay(paidDate: string): void;
    askUnpay(r: InsuranceInstallment): void;
    confirmUnpay(): void;
    confirmDeleteSchedule(): void;
  }

  function api(): CardInternals {
    return fixture.componentInstance as unknown as CardInternals;
  }

  /** NBSP/narrow-NBSP viram espaco comum: o Intl usa U+00A0 depois do "R$". */
  function normalize(value: string): string {
    return value
      .replace(/[\u00a0\u202f]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /** Mesma formatacao da tela, para comparar texto sem repetir o literal. */
  function brl(cents: number): string {
    return normalize(
      new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100),
    );
  }

  function textOf(el: Element | null): string {
    return normalize(el?.textContent ?? '');
  }

  /**
   * A LISTA EM FORMATO DE CARD — `lg:hidden`, o que aparece abaixo de 1024px,
   * onde o app é de fato usado. Consultar só `fixture.nativeElement` não provaria
   * nada: a tabela do desktop está no mesmo DOM sob jsdom, e era justamente ela
   * que já mostrava o valor pago.
   */
  function cardList(): Element | null {
    return fixture.nativeElement.querySelector('ul[class*="lg:hidden"]');
  }

  function desktopTable(): Element | null {
    return fixture.nativeElement.querySelector('table');
  }

  async function setup(initial: InsuranceInstallment[] = []): Promise<void> {
    fixture = TestBed.createComponent(InsuranceInstallmentsCard);
    fixture.componentRef.setInput('insuranceId', INSURANCE_ID);
    fixture.componentRef.setInput('premiumAmount', PREMIUM_CENTS);
    fixture.componentRef.setInput('schedule', initial);
    await fixture.whenStable();
    fixture.detectChanges();
  }

  beforeEach(() => {
    generateInstallments = vi.fn(() => of(schedule));
    payInstallment = vi.fn(() => of([row(1, 33_334, true), schedule[1], schedule[2]]));
    unpayInstallment = vi.fn(() => of(schedule));
    deleteInstallments = vi.fn(() => of(void 0));
    successToast = vi.fn();
    claim = vi.fn();

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        provideNoopAnimations(),
        {
          provide: InsurancesService,
          useValue: {
            generateInstallments,
            payInstallment,
            unpayInstallment,
            deleteInstallments,
          },
        },
        {
          provide: NotificationService,
          useValue: { success: successToast, info: vi.fn(), error: vi.fn(), warning: vi.fn() },
        },
        {
          provide: ApiErrorService,
          useValue: {
            claim,
            messageFor: vi.fn((_e: unknown, fallback?: string) => fallback ?? 'Erro'),
            handleForm: vi.fn((_e: unknown, _f: unknown, fallback?: string) => ({
              formMessage: fallback ?? 'Erro',
            })),
          },
        },
      ],
    });
  });

  it('gera o cronograma e adota a resposta sem novo GET', async () => {
    await setup([]);
    expect(api().hasSchedule()).toBe(false);

    api().form.patchValue({ installments: 3, firstDueDate: '2026-01-10' });
    api().generate();
    fixture.detectChanges();

    expect(generateInstallments).toHaveBeenCalledWith(INSURANCE_ID, {
      installments: 3,
      firstDueDate: '2026-01-10',
    });
    expect(api().installments()).toEqual(schedule);
    expect(successToast).toHaveBeenCalledWith('Cronograma gerado.');
  });

  it('envia firstDueDate nulo quando o campo fica em branco', async () => {
    await setup([]);

    api().form.patchValue({ installments: 6, firstDueDate: '' });
    api().generate();

    expect(generateInstallments).toHaveBeenCalledWith(INSURANCE_ID, {
      installments: 6,
      firstDueDate: null,
    });
  });

  it('não chama a API com número de parcelas fora de 1..120', async () => {
    await setup([]);

    api().form.patchValue({ installments: 121 });
    api().generate();
    fixture.detectChanges();

    expect(generateInstallments).not.toHaveBeenCalled();
    expect(api().error()).toContain('número de parcelas');
  });

  it('o total das parcelas fecha exatamente o prêmio apesar do arredondamento', async () => {
    await setup(schedule);

    // 333,34 + 333,33 + 333,33 = 1.000,00 — a tela não "corrige" a diferença.
    expect(api().totalCents()).toBe(PREMIUM_CENTS);
    expect(api().totalMatchesPremium()).toBe(true);
  });

  it('marca parcela como paga com a data escolhida e adota o cronograma devolvido', async () => {
    await setup(schedule);

    api().askPay(schedule[0]);
    api().confirmPay('2026-01-15');
    fixture.detectChanges();

    expect(payInstallment).toHaveBeenCalledWith(INSURANCE_ID, 'p-1', {
      paidDate: '2026-01-15',
    });
    expect(api().installments()[0].paid).toBe(true);
    expect(api().paidCents()).toBe(33_334);
    expect(api().remainingCents()).toBe(66_666);
    expect(successToast).toHaveBeenCalledWith('Parcela marcada como paga.');
  });

  it('desfaz o pagamento e volta ao cronograma sem parcelas pagas', async () => {
    await setup([row(1, 33_334, true), schedule[1], schedule[2]]);
    expect(api().paidCents()).toBe(33_334);

    api().askUnpay(api().installments()[0]);
    api().confirmUnpay();
    fixture.detectChanges();

    expect(unpayInstallment).toHaveBeenCalledWith(INSURANCE_ID, 'p-1');
    expect(api().installments().some((r) => r.paid)).toBe(false);
    expect(api().paidCents()).toBe(0);
    expect(successToast).toHaveBeenCalledWith('Pagamento desfeito.');
  });

  /**
   * O achado: o valor efetivamente pago só existia na tabela do desktop. Abaixo
   * de 1024px — o formato em que o app é usado — uma parcela de R$ 333,34
   * quitada com R$ 500,00 ficava indistinguível de uma quitada corretamente.
   */
  it('mostra o valor pago no formato de CARD, não só na tabela do desktop', async () => {
    await setup([row(1, 33_334, true, 50_000), schedule[1], schedule[2]]);

    expect(textOf(cardList())).toContain(brl(50_000));
  });

  it('destaca no card a parcela quitada com valor diferente do devido', async () => {
    await setup([row(1, 33_334, true, 50_000), schedule[1], schedule[2]]);

    const card = textOf(cardList());
    expect(card).toContain(brl(50_000));
    expect(card).toContain('diferente do valor da parcela');
  });

  it('não destaca divergência quando a parcela foi paga pelo valor certo', async () => {
    await setup([row(1, 33_334, true), schedule[1], schedule[2]]);

    const card = textOf(cardList());
    expect(card).toContain(brl(33_334));
    expect(card).not.toContain('diferente do valor da parcela');
  });

  /**
   * `Math.max(0, total - pago)` zerava o excedente: quem pagasse acima do devido
   * via "R$ 0,00 em aberto" e mais nada. O saldo agora é bruto e o excedente tem
   * número próprio.
   */
  it('não zera o excedente quando o pago passa do total parcelado', async () => {
    await setup([row(1, 33_334, true, 50_000), row(2, 33_333, true), row(3, 33_333, true)]);

    // 50.000 + 33.333 + 33.333 = 116.666 pagos contra 100.000 parcelados.
    expect(api().paidCents()).toBe(116_666);
    expect(api().remainingCents()).toBe(-16_666);
    expect(api().hasOverpayment()).toBe(true);
    expect(api().overpaidCents()).toBe(16_666);
    expect(api().openCents()).toBe(0);
  });

  it('anuncia o pagamento a maior na tela, fora da tabela do desktop', async () => {
    await setup([row(1, 33_334, true, 50_000), row(2, 33_333, true), row(3, 33_333, true)]);

    // O aviso e o total "Pago a mais" vivem fora da tabela — visíveis no celular.
    const table = textOf(desktopTable());
    const outsideTable = textOf(fixture.nativeElement).replace(table, '');
    expect(outsideTable).toContain('Pago a mais');
    expect(outsideTable).toContain(brl(16_666));
  });

  it('mantém "Em aberto" sem sinal negativo quando ainda falta pagar', async () => {
    await setup([row(1, 33_334, true), schedule[1], schedule[2]]);

    expect(api().hasOverpayment()).toBe(false);
    expect(api().openCents()).toBe(66_666);
    expect(api().overpaidCents()).toBe(0);
    expect(textOf(fixture.nativeElement)).toContain('Em aberto');
  });

  it('apaga o cronograma quando nenhuma parcela foi paga', async () => {
    await setup(schedule);

    api().confirmDeleteSchedule();
    fixture.detectChanges();

    expect(deleteInstallments).toHaveBeenCalledWith(INSURANCE_ID);
    expect(api().installments()).toEqual([]);
    expect(api().hasSchedule()).toBe(false);
  });

  it('explica o 409 de apagar cronograma com parcela paga em vez do erro genérico', async () => {
    deleteInstallments.mockReturnValue(
      throwError(() => new HttpErrorResponse({ status: 409, statusText: 'Conflict' })),
    );
    await setup([row(1, 33_334, true), schedule[1], schedule[2]]);

    api().confirmDeleteSchedule();
    fixture.detectChanges();

    expect(api().error()).toBe(
      'Não é possível apagar um cronograma com parcelas já pagas. ' +
        'Desfaça os pagamentos e tente de novo.',
    );
    // O cronograma continua na tela — nada foi apagado localmente.
    expect(api().hasSchedule()).toBe(true);
    // Erro reivindicado: o safety net do interceptor não dispara um segundo toast.
    expect(claim).toHaveBeenCalled();
  });

  it('usa a mesma explicação quando o backend responde 400 em vez de 409', async () => {
    deleteInstallments.mockReturnValue(
      throwError(() => new HttpErrorResponse({ status: 400, statusText: 'Bad Request' })),
    );
    await setup([row(1, 33_334, true), schedule[1], schedule[2]]);

    api().confirmDeleteSchedule();
    fixture.detectChanges();

    expect(api().error()).toContain('parcelas já pagas');
    expect(api().hasSchedule()).toBe(true);
  });
});
