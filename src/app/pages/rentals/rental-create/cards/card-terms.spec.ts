import { Component, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { TestBed } from '@angular/core/testing';
import { FormBuilder } from '@angular/forms';
import { map } from 'rxjs';
import { afterEach, describe, expect, it } from 'vitest';

import { RentalBillingFrequency } from '../../../../types/rental.types';
import { createRentalForm } from '../create-form';
import { CardTerms } from './card-terms';
import { FUEL_OTHER } from './terms-rules';

@Component({
  imports: [CardTerms],
  template: `
    <app-rc-terms
      [form]="form"
      [value]="v()"
      [errors]="errors()"
      [frequency]="freq()"
      [chargeCents]="charge()"
      (touched)="touched.push($event)"
    />
  `,
})
class Host {
  readonly form = createRentalForm(inject(FormBuilder));
  readonly v = toSignal(this.form.valueChanges.pipe(map(() => this.form.getRawValue())), {
    initialValue: this.form.getRawValue(),
  });
  readonly errors = signal<Record<string, string>>({});
  readonly freq = signal<RentalBillingFrequency>('WEEKLY');
  readonly charge = signal(60000);
  readonly touched: string[] = [];
}

describe('CardTerms — card 5 · Condições de pagamento', () => {
  let fixture: ReturnType<typeof TestBed.createComponent<Host>>;
  const host = (): Host => fixture.componentInstance;
  const el = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const q = <T extends HTMLElement = HTMLElement>(sel: string): T | null => el().querySelector<T>(sel);
  const text = (sel: string): string => (q(sel)?.textContent ?? '').replace(/\s+/g, ' ').trim();
  const radios = (testId: string): HTMLButtonElement[] =>
    Array.from(el().querySelectorAll<HTMLButtonElement>(`[data-testid="${testId}"] [role="radio"]`));

  async function mount(patch: Record<string, unknown> = {}): Promise<void> {
    TestBed.configureTestingModule({ imports: [Host] });
    fixture = TestBed.createComponent(Host);
    host().form.patchValue({ firstPaymentDate: '2026-11-24', endDate: '2026-12-22', ...patch });
    await render();
  }
  async function render(): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }
  async function type(sel: string, value: string): Promise<void> {
    const input = q<HTMLInputElement>(sel)!;
    input.value = value;
    input.setSelectionRange?.(value.length, value.length);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await render();
  }

  afterEach(() => TestBed.resetTestingModule());

  it('mostra os quatro grupos da prancha, na ordem', async () => {
    await mount();
    const titles = Array.from(el().querySelectorAll('.rt-grp > h3')).map((h) => h.textContent?.trim());
    expect(titles).toEqual(['Vencimento', 'Se atrasar', 'Quilometragem', 'Combustível']);
  });

  it('vencimento: o dia da semana e o ritmo das próximas; o (i) com a frequência', async () => {
    await mount();
    expect(text('[data-testid="first-due-hint"]')).toBe('Terça. As próximas vencem toda terça.');
    const tip = q('#rt-tip-due')!;
    expect(tip.hidden).toBe(true);
    q<HTMLButtonElement>('button[aria-label="O que é primeira cobrança"]')!.click();
    await render();
    expect(tip.hidden).toBe(false);
    expect(tip.textContent).toContain('a cada 7 dias');
    host().freq.set('MONTHLY');
    await render();
    expect(text('[data-testid="first-due-hint"]')).toBe('Terça. As próximas vencem a cada 30 dias.');
  });

  it('multa em %: a frase em reais; trocar para R$ zera o campo e mostra o teto', async () => {
    await mount();
    expect(radios('fine-type').map((b) => b.textContent?.trim())).toEqual(['%', 'R$']);
    await type('[data-testid="fine-value"]', '2');
    expect(text('[data-testid="fine-hint"]')).toBe('R$ 12,00 em cada cobrança atrasada.');
    expect(q('[data-testid="fine-value"]')!.getAttribute('aria-label')).toBe('Multa em porcentagem');

    radios('fine-type')[1].click();
    await render();
    expect(host().form.controls.lateFineType.value).toBe('FIXED');
    expect(host().form.controls.lateFineValue.value).toBe('');
    expect(text('[data-testid="fine-hint"]')).toBe('Menor que R$ 600,00 (valor de cada cobrança).');
    expect(radios('fine-type')[1].getAttribute('aria-checked')).toBe('true');
  });

  it('juros: a estimativa por dia, na frase e no (i)', async () => {
    await mount();
    expect(text('[data-testid="interest-hint"]')).toBe('De 0% a 11%.');
    await type('[data-testid="interest"]', '1,50');
    expect(host().form.controls.lateInterestPercent.value).toBe('1,50');
    expect(text('[data-testid="interest-hint"]')).toBe('Cerca de R$ 0,30 por dia de atraso. De 0% a 11%.');
    expect(text('#rt-tip-int')).toContain('1,5% ao mês sobre R$ 600,00 dá cerca de R$ 0,30 por dia');
  });

  it('km na retirada: máscara de milhar e campo obrigatório', async () => {
    await mount();
    await type('[data-testid="initial-km"]', '45820');
    expect(host().form.controls.initialKm.value).toBe('45.820');
    expect(q('[data-testid="initial-km"]')!.hasAttribute('required')).toBe(true);
    q('[data-testid="initial-km"]')!.dispatchEvent(new Event('blur'));
    expect(host().touched).toContain('initialKm');
  });

  it('limite de km: "Com limite por dia" abre km por dia e preço do km, com a frase', async () => {
    await mount();
    expect(q('[data-testid="franchise-km"]')).toBeNull();
    expect(radios('km-limit').map((b) => b.textContent?.trim())).toEqual(['Sem limite', 'Com limite por dia']);
    radios('km-limit')[1].click();
    await render();
    expect(host().form.controls.hasKmLimit.value).toBe(true);
    await type('[data-testid="franchise-km"]', '150');
    await type('[data-testid="extra-km"]', '0,50');
    expect(text('[data-testid="km-limit-hint"]')).toBe('Até 150 km por dia. Acima disso, R$ 0,50 por km.');
  });

  it('combustível: lista com as quatro opções; "Outra regra" pede a regra (até 60)', async () => {
    await mount();
    const trigger = q<HTMLButtonElement>('[data-testid="fuel"]')!;
    expect(trigger.getAttribute('aria-haspopup')).toBe('listbox');
    expect(trigger.textContent).toContain('Selecione');
    trigger.click();
    await render();
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    const options = Array.from(el().querySelectorAll('[role="listbox"] [role="option"]'));
    expect(options.map((o) => o.textContent?.trim())).toEqual([
      'Mesmo nível da retirada',
      'Tanque cheio',
      'Livre (sem exigência)',
      'Outra regra',
    ]);
    (options[3] as HTMLElement).click();
    await render();
    expect(host().form.controls.fuel.value).toBe(FUEL_OTHER);
    expect(q('[role="listbox"]')).toBeNull();
    expect(trigger.textContent).toContain('Outra regra');
    expect(q('[data-testid="custom-fuel"]')!.getAttribute('maxlength')).toBe('60');
    expect(text('#rt-fuel-hint')).toBe('Vai escrita no contrato.');
  });

  it('combustível pelo teclado: setas movem, Enter escolhe, Esc fecha', async () => {
    await mount();
    q<HTMLButtonElement>('[data-testid="fuel"]')!.click();
    await render();
    const list = q('[role="listbox"]')!;
    expect(list.getAttribute('aria-activedescendant')).toBe('rt-fuel-o0');
    list.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    await render();
    expect(list.getAttribute('aria-activedescendant')).toBe('rt-fuel-o1');
    list.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await render();
    expect(host().form.controls.fuel.value).toBe('Tanque cheio');

    q<HTMLButtonElement>('[data-testid="fuel"]')!.click();
    await render();
    expect(q('[role="option"][aria-selected="true"]')!.textContent).toContain('Tanque cheio');
    q('[role="listbox"]')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await render();
    expect(q('[role="listbox"]')).toBeNull();
    expect(host().touched).toContain('fuel');
  });

  it('erros: a mensagem no lugar da frase, com aria-invalid', async () => {
    await mount();
    host().errors.set({ initialKm: 'Digite os km do painel.', lateFineValue: 'Digite a multa.' });
    await render();
    expect(text('#rt-km-err')).toBe('Digite os km do painel.');
    expect(q('[data-testid="initial-km"]')!.getAttribute('aria-invalid')).toBe('true');
    expect(q('[data-testid="initial-km"]')!.getAttribute('aria-describedby')).toBe('rt-km-err');
    expect(q('[data-testid="fine-hint"]')).toBeNull();
    expect(q('#rt-fine-err')!.getAttribute('role')).toBe('alert');
  });

});
