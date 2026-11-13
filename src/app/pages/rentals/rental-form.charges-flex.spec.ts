import { TestBed } from '@angular/core/testing';
import { provideRouter, ActivatedRoute } from '@angular/router';
import { signal } from '@angular/core';
import { EMPTY, Observable, of } from 'rxjs';
import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';

import { RentalForm } from './rental-form';
import { RentalService } from './rental.service';
import { CompanyContactGate } from '../../services/company-contact-gate.service';
import { VehiclesService } from '../../services/vehicles.service';
import { DriverService } from '../../services/driver.service';
import { AsaasIntegrationService } from '../company-settings/integrations/asaas-integration.service';
import { ContractTemplateService } from '../company-settings/contract-template/contract-template-service';
import type { CreateRentalRequest, RentalChargePreviewDto } from '../../types/rental.types';

/**
 * FEAT-0573 — "Como cobrar" no Novo aluguel (jornadas A, B, C, H1). Prova os dois estados da
 * chave CHARGES_FLEX: sem ela, nada aparece e o corpo do create não tem `chargePlan`.
 * Campos de dinheiro mascarados guardam TEXTO, e é texto que o spec digita.
 */
describe('RentalForm — Cobranças flexíveis (FEAT-0573)', () => {
  let fixture: ReturnType<typeof TestBed.createComponent<RentalForm>>;
  let chargePreview: Mock;
  let createSpy: Mock;

  type FormLike = { form: { patchValue: (v: Record<string, unknown>) => void }; submit: () => void };

  const VALID = {
    vehicleId: 'veh-1',
    driverId: 'drv-1',
    startDate: '2099-11-16',
    endDate: '2100-02-08',
    billingFrequency: 'WEEKLY',
    caucaoReais: '1.500,00',
    periodRateReais: '750,00',
    initialKm: 45_820,
    pickupDate: '2099-11-16T09:00',
    firstPaymentDate: '2099-11-16',
    lateFineType: 'FIXED',
    lateFineValueInput: '50,00',
    automaticCharge: false,
  };

  const weeks = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      kind: 'RENTAL_PERIOD' as const,
      index: i,
      dueDate: `2099-${String(11 + Math.floor((16 + i * 7) / 31)).padStart(2, '0')}-${String(((16 + i * 7) % 31) || 1).padStart(2, '0')}`,
      amountCents: 75_000,
      destination: 'ASAAS' as const,
    }));

  const PREVIEW: RentalChargePreviewDto = {
    automaticCharge: false,
    willCreateInGateway: false,
    charges: [{ kind: 'CAUCAO', index: 0, dueDate: '2099-11-16', amountCents: 150_000, destination: 'ASAAS' }, ...weeks(3)],
    totalCents: 375_000,
    gatewayCount: 0,
    localCount: 4,
    firstDueDate: '2099-11-16',
    blocker: null,
  };

  function mount(features: string[] | null): void {
    TestBed.resetTestingModule();
    sessionStorage.clear();
    localStorage.clear();
    if (features) sessionStorage.setItem('features', JSON.stringify(features));
    chargePreview = vi.fn((): Observable<unknown> => of(PREVIEW));
    createSpy = vi.fn().mockReturnValue(of({ id: 'novo' }));
    TestBed.configureTestingModule({
      imports: [RentalForm],
      providers: [
        provideRouter([{ path: '**', children: [] }]),
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: { get: () => null } } } },
        {
          provide: VehiclesService,
          useValue: { list: () => of({ content: [{ id: 'veh-1', plate: 'RSL4B21', brand: 'Hyundai', model: 'HB20' }], page: 0, size: 500, total: 1 }) },
        },
        {
          provide: DriverService,
          useValue: { list: () => of({ content: [{ id: 'drv-1', name: 'Carlos Mendes', status: 'ACTIVE' }], page: 0, size: 500, total: 1 }) },
        },
        { provide: CompanyContactGate, useValue: { ensureComplete: () => of(true) } },
        {
          provide: RentalService,
          useValue: {
            getById: () => EMPTY,
            preflight: () => of({ ok: true, issues: [], warnings: [], limits: null }),
            chargePreview,
            create: createSpy,
            update: vi.fn(),
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
  const el = <T extends Element>(sel: string): T | null => fixture.nativeElement.querySelector(sel) as T | null;
  const byId = <T extends Element = HTMLElement>(id: string): T | null => el<T>(`[data-testid="${id}"]`);

  async function settle(ms = 550): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  async function fill(): Promise<void> {
    cmp().form.patchValue(VALID);
    fixture.detectChanges();
    await settle();
  }

  function lastCreateBody(): CreateRentalRequest {
    return createSpy.mock.calls[createSpy.mock.calls.length - 1][0] as CreateRentalRequest;
  }

  function type(input: HTMLInputElement, value: string): void {
    input.value = value;
    input.dispatchEvent(new Event('input'));
  }

  afterEach(() => {
    sessionStorage.clear();
    localStorage.clear();
  });

  it('sem CHARGES_FLEX: nada de "Como cobrar" e o create vai sem a chave chargePlan', async () => {
    mount(null);
    await fill();

    expect(byId('charge-plan-editor')).toBeNull();
    expect(fixture.nativeElement.textContent).not.toContain('Como cobrar o aluguel');
    cmp().submit();
    expect(createSpy).toHaveBeenCalledTimes(1);
    expect('chargePlan' in lastCreateBody()).toBe(false);
    for (const [body] of chargePreview.mock.calls) expect('chargePlan' in (body as object)).toBe(false);
  });

  it('A — com CHARGES_FLEX e "Valor cheio" (padrão), o corpo também vai sem chargePlan', async () => {
    mount(['CHARGES_FLEX']);
    await fill();

    expect(byId('charge-plan-editor')).not.toBeNull();
    expect(byId('plan-full')?.getAttribute('aria-checked')).toBe('true');
    cmp().submit();
    expect('chargePlan' in lastCreateBody()).toBe(false);
  });

  it('Total previsto: neutro sem a chave, laranja sólido com ela (canvas aprovado, item 1)', async () => {
    mount(null);
    await fill();
    expect(byId('total-painted')).toBeNull();
    expect(fixture.nativeElement.textContent).toContain('Total previsto');

    mount(['CHARGES_FLEX']);
    await fill();
    const painted = byId('total-painted')!;
    expect(painted.getAttribute('data-tone')).toBe('orange');
    expect(painted.className).toContain('text-white');
    expect(painted.textContent).toContain('Total previsto');
  });

  it('H1 — aluguel manual mostra que "Como cobrar funciona igual"', async () => {
    mount(['CHARGES_FLEX']);
    await fill();
    expect(byId('charge-plan-manual-note')?.textContent).toContain('Como cobrar funciona igual');
  });

  it('B — desconto de R$ 100,00 nas 3 primeiras: o total cai e o plano viaja no create e na prévia', async () => {
    mount(['CHARGES_FLEX']);
    await fill();

    byId<HTMLButtonElement>('plan-discount')!.click();
    await settle(0);
    const periods = byId<HTMLInputElement>('plan-discount-periods')!;
    type(periods, '3');
    type(byId<HTMLInputElement>('plan-discount-value')!, '100,00');
    await settle();

    expect(byId<HTMLInputElement>('plan-discount-value')!.value).toBe('100,00');
    expect(byId('plan-discount-summary')?.textContent).toContain('Semanas 1, 2 e 3 saem a R$ 650,00');
    expect(fixture.nativeElement.textContent).toContain('R$ 300,00 de desconto');

    const previewBody = chargePreview.mock.calls[chargePreview.mock.calls.length - 1][0] as CreateRentalRequest;
    expect(previewBody.chargePlan).toEqual({
      discount: { type: 'AMOUNT', value: 10_000, firstPeriods: 3 },
      defaultSplit: null,
      overrides: null,
    });

    cmp().submit();
    expect(lastCreateBody().chargePlan?.discount).toEqual({ type: 'AMOUNT', value: 10_000, firstPeriods: 3 });
  });

  it('B — desconto que deixa a cobrança abaixo de R$ 5,00 (automático) impede criar', async () => {
    mount(['CHARGES_FLEX']);
    await fill();
    cmp().form.patchValue({ automaticCharge: true });
    await settle();
    byId<HTMLButtonElement>('plan-discount')!.click();
    await settle(0);
    type(byId<HTMLInputElement>('plan-discount-value')!, '748,00');
    await settle();

    expect(byId('plan-discount-problem')?.textContent).toContain('abaixo de R$ 5,00');
    cmp().submit();
    fixture.detectChanges();
    expect(createSpy).not.toHaveBeenCalled();
    expect(fixture.nativeElement.textContent).toContain('Confira o desconto, as parcelas ou as partes da caução.');
  });

  it('C — caução em 2 partes (1.300 + 200) e a Semana 1 em 3 parcelas', async () => {
    mount(['CHARGES_FLEX']);
    await fill();

    byId<HTMLInputElement>('plan-caucao-split')!.click();
    await settle(0);
    type(byId<HTMLInputElement>('plan-caucao-part-amount-0')!, '1.300,00');
    type(byId<HTMLInputElement>('plan-caucao-part-amount-1')!, '200,00');
    await settle(0);
    expect(fixture.nativeElement.textContent).toContain('As partes somam R$ 1.500,00, o valor da caução.');

    byId<HTMLButtonElement>('plan-split')!.click();
    await settle();
    expect(byId('plan-period-list')?.textContent).toContain('Semana 1');
    byId<HTMLButtonElement>('plan-period-0')!.click();
    await settle(0);

    const sheet = byId('plan-sheet-instalments')!;
    expect(sheet.querySelectorAll('li').length).toBe(3);
    expect(sheet.textContent).toContain('R$ 250,00');
    expect(sheet.textContent).toContain('multa R$ 16,68, leva os centavos');
    byId<HTMLButtonElement>('plan-sheet-save')!.click();
    await settle();

    expect(byId('plan-period-list')?.textContent).toContain('Semana 1, em 3 parcelas');
    cmp().submit();
    const plan = lastCreateBody().chargePlan!;
    expect(plan.overrides).toHaveLength(2);
    const caucao = plan.overrides!.find((o) => o.target === 'CAUCAO')!;
    expect(caucao.instalments.map((i) => i.amountCents)).toEqual([130_000, 20_000]);
    const week1 = plan.overrides!.find((o) => o.target === 'PERIOD')!;
    expect(week1.periodIndex).toBe(0);
    expect(week1.instalments.map((i) => i.amountCents)).toEqual([25_000, 25_000, 25_000]);
    expect(week1.instalments.map((i) => i.dueDate)).toEqual(['2099-11-16', '2099-11-18', '2099-11-20']);
  });

  it('C — partes da caução que não somam o valor impedem criar', async () => {
    mount(['CHARGES_FLEX']);
    await fill();
    byId<HTMLInputElement>('plan-caucao-split')!.click();
    await settle(0);
    type(byId<HTMLInputElement>('plan-caucao-part-amount-0')!, '1.000,00');
    type(byId<HTMLInputElement>('plan-caucao-part-amount-1')!, '200,00');
    await settle(0);

    expect(byId('plan-caucao-problem')?.textContent).toContain('As partes somam R$ 1.200,00, mas o valor da caução é R$ 1.500,00.');
    cmp().submit();
    fixture.detectChanges();
    expect(createSpy).not.toHaveBeenCalled();
    expect(fixture.nativeElement.textContent).toContain('Confira o desconto, as parcelas ou as partes da caução.');
  });

  it('M2 — mudar o valor do aluguel desfaz o parcelamento salvo (com aviso) e ele não viaja', async () => {
    mount(['CHARGES_FLEX']);
    await fill();
    byId<HTMLButtonElement>('plan-split')!.click();
    await settle();
    byId<HTMLButtonElement>('plan-period-0')!.click();
    await settle(0);
    byId<HTMLButtonElement>('plan-sheet-save')!.click();
    await settle();
    expect(byId('plan-period-list')?.textContent).toContain('Semana 1, em 3 parcelas');

    cmp().form.patchValue({ periodRateReais: '800,00' });
    fixture.detectChanges();
    await settle();

    expect(byId('plan-stale-notice')?.textContent).toContain('Semana 1 foi desfeito');
    expect(byId('plan-period-list')?.textContent).not.toContain('em 3 parcelas');
    cmp().submit();
    expect('chargePlan' in lastCreateBody()).toBe(false);
  });

  it('L1 — multa fixa dividida maior que a parcela é avisada antes da prévia e impede criar', async () => {
    mount(['CHARGES_FLEX']);
    await fill();
    cmp().form.patchValue({ periodRateReais: '10,00' });
    fixture.detectChanges();
    await settle();
    byId<HTMLButtonElement>('plan-split')!.click();
    await settle(0);
    byId<HTMLButtonElement>('plan-split-all')!.click();
    await settle();

    expect(byId('plan-split-problem')?.textContent).toContain('A multa fixa dividida (R$ 25,00) precisa ser menor que a parcela (R$ 5,00).');
    cmp().submit();
    expect(createSpy).not.toHaveBeenCalled();
  });

  it('M4 — recusa da prévia que cita o provedor vira texto da locadora e impede criar', async () => {
    mount(['CHARGES_FLEX']);
    chargePreview.mockImplementation((body: CreateRentalRequest) =>
      of({
        ...PREVIEW,
        blocker: body.chargePlan
          ? { code: 'CHARGE_BELOW_MINIMUM', message: 'Cada parcela precisa ser de pelo menos R$ 5,00 (limite do Asaas). A parcela 2 ficou com R$ 4,99.' }
          : null,
      }),
    );
    await fill();
    byId<HTMLButtonElement>('plan-split')!.click();
    await settle(0);
    byId<HTMLButtonElement>('plan-split-all')!.click();
    await settle();

    const text = byId('plan-preview-blocker')!.textContent ?? '';
    expect(text).toContain('valor mínimo por parcela');
    expect(text).toContain('A parcela 2 ficou com R$ 4,99.');
    expect(text).not.toContain('Asaas');
    cmp().submit();
    expect(createSpy).not.toHaveBeenCalled();
  });

  it('a recusa do plano na prévia aparece no próprio editor (ex.: R$ 5,00)', async () => {
    mount(['CHARGES_FLEX']);
    chargePreview.mockImplementation((body: CreateRentalRequest) =>
      of({
        ...PREVIEW,
        blocker: body.chargePlan
          ? { code: 'CHARGE_BELOW_MINIMUM', message: 'Cada parcela precisa ser de pelo menos R$ 5,00. A parcela 3 ficou com R$ 4,99.' }
          : null,
      }),
    );
    await fill();
    byId<HTMLButtonElement>('plan-split')!.click();
    await settle(0);
    byId<HTMLButtonElement>('plan-split-all')!.click();
    await settle();

    expect(byId('plan-preview-blocker')?.textContent).toContain('A parcela 3 ficou com R$ 4,99');
  });
});
