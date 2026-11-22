import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { afterEach, describe, expect, it } from 'vitest';

import { CardBilling } from './card-billing';

@Component({
  imports: [CardBilling],
  template: `
    <app-rc-billing
      [automatic]="auto()"
      [asaasConnected]="connected()"
      [isOwner]="owner()"
      (automaticChange)="changes.push($event); auto.set($event)"
    />
  `,
})
class Host {
  readonly auto = signal(true);
  readonly connected = signal(true);
  readonly owner = signal(true);
  readonly changes: boolean[] = [];
}

describe('CardBilling — card 7 · Cobrança (igual ao Contrato)', () => {
  let fixture: ReturnType<typeof TestBed.createComponent<Host>>;
  const host = (): Host => fixture.componentInstance;
  const el = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const q = (sel: string): HTMLElement | null => el().querySelector<HTMLElement>(sel);
  const sw = (): HTMLButtonElement => q('[data-testid="pay-automatic"]') as HTMLButtonElement;
  const flat = (node: Element | null): string => (node?.textContent ?? '').replace(/\s+/g, ' ').trim();

  async function mount(state: { auto?: boolean; connected?: boolean; owner?: boolean } = {}): Promise<void> {
    TestBed.configureTestingModule({ imports: [Host], providers: [provideRouter([])] });
    fixture = TestBed.createComponent(Host);
    host().auto.set(state.auto ?? true);
    host().connected.set(state.connected ?? true);
    host().owner.set(state.owner ?? true);
    await render();
  }
  async function render(): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
  }

  afterEach(() => TestBed.resetTestingModule());

  it('uma chave "Cobranças automáticas", sem opções de rádio nem título', async () => {
    await mount();
    expect(sw().getAttribute('role')).toBe('switch');
    expect(q('[role="radiogroup"]')).toBeNull();
    expect(q('[role="radio"]')).toBeNull();
    expect(el().textContent).not.toContain('Como ele vai pagar');
    expect(el().textContent).not.toContain('Eu recebo por fora');
    expect(flat(sw().querySelector('b'))).toBe('Cobranças automáticas');
  });

  it('ligada com Asaas conectado: o quadro "conectada" embaixo', async () => {
    await mount();
    expect(sw().getAttribute('aria-checked')).toBe('true');
    expect(flat(q('[data-testid="billing-tile"] .rt-tx b'))).toBe('Sua conta Asaas está conectada');
    expect(el().textContent).toContain('Dá para mudar uma cobrança depois, no aluguel.');
  });

  it('o (i) explica a conta Asaas e o desligado', async () => {
    await mount();
    const tip = q('#rt-tip-auto')!;
    expect(tip.hidden).toBe(true);
    (q('button[aria-label="O que é Cobranças automáticas"]') as HTMLButtonElement).click();
    await render();
    expect(tip.hidden).toBe(false);
    expect(tip.textContent).toContain('sua conta Asaas');
    expect(tip.textContent).toContain('Desligada, você recebe por fora');
  });

  it('desligar = recebo por fora; ligar de novo volta', async () => {
    await mount();
    sw().click();
    await render();
    expect(host().changes).toEqual([false]);
    expect(sw().getAttribute('aria-checked')).toBe('false');
    expect(flat(q('[data-testid="billing-tile"]'))).toContain('Você recebe por fora');
    sw().click();
    await render();
    expect(host().changes).toEqual([false, true]);
  });

  it('dono sem Asaas, chave ligada: aviso com o atalho para conectar', async () => {
    await mount({ connected: false });
    expect(q('[data-testid="billing-tile"]')).toBeNull();
    const warn = q('[data-testid="billing-warn"]')!;
    expect(flat(warn)).toContain('Sua conta Asaas ainda não está conectada.');
    const link = q('[data-testid="billing-connect"]') as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe('/configuracoes/integracoes/asaas');
  });

  it('outra pessoa da equipe sem Asaas: ligar fica travado e pede ao dono', async () => {
    await mount({ auto: false, connected: false, owner: false });
    expect(sw().getAttribute('aria-disabled')).toBe('true');
    expect(flat(sw())).toContain('Precisa da conta Asaas conectada.');
    sw().click();
    await render();
    expect(host().changes).toEqual([]);
    expect(flat(q('[data-testid="billing-ask-owner"]'))).toBe(
      'Para usar cobranças automáticas, peça ao dono da conta para conectar o Asaas.',
    );
  });
});
