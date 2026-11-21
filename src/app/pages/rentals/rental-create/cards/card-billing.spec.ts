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

describe('CardBilling — card 7 · Cobrança', () => {
  let fixture: ReturnType<typeof TestBed.createComponent<Host>>;
  const host = (): Host => fixture.componentInstance;
  const el = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const q = (sel: string): HTMLElement | null => el().querySelector<HTMLElement>(sel);
  const auto = (): HTMLButtonElement => q('[data-testid="pay-automatic"]') as HTMLButtonElement;
  const outside = (): HTMLButtonElement => q('[data-testid="pay-outside"]') as HTMLButtonElement;
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

  it('radiogroup com as duas opções, sem o título visível "Como ele vai pagar?"', async () => {
    await mount();
    const group = q('[role="radiogroup"]')!;
    expect(group.getAttribute('aria-label')).toBe('Como ele vai pagar');
    expect(el().textContent).not.toContain('Como ele vai pagar');
    expect(flat(auto().querySelector('b'))).toBe('Cobranças automáticas');
    expect(flat(outside().querySelector('b'))).toBe('Eu recebo por fora');
    expect(el().textContent).not.toContain('Pix pelo MyCarsHub');
  });

  it('automática com Asaas conectado: marcada e o quadro "conectada"', async () => {
    await mount();
    expect(auto().getAttribute('aria-checked')).toBe('true');
    expect(auto().getAttribute('tabindex')).toBe('0');
    expect(outside().getAttribute('tabindex')).toBe('-1');
    expect(flat(q('[data-testid="billing-tile"] .rt-tx b'))).toBe('Sua conta Asaas está conectada');
    expect(flat(q('[data-testid="billing-tile"] .rt-tx span'))).toBe(
      'Antes de criar, você vê o resumo das cobranças e confirma.',
    );
    expect(el().textContent).toContain('Dá para mudar uma cobrança depois, no aluguel.');
  });

  it('o (i) de Cobranças automáticas explica a conta Asaas', async () => {
    await mount();
    const tip = q('#rt-tip-auto')!;
    expect(tip.hidden).toBe(true);
    (q('button[aria-label="O que é Cobranças automáticas"]') as HTMLButtonElement).click();
    await render();
    expect(tip.hidden).toBe(false);
    expect(tip.textContent).toContain('sua conta Asaas');
  });

  it('"Eu recebo por fora": avisa e mostra "Nada é enviado para ele"', async () => {
    await mount();
    outside().click();
    await render();
    expect(host().changes).toEqual([false]);
    expect(outside().getAttribute('aria-checked')).toBe('true');
    expect(flat(q('[data-testid="billing-tile"]'))).toContain('Nada é enviado para ele');
  });

  it('setas trocam a escolha e levam o foco', async () => {
    await mount({ auto: false });
    outside().focus();
    outside().dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
    await render();
    expect(host().changes).toEqual([true]);
    expect(document.activeElement).toBe(auto());
  });

  it('dono sem Asaas, automática marcada: aviso com o atalho para conectar', async () => {
    await mount({ connected: false });
    expect(q('[data-testid="billing-tile"]')).toBeNull();
    const warn = q('[data-testid="billing-warn"]')!;
    expect(flat(warn)).toContain('Sua conta Asaas ainda não está conectada. Sem ela, as cobranças automáticas não funcionam.');
    const link = q('[data-testid="billing-connect"]') as HTMLAnchorElement;
    expect(flat(link)).toBe('Conectar minha conta Asaas');
    expect(link.getAttribute('href')).toBe('/configuracoes/integracoes/asaas');
    expect(flat(warn)).toContain('O que você já preencheu aqui fica guardado.');
  });

  it('outra pessoa da equipe sem Asaas: a automática fica travada e pede ao dono', async () => {
    await mount({ auto: false, connected: false, owner: false });
    expect(auto().getAttribute('aria-disabled')).toBe('true');
    expect(flat(auto())).toContain('Precisa da conta Asaas conectada.');
    auto().click();
    outside().dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
    await render();
    expect(host().changes).toEqual([]);
    expect(flat(q('[data-testid="billing-ask-owner"]'))).toBe(
      'Para usar cobranças automáticas, peça ao dono da conta para conectar o Asaas.',
    );
    expect(q('[data-testid="billing-connect"]')).toBeNull();
  });
});
