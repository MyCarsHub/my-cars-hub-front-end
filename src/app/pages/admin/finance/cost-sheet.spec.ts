import { TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiErrorService } from '../../../services/api-error.service';
import type { PlatformVendor } from '../../../types/admin-finance.types';
import { AdminFinanceService } from './admin-finance.service';
import { ACQUISITION_VENDOR_NAME, CostSheet, OTHER_VENDOR, monthName } from './cost-sheet';

const RENDER: PlatformVendor = {
  id: 'v-render',
  name: 'Render',
  category: 'BACKEND',
  categoryLabel: null,
  billingDay: null,
  active: true,
};
const ACQ: PlatformVendor = { ...RENDER, id: 'v-acq', name: 'Anúncios', category: 'ACQUISITION', billingDay: 10 };

function setup(inputs: Record<string, unknown> = {}) {
  const finance = {
    setCost: vi.fn((vendorId: string, month: string, body: { amountCents: number; note: string | null }) =>
      of({ id: 'c1', vendorId, month, amountCents: body.amountCents, note: body.note }),
    ),
    createVendor: vi.fn((body: Omit<PlatformVendor, 'id'>) => of({ ...body, id: 'v-new', active: true })),
    updateVendor: vi.fn((id: string, body: Omit<PlatformVendor, 'id'>) => of({ ...body, id })),
  };
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    imports: [CostSheet],
    providers: [
      provideNoopAnimations(),
      { provide: AdminFinanceService, useValue: finance },
      { provide: ApiErrorService, useValue: { claim: vi.fn() } },
    ],
  });
  const fixture = TestBed.createComponent(CostSheet);
  fixture.componentRef.setInput('vendors', [RENDER, ACQ]);
  for (const [k, v] of Object.entries(inputs)) fixture.componentRef.setInput(k, v);
  fixture.detectChanges();
  const q = <T extends Element>(id: string) => document.querySelector<T>(`[data-testid="${id}"]`);
  const type = (id: string, value: string) => {
    const el = q<HTMLInputElement>(id)!;
    el.value = value;
    el.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  };
  const select = (id: string, value: string) => {
    const el = q<HTMLSelectElement>(id)!;
    el.value = value;
    el.dispatchEvent(new Event('change'));
    fixture.detectChanges();
  };
  const save = () => {
    q<HTMLButtonElement>('cost-save')!.click();
    fixture.detectChanges();
  };
  const saved = vi.fn();
  fixture.componentInstance.saved.subscribe(saved);
  return { fixture, finance, q, type, select, save, saved };
}

describe('CostSheet — Lançar custo', () => {
  beforeEach(() => TestBed.resetTestingModule());

  it('monthName escreve o mês por extenso', () => {
    expect(monthName('2026-11')).toBe('novembro de 2026');
  });

  it('todos os campos têm 16px (text-base): o iPhone não dá zoom', () => {
    const { q } = setup();
    for (const id of ['cost-vendor', 'cost-month', 'cost-amount', 'cost-billing-day', 'cost-note']) {
      expect(q(id)!.className, id).toContain('text-base');
    }
  });

  it('lança o valor em centavos no mês escolhido, a partir do texto pt-BR', () => {
    const { type, save, finance, saved } = setup();
    type('cost-month', '2026-10');
    type('cost-amount', '1.234,56');
    save();
    expect(finance.setCost).toHaveBeenCalledWith('v-render', '2026-10', { amountCents: 123_456, note: null });
    expect(finance.updateVendor).not.toHaveBeenCalled();
    expect(saved).toHaveBeenCalledTimes(1);
  });

  it('valor em formato errado não sai do formulário', () => {
    const { type, save, finance, q } = setup();
    type('cost-amount', '45.99');
    save();
    expect(finance.setCost).not.toHaveBeenCalled();
    expect(q('cost-error')?.textContent).toContain('Confira o valor');
  });

  it('sem valor e sem dia novo, pede um dos dois', () => {
    const { save, finance, q } = setup();
    save();
    expect(finance.setCost).not.toHaveBeenCalled();
    expect(q('cost-error')?.textContent).toContain('Informe o valor do mês ou o dia de cobrança');
  });

  it('o dia de cobrança vai ao fornecedor (PUT com os outros campos intactos)', () => {
    const { type, save, finance } = setup();
    type('cost-billing-day', '8');
    save();
    expect(finance.updateVendor).toHaveBeenCalledWith('v-render', {
      name: 'Render',
      category: 'BACKEND',
      categoryLabel: null,
      billingDay: 8,
      active: true,
    });
    expect(finance.setCost).not.toHaveBeenCalled();
  });

  it('dia fora de 1..31 é recusado', () => {
    const { type, save, finance, q } = setup();
    type('cost-billing-day', '40');
    save();
    expect(finance.updateVendor).not.toHaveBeenCalled();
    expect(q('cost-error')?.textContent).toContain('1 a 31');
  });

  it('outro fornecedor: cadastra e lança no mesmo passo', () => {
    const { select, type, save, finance } = setup();
    select('cost-vendor', OTHER_VENDOR);
    type('cost-vendor-name', 'Vercel');
    select('cost-vendor-category', 'FRONTEND');
    type('cost-amount', '120,00');
    save();
    expect(finance.createVendor).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Vercel', category: 'FRONTEND', billingDay: null }),
    );
    expect(finance.setCost).toHaveBeenCalledWith('v-new', expect.any(String), { amountCents: 12_000, note: null });
  });

  it('aquisição abre no fornecedor de aquisição que já existe, com o dia dele no campo', () => {
    const { q } = setup({ intent: 'acquisition' });
    expect(q<HTMLSelectElement>('cost-vendor')!.value).toBe('v-acq');
    expect(q<HTMLInputElement>('cost-billing-day')!.value).toBe('10');
  });

  it('aquisição sem fornecedor ainda: abre o cadastro como "Aquisição", tipo aquisição', () => {
    const { fixture, q } = setup({ intent: 'acquisition', vendors: [RENDER] });
    fixture.detectChanges();
    expect(q<HTMLSelectElement>('cost-vendor')!.value).toBe(OTHER_VENDOR);
    expect(q<HTMLInputElement>('cost-vendor-name')!.value).toBe(ACQUISITION_VENDOR_NAME);
    expect(q<HTMLSelectElement>('cost-vendor-category')!.value).toBe('ACQUISITION');
  });

  it('o convite do dia de cobrança abre no fornecedor pedido', () => {
    const { q } = setup({ intent: 'billing-day', vendorId: 'v-acq' });
    expect(q<HTMLSelectElement>('cost-vendor')!.value).toBe('v-acq');
  });
});
