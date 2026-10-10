import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { LedgerEntry } from '../../types/driver-ledger.types';
import { DriverEntryCard } from './driver-entry-card';

/** `textContent` do Intl usa espaco nao separavel entre "R$" e o numero: normaliza antes de comparar. */
const flat = (el: Element | null | undefined): string =>
  (el?.textContent ?? '').replace(/\s+/g, ' ').trim();

const entry = (over: Partial<LedgerEntry> = {}): LedgerEntry => ({
  id: 'e-1',
  kind: 'INCOME',
  category: 'RIDES',
  amountCents: 125050,
  occurredOn: '2026-10-09',
  description: 'Aeroporto',
  rentalId: null,
  ...over,
});

describe('DriverEntryCard', () => {
  let fixture: ComponentFixture<DriverEntryCard>;
  let edited: LedgerEntry[];
  let removed: LedgerEntry[];

  const root = () => fixture.nativeElement as HTMLElement;
  const text = () => (root().textContent ?? '').replace(/\s+/g, ' ');

  function render(value: LedgerEntry): void {
    fixture = TestBed.createComponent(DriverEntryCard);
    fixture.componentRef.setInput('entry', value);
    edited = [];
    removed = [];
    fixture.componentInstance.edit.subscribe((e) => edited.push(e));
    fixture.componentInstance.remove.subscribe((e) => removed.push(e));
    fixture.detectChanges();
  }

  beforeEach(() => TestBed.configureTestingModule({}));

  it('ganho: sinal de +, verde, e o texto escondido "Ganho de" para leitor de tela', () => {
    render(entry());

    expect(text()).toContain('+ R$ 1.250,50');
    expect(text()).toContain('Corridas');
    expect(text()).toContain('Aeroporto');
    expect(text()).toContain('09/10/2026');
    const amount = root().querySelector('p.text-lg') as HTMLElement;
    expect(amount.className).toContain('text-emerald-700');
    expect(flat(amount.querySelector('.sr-only')!)).toContain('Ganho de');
  });

  it('custo: sinal de menos de verdade (−), nao so a cor', () => {
    render(entry({ kind: 'EXPENSE', category: 'FUEL', amountCents: 8000, description: null }));

    expect(text()).toContain('− R$ 80,00');
    expect(text()).toContain('Combustível');
    expect((root().querySelector('p.text-lg') as HTMLElement).className).toContain('text-primary-700');
    expect(flat(root().querySelector('.sr-only')!)).toContain('Custo de');
  });

  it('categoria desconhecida aparece como veio, nunca em branco', () => {
    render(entry({ category: 'NEW_THING' as never }));
    expect(text()).toContain('NEW_THING');
  });

  it('editar e excluir emitem a linha, e cada botão nomeia o que age', () => {
    const value = entry();
    render(value);

    const edit = root().querySelector('[data-entry-edit]') as HTMLButtonElement;
    const remove = root().querySelector('[data-entry-remove]') as HTMLButtonElement;
    expect(edit.getAttribute('aria-label')).toBe('Editar ganho Corridas de 09/10/2026');
    expect(remove.getAttribute('aria-label')).toBe('Excluir ganho Corridas de 09/10/2026');

    edit.click();
    remove.click();
    expect(edited).toEqual([value]);
    expect(removed).toEqual([value]);
  });

  it('os dois botões têm alvo de 44px', () => {
    render(entry());
    for (const sel of ['[data-entry-edit]', '[data-entry-remove]']) {
      expect((root().querySelector(sel) as HTMLElement).className).toContain('min-h-11');
    }
  });
});
