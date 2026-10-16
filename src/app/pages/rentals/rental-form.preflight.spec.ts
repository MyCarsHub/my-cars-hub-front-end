import { TestBed } from '@angular/core/testing';
import { provideRouter, ActivatedRoute } from '@angular/router';
import { signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { Observable, EMPTY, of, throwError } from 'rxjs';
import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';

import { RentalForm } from './rental-form';
import { RentalService } from './rental.service';
import { VehiclesService } from '../../services/vehicles.service';
import { DriverService } from '../../services/driver.service';
import { AsaasIntegrationService } from '../company-settings/integrations/asaas-integration.service';
import { ContractTemplateService } from '../company-settings/contract-template/contract-template-service';
import { RentalPreflightItem, RentalPreflightLimits } from '../../types/rental.types';

/**
 * FIX-0754 — o formulário espelha o preflight do backend (FIX-0752): problema no campo
 * certo, resumo para o que não tem campo, aviso que não bloqueia, botão impedido e a
 * ajuda dos campos vinda de `limits`. Nenhuma regra é decidida aqui: o mock do
 * `RentalService` devolve o que o backend devolveria.
 */
describe('RentalForm — preflight (FIX-0754)', () => {
  let fixture: ReturnType<typeof TestBed.createComponent<RentalForm>>;
  let preflight: Mock;
  let chargePreview: Mock;
  let createSpy: Mock;
  let updateSpy: Mock;

  type FormLike = {
    form: { patchValue: (v: Record<string, unknown>) => void; markAllAsTouched: () => void };
    submit: () => void;
  };

  const VALID = {
    vehicleId: 'veh-1',
    driverId: 'drv-1',
    startDate: '2026-08-01',
    endDate: '2026-08-31',
    billingFrequency: 'MONTHLY',
    caucaoReais: '',
    periodRateReais: '2.500,00',
    initialKm: 42_000,
    pickupDate: '2026-08-01T09:00',
    firstPaymentDate: '2026-08-05',
    lateFineType: 'PERCENT',
    lateFineValueInput: 2,
  };

  const LIMITS: RentalPreflightLimits = {
    interestPercentPerMonth: { min: 0, max: 10 },
    finePercent: { min: 0, max: 10 },
    fixedFineMaxCents: 9_999,
    minChargeCents: 500,
  };

  const item = (over: Partial<RentalPreflightItem>): RentalPreflightItem => ({
    field: null,
    code: 'INVALID_DATA',
    message: 'Mensagem do backend.',
    acceptedValue: null,
    severity: 'BLOCKING',
    ...over,
  });

  const answer = (
    issues: RentalPreflightItem[] = [],
    warnings: RentalPreflightItem[] = [],
  ): Observable<unknown> =>
    of({ ok: issues.length === 0, issues, warnings, limits: LIMITS });

  function mount(opts: { rentalId?: string | null; rental?: unknown } = {}): void {
    TestBed.resetTestingModule();
    sessionStorage.clear();
    localStorage.clear();
    preflight = vi.fn().mockReturnValue(answer());
    chargePreview = vi.fn().mockReturnValue(EMPTY);
    createSpy = vi.fn().mockReturnValue(of({ id: 'novo' }));
    updateSpy = vi.fn().mockReturnValue(of({ id: 'rental-1' }));
    // As escolhas do formulário existem nas listas: se não existissem, o refresh do
    // período as limparia no meio do teste e deslocaria a conferência.
    const vehiclePage = {
      content: [{ id: 'veh-1', plate: 'ABC1234', brand: 'Fiat', model: 'Argo' }],
      page: 0,
      size: 500,
      total: 1,
    };
    const driverPage = {
      content: [{ id: 'drv-1', name: 'Maria', status: 'ACTIVE' }],
      page: 0,
      size: 500,
      total: 1,
    };
    TestBed.configureTestingModule({
      imports: [RentalForm],
      providers: [
        provideRouter([{ path: '**', children: [] }]),
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { paramMap: { get: () => opts.rentalId ?? null } } },
        },
        { provide: VehiclesService, useValue: { list: () => of(vehiclePage) } },
        { provide: DriverService, useValue: { list: () => of(driverPage) } },
        {
          provide: RentalService,
          useValue: {
            getById: () => (opts.rental ? of(opts.rental) : EMPTY),
            preflight,
            chargePreview,
            create: createSpy,
            update: updateSpy,
          },
        },
        { provide: AsaasIntegrationService, useValue: { status: signal(null), load: () => EMPTY } },
        { provide: ContractTemplateService, useValue: { get: () => EMPTY } },
      ],
    });
    fixture = TestBed.createComponent(RentalForm);
    fixture.detectChanges();
  }

  const cmp = (): FormLike => fixture.componentInstance as unknown as FormLike;
  const el = <T extends Element>(sel: string): T | null =>
    fixture.nativeElement.querySelector(sel) as T | null;
  const text = (sel: string): string | null => el(sel)?.textContent?.replace(/\s+/g, ' ').trim() ?? null;
  const submitButton = (): HTMLButtonElement => el<HTMLButtonElement>('button[type="submit"]')!;

  /** Muda o formulário e espera o debounce do preflight (timers reais, como nos outros specs). */
  async function change(values: Record<string, unknown>): Promise<void> {
    cmp().form.patchValue(values);
    fixture.detectChanges();
    await settle();
  }

  async function settle(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 550));
    fixture.detectChanges();
  }

  function typeInto(selector: string, value: string): void {
    const input = el<HTMLInputElement>(selector)!;
    input.value = value;
    input.dispatchEvent(new InputEvent('input', { inputType: 'insertText' }));
    fixture.detectChanges();
  }

  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
  });

  afterEach(() => {
    sessionStorage.clear();
    localStorage.clear();
  });

  it('problema BLOCKING aparece no campo certo, com a mensagem do backend, e impede o botão', async () => {
    mount();
    preflight.mockReturnValue(
      answer([
        item({
          field: 'lateInterestPercentPerMonth',
          code: 'INTEREST_PERCENT_ABOVE_MAX',
          message: 'Os juros ao mês podem ir de 0% a 10%.',
        }),
      ]),
    );
    await change({ ...VALID });

    expect(text('#rental-late-interest-error')).toBe('Os juros ao mês podem ir de 0% a 10%.');
    expect(el('#rental-late-interest')!.getAttribute('aria-invalid')).toBe('true');
    expect(submitButton().disabled).toBe(true);
    expect(text('[data-testid="preflight-blocked"]')).toContain('Corrija 1 problema');

    cmp().submit();
    expect(createSpy).not.toHaveBeenCalled();
  });

  it('sem BLOCKING o botão fica liberado e a marca do campo some', async () => {
    mount();
    preflight.mockReturnValue(
      answer([item({ field: 'periodRate', code: 'CHARGE_BELOW_MINIMUM', message: 'Valor abaixo do mínimo.' })]),
    );
    await change({ ...VALID });
    expect(text('#rental-daily-error')).toBe('Valor abaixo do mínimo.');
    expect(submitButton().disabled).toBe(true);

    preflight.mockReturnValue(answer());
    await change({ periodRateReais: '2.600,00' });

    expect(el('#rental-daily-error')).toBeNull();
    expect(submitButton().disabled).toBe(false);
    cmp().submit();
    expect(createSpy).toHaveBeenCalledTimes(1);
  });

  it('WARNING aparece como aviso e NÃO bloqueia', async () => {
    mount();
    preflight.mockReturnValue(
      answer(
        [],
        [
          item({
            code: 'ASAAS_LIMITS_UNAVAILABLE',
            message: 'Não foi possível conferir a cota do Asaas agora.',
            severity: 'WARNING',
          }),
        ],
      ),
    );
    await change({ ...VALID });

    expect(text('[data-testid="preflight-warnings"]')).toContain(
      'Não foi possível conferir a cota do Asaas agora.',
    );
    expect(el('[data-testid="preflight-summary"]')).toBeNull();
    expect(submitButton().disabled).toBe(false);
  });

  it('obrigatório vazio do preflight não pinta a tela nem bloqueia (o formulário já acusa)', async () => {
    mount();
    preflight.mockReturnValue(
      answer([item({ field: 'vehicleId', code: 'REQUIRED_FIELD', message: 'Informe o veículo.' })]),
    );
    await change({ ...VALID, vehicleId: '' });

    expect(el('#rental-vehicle-error')).toBeNull();
    expect(el('[data-testid="preflight-summary"]')).toBeNull();
    expect(text('[data-testid="preflight-blocked"]')).toBeNull();
  });

  it('driver.* e problemas sem campo vão ao resumo do topo, com link para o cadastro do motorista', async () => {
    mount();
    preflight.mockReturnValue(
      answer([
        item({
          field: 'driver.document',
          code: 'DRIVER_DOCUMENT_INVALID',
          message: 'O CPF/CNPJ do motorista é inválido.',
        }),
      ]),
    );
    await change({ ...VALID });

    const summary = el<HTMLElement>('[data-testid="preflight-summary"]')!;
    expect(summary.textContent).toContain('O CPF/CNPJ do motorista é inválido.');
    const link = summary.querySelector('a')!;
    expect(link.getAttribute('href')).toBe('/motoristas/drv-1/editar');
    expect(submitButton().disabled).toBe(true);
  });

  it('código de integração leva a Configurações > Integrações', async () => {
    mount();
    preflight.mockReturnValue(
      answer([
        item({
          field: 'automaticCharge',
          code: 'AUTOMATIC_CHARGE_NO_INTEGRATION',
          message: 'Conecte o Asaas para usar cobrança automática.',
        }),
      ]),
    );
    await change({ ...VALID });

    const link = el<HTMLAnchorElement>('[data-testid="preflight-summary"] a')!;
    expect(link.getAttribute('href')).toBe('/configuracoes/integracoes');
    expect(link.textContent).toContain('Integrações');
  });

  it('mensagem da retirada aparece sob o campo de retirada', async () => {
    mount();
    preflight.mockReturnValue(
      answer([item({ field: 'pickupDate', code: 'PICKUP_OUT_OF_PERIOD', message: 'Retirada fora do período.' })]),
    );
    await change({ ...VALID });

    expect(text('#rental-pickup-date-server-error')).toBe('Retirada fora do período.');
    expect(submitButton().disabled).toBe(true);
  });

  it('ajuda dos juros mostra a faixa de limits e a equivalência em R$/dia sobre o valor do período', async () => {
    mount();
    await change({ ...VALID, periodRateReais: '3.000,00' });
    expect(text('#rental-late-interest-hint')).toContain('Faixa aceita: de 0% a 10% ao mês');

    typeInto('#rental-late-interest', '1,50');
    // 3.000,00 x 1,5% / 30 = R$ 1,50 por dia
    expect(text('#rental-late-interest-hint')).toContain(
      'Equivale a cerca de R$ 1,50 por dia de atraso sobre R$ 3.000,00.',
    );
  });

  it('ajuda da multa muda com o tipo: faixa no %, "menor que" no R$ (números de limits)', async () => {
    mount();
    await change({ ...VALID });
    expect(text('#rental-late-fine-value-hint')).toBe('Faixa aceita: de 0% a 10% do valor da cobrança.');

    await change({ lateFineType: 'FIXED', lateFineValueInput: '' });
    expect(text('#rental-late-fine-value-hint')).toBe(
      'Menor que R$ 100,00 (valor de cada cobrança).',
    );
  });

  it('o corpo conferido leva o % ao mês e nunca o juros em R$/dia na criação', async () => {
    mount();
    await change({ ...VALID, lateInterestPercent: '1,50' });
    const body = preflight.mock.calls.at(-1)![0] as Record<string, unknown>;
    expect(body['lateInterestPercentPerMonth']).toBe(1.5);
    expect(body).not.toHaveProperty('dailyInterestAmount');
    expect(body).not.toHaveProperty('rentalId');
  });

  it('só a conferência mais nova vale: mudanças em rajada geram UMA chamada', async () => {
    mount();
    await change({ ...VALID });
    const before = preflight.mock.calls.length;

    cmp().form.patchValue({ periodRateReais: '1,00' });
    fixture.detectChanges();
    cmp().form.patchValue({ periodRateReais: '12,00' });
    fixture.detectChanges();
    cmp().form.patchValue({ periodRateReais: '123,00' });
    fixture.detectChanges();
    await settle();

    expect(preflight.mock.calls.length - before).toBe(1);
    expect((preflight.mock.calls.at(-1)![0] as Record<string, unknown>)['periodRate']).toBe(12_300);
  });

  it('a requisição anterior é cancelada quando outra mudança chega com ela em voo', async () => {
    mount();
    let unsubscribed = 0;
    preflight.mockImplementation(
      () =>
        new Observable(() => {
          return () => {
            unsubscribed++;
          };
        }),
    );
    await change({ ...VALID });
    expect(unsubscribed).toBe(0);

    await change({ periodRateReais: '2.700,00' });
    expect(unsubscribed).toBe(1);
  });

  it('falha do preflight (rede) não bloqueia nem vira erro na tela', async () => {
    mount();
    preflight.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 0 })));
    await change({ ...VALID });

    expect(submitButton().disabled).toBe(false);
    expect(el('[data-testid="preflight-summary"]')).toBeNull();
  });

  it('falha do preflight DEPOIS de um BLOCKING: solta botão e marcas e avisa em status neutro', async () => {
    mount();
    preflight.mockReturnValue(
      answer([item({ field: 'periodRate', code: 'CHARGE_BELOW_MINIMUM', message: 'Abaixo do mínimo.' })]),
    );
    await change({ ...VALID });
    expect(submitButton().disabled).toBe(true);
    expect(text('#rental-daily-error')).toBe('Abaixo do mínimo.');

    preflight.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 404 })));
    await change({ periodRateReais: '2.700,00' });

    expect(submitButton().disabled).toBe(false);
    expect(el('#rental-daily-error')).toBeNull();
    expect(text('[data-testid="preflight-unavailable"]')).toBe(
      'Não foi possível conferir agora; o sistema confere de novo ao salvar.',
    );

    // Voltou: o status some.
    preflight.mockReturnValue(answer());
    await change({ periodRateReais: '2.800,00' });
    expect(el('[data-testid="preflight-unavailable"]')).toBeNull();
  });

  it('REQUIRED_FIELD de campo sem validação local vira item do resumo', async () => {
    mount();
    preflight.mockReturnValue(
      answer([item({ field: 'automaticCharge', code: 'REQUIRED_FIELD', message: 'Informe a cobrança.' })]),
    );
    await change({ ...VALID });
    expect(text('[data-testid="preflight-summary"]')).toContain('Informe a cobrança.');
    expect(submitButton().disabled).toBe(true);
  });

  it('acceptedValue aparece quando a mensagem não traz o valor aceito, sem duplicar quando traz', async () => {
    mount();
    preflight.mockReturnValue(
      answer([
        item({
          field: 'lateInterestPercentPerMonth',
          code: 'INTEREST_PERCENT_ABOVE_MAX',
          message: 'Juros acima do permitido.',
          acceptedValue: 'de 0% a 10%',
        }),
        item({
          field: 'driver.email',
          code: 'DRIVER_EMAIL_INVALID',
          message: 'E-mail inválido (ex.: a@b.com).',
          acceptedValue: 'a@b.com',
        }),
      ]),
    );
    await change({ ...VALID });
    expect(text('#rental-late-interest-error')).toBe('Juros acima do permitido. Aceito: de 0% a 10%');
    expect(text('[data-testid="preflight-summary"]')).toContain('E-mail inválido (ex.: a@b.com).');
    expect(text('[data-testid="preflight-summary"]')).not.toContain('Aceito:');
  });

  it('controles e mensagens do formulário têm 16px explícitos (text-base)', async () => {
    mount();
    await change({ ...VALID });
    const controls = fixture.nativeElement.querySelectorAll(
      'input:not([type="checkbox"]), select, textarea',
    ) as NodeListOf<HTMLElement>;
    expect(controls.length).toBeGreaterThan(10);
    for (const control of Array.from(controls)) {
      expect(control.className, control.id).toContain('text-base');
    }
    // Ajuda e erro dos app-form-field: o seletor do <form> leva os <p> a 16px.
    expect(el('form')!.className).toContain('[&_app-form-field_p]:text-base');
  });

  describe('400 do create', () => {
    function badRequest(issues: RentalPreflightItem[]): Observable<never> {
      return throwError(
        () =>
          new HttpErrorResponse({
            status: 400,
            error: {
              message: issues[0].message,
              code: issues[0].code,
              fieldErrors: { [issues[0].field ?? 'x']: issues[0].message },
              issues,
              limits: LIMITS,
            },
          }),
      );
    }

    it('aplica a MESMA lista: campo certo inline e botão impedido', async () => {
      mount();
      await change({ ...VALID });
      createSpy.mockReturnValue(
        badRequest([
          item({
            field: 'lateFineValue',
            code: 'FINE_PERCENT_ABOVE_MAX',
            message: 'A multa pode ir de 0% a 10%.',
          }),
        ]),
      );
      cmp().submit();
      fixture.detectChanges();

      expect(createSpy).toHaveBeenCalledTimes(1);
      expect(text('#rental-late-fine-value-error')).toBe('A multa pode ir de 0% a 10%.');
      expect(submitButton().disabled).toBe(true);
      expect(el('app-alert-banner')).toBeNull();
    });

    it('400 só com REQUIRED_FIELD de campo sem validação local não vira erro genérico', async () => {
      mount();
      await change({ ...VALID });
      createSpy.mockReturnValue(
        badRequest([
          item({ field: 'franchiseKm', code: 'REQUIRED_FIELD', message: 'Informe a franquia.' }),
          item({ field: 'vehicleId', code: 'REQUIRED_FIELD', message: 'Informe o veículo.' }),
        ]),
      );
      cmp().submit();
      fixture.detectChanges();

      expect(text('#rental-franchise-km-error')).toBe('Informe a franquia.');
      expect(text('#rental-vehicle-error')).toBe('Informe o veículo.');
      expect(el('app-alert-banner')).toBeNull();
      expect(submitButton().disabled).toBe(true);
    });

    it('sem campo na tela, a lista vai ao resumo com o atalho do motorista', async () => {
      mount();
      await change({ ...VALID });
      createSpy.mockReturnValue(
        badRequest([
          item({
            field: 'driver.phone',
            code: 'DRIVER_PHONE_INVALID',
            message: 'O telefone do motorista é inválido.',
          }),
        ]),
      );
      cmp().submit();
      fixture.detectChanges();

      const summary = el<HTMLElement>('[data-testid="preflight-summary"]')!;
      expect(summary.textContent).toContain('O telefone do motorista é inválido.');
      expect(summary.querySelector('a')!.getAttribute('href')).toBe('/motoristas/drv-1/editar');
    });
  });

  describe('prévia de cada cobrança (criação)', () => {
    const PREVIEW = {
      automaticCharge: true,
      willCreateInGateway: true,
      charges: [
        { kind: 'RENTAL_PERIOD', index: 0, dueDate: '2026-08-05', amountCents: 250_000, destination: 'ASAAS' },
        { kind: 'RENTAL_PERIOD', index: 1, dueDate: '2026-09-05', amountCents: 250_000, destination: 'ASAAS' },
      ],
      totalCents: 500_000,
      gatewayCount: 2,
      localCount: 0,
      firstDueDate: '2026-08-05',
      blocker: null,
    };

    const periodCharges = (n: number) =>
      Array.from({ length: n }, (_, i) => ({
        kind: 'RENTAL_PERIOD' as const,
        index: i,
        dueDate: `2026-${String(8 + Math.floor(i / 28)).padStart(2, '0')}-${String((i % 28) + 1).padStart(2, '0')}`,
        amountCents: 250_000,
        destination: 'ASAAS' as const,
      }));
    const previewOf = (charges: unknown[]) => ({ ...PREVIEW, charges, gatewayCount: charges.length });
    const text = (sel: string): string => (el(sel)?.textContent ?? '').replace(/\s+/g, ' ');
    const rowsIn = (): NodeListOf<Element> =>
      fixture.nativeElement.querySelectorAll('[data-testid="charge-schedule-row"]');
    const toggle = (): HTMLButtonElement => el('[data-testid="charge-schedule-toggle"]') as HTMLButtonElement;
    const expand = async (): Promise<void> => {
      toggle().click();
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();
    };

    it('resumo com 2 cobranças: quantidade, valor, datas e multa/juros uma vez só', async () => {
      mount();
      chargePreview.mockReturnValue(of(PREVIEW));
      await change({ ...VALID, lateInterestPercent: '1,50' });

      const summary = text('[data-testid="charge-schedule-summary"]');
      expect(summary).toContain('2 cobranças de R$ 2.500,00');
      expect(summary).toContain('Primeira vence em 05/08/2026, última em 05/09/2026');
      expect(summary).toContain('Multa 2%');
      expect(summary).toContain('Juros 1,5% ao mês');
      expect(summary.match(/Multa/g)?.length).toBe(1);
      expect(fixture.nativeElement.querySelectorAll('[data-testid="charge-summary-difference"]').length).toBe(0);
    });

    it('resumo com 1 cobrança: singular e uma data só', async () => {
      mount();
      chargePreview.mockReturnValue(of(previewOf(periodCharges(1))));
      await change({ ...VALID });

      const summary = text('[data-testid="charge-schedule-summary"]');
      expect(summary).toContain('1 cobrança de R$ 2.500,00');
      expect(summary).toContain('Vence em 01/08/2026');
      expect(summary).not.toContain('última');
      expect(toggle().textContent).toContain('Ver todas as 1 cobranças');
    });

    it('resumo com 40 cobranças continua curto e a lista fica fechada', async () => {
      mount();
      chargePreview.mockReturnValue(of(previewOf(periodCharges(40))));
      await change({ ...VALID });

      expect(text('[data-testid="charge-summary-headline"]')).toBe('40 cobranças de R$ 2.500,00');
      expect(rowsIn().length).toBe(0);
      expect(toggle().getAttribute('aria-expanded')).toBe('false');
      expect(toggle().textContent).toContain('Ver todas as 40 cobranças');
    });

    it('expandir mostra todas as cobranças, com valor, multa, juros e destino', async () => {
      mount();
      chargePreview.mockReturnValue(of(previewOf(periodCharges(40))));
      await change({ ...VALID, lateInterestPercent: '1,50' });
      await expand();

      expect(toggle().getAttribute('aria-expanded')).toBe('true');
      expect(rowsIn().length).toBe(40);
      const first = (rowsIn()[0] as HTMLElement).textContent!.replace(/\s+/g, ' ');
      expect(first).toContain('Cobrança 1');
      expect(first).toContain('01/08/2026');
      expect(first).toContain('R$ 2.500,00');
      expect(first).toContain('Multa 2%');
      expect(first).toContain('Juros 1,5% ao mês');
      expect(first).toContain('Vai ao Asaas');

      await expand();
      expect(toggle().getAttribute('aria-expanded')).toBe('false');
      expect(rowsIn().length).toBe(0);
    });

    it('o resumo cita a cobrança de valor diferente e a caução', async () => {
      mount();
      const charges = periodCharges(3);
      charges[0] = { ...charges[0], amountCents: 100_000 };
      chargePreview.mockReturnValue(
        of(
          previewOf([
            { kind: 'CAUCAO', index: 0, dueDate: '2026-08-01', amountCents: 80_000, destination: 'LOCAL' },
            ...charges,
          ]),
        ),
      );
      await change({ ...VALID });

      const diff = text('[data-testid="charge-summary-difference"]');
      expect(diff).toContain('Cobrança 1 (R$ 1.000,00)');
      expect(text('[data-testid="charge-schedule-summary"]')).toContain('3 cobranças de R$ 2.500,00');
      expect(text('[data-testid="charge-schedule-summary"]')).toContain('Caução de R$ 800,00');
      expect(toggle().textContent).toContain('Ver todas as 4 cobranças');
    });

    it('não consulta a prévia enquanto houver problema BLOCKING', async () => {
      mount();
      chargePreview.mockReturnValue(of(PREVIEW));
      preflight.mockReturnValue(
        answer([item({ field: 'periodRate', code: 'CHARGE_BELOW_MINIMUM', message: 'Abaixo do mínimo.' })]),
      );
      await change({ ...VALID });

      expect(chargePreview).not.toHaveBeenCalled();
      expect(el('[data-testid="charge-schedule"]')).toBeNull();
    });
  });

  describe('edição de aluguel legado (juros em R$/dia, sem %)', () => {
    const LEGACY = {
      id: 'rental-1',
      vehicleId: 'veh-1',
      driverId: 'drv-1',
      startDate: '2026-08-01',
      endDate: '2026-08-31',
      billingFrequency: 'MONTHLY',
      periodRate: 450_000,
      caucaoAmount: 0,
      caucaoPaid: false,
      automaticCharge: false,
      notes: null,
      initialKm: 42_000,
      pickupDate: '2026-08-01T09:00:00',
      firstPaymentDate: '2026-08-05',
      dailyInterestAmount: 300,
      lateInterestPercentPerMonth: null,
      lateFineType: 'PERCENT',
      lateFineValue: 200,
      status: 'RESERVED',
    };

    it('avisa do formato antigo e deixa o campo % vazio para definir', async () => {
      mount({ rentalId: 'rental-1', rental: LEGACY });
      await settle();

      expect(text('[data-testid="legacy-interest-notice"]')).toContain('R$ 3,00 por dia');
      expect((el('#rental-late-interest') as HTMLInputElement).value).toBe('');
      expect((preflight.mock.calls.at(-1)![0] as Record<string, unknown>)['rentalId']).toBe('rental-1');
    });

    it('sem definir o %, o PUT devolve o R$/dia como veio e não manda %', async () => {
      mount({ rentalId: 'rental-1', rental: LEGACY });
      await settle();
      cmp().submit();

      const body = updateSpy.mock.calls[0][1] as Record<string, unknown>;
      expect(body['dailyInterestAmount']).toBe(300);
      expect(body).not.toHaveProperty('lateInterestPercentPerMonth');
    });

    it('definindo o %, o PUT manda o % e zera o R$/dia (os dois juntos seriam conflito)', async () => {
      mount({ rentalId: 'rental-1', rental: LEGACY });
      await settle();
      typeInto('#rental-late-interest', '2');
      cmp().submit();

      const body = updateSpy.mock.calls[0][1] as Record<string, unknown>;
      expect(body['lateInterestPercentPerMonth']).toBe(2);
      expect(body['dailyInterestAmount']).toBe(0);
      expect(el('[data-testid="legacy-interest-notice"]')).toBeNull();
    });

    it('LEGACY_DAILY_INTEREST_UNSUPPORTED do backend cai no campo %', async () => {
      mount({ rentalId: 'rental-1', rental: LEGACY });
      preflight.mockReturnValue(
        answer([
          item({
            field: 'lateInterestPercentPerMonth',
            code: 'LEGACY_DAILY_INTEREST_UNSUPPORTED',
            message: 'Defina o juros ao mês para editar este aluguel.',
          }),
        ]),
      );
      await settle();
      await change({ notes: 'x' });
      await change({ initialKm: 42_001 });

      expect(text('#rental-late-interest-error')).toBe('Defina o juros ao mês para editar este aluguel.');
      expect(submitButton().disabled).toBe(true);
    });
  });
});
