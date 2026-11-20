import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { afterEach, describe, expect, it } from 'vitest';

import { CardContract } from './card-contract';

@Component({
  imports: [CardContract],
  template: `
    <app-rc-contract
      [useTemplate]="use()"
      [hasContractTemplate]="has()"
      [isOwner]="owner()"
      (useTemplateChange)="changes.push($event); use.set($event)"
    />
  `,
})
class Host {
  readonly use = signal(true);
  readonly has = signal(true);
  readonly owner = signal(true);
  readonly changes: boolean[] = [];
}

describe('CardContract — card 6 · Contrato', () => {
  let fixture: ReturnType<typeof TestBed.createComponent<Host>>;
  const host = (): Host => fixture.componentInstance;
  const el = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const sw = (): HTMLButtonElement => el().querySelector('[role="switch"]') as HTMLButtonElement;
  /** Título | frase do quadro. */
  const tile = (): string =>
    Array.from(el().querySelectorAll('[data-testid="contract-tile"] .rt-tx > *'))
      .map((n) => (n.textContent ?? '').replace(/\s+/g, ' ').trim())
      .join(' | ');
  const link = (): HTMLAnchorElement | null => el().querySelector('[data-testid="contract-create"]');

  async function mount(state: { use?: boolean; has?: boolean; owner?: boolean } = {}): Promise<void> {
    TestBed.configureTestingModule({ imports: [Host], providers: [provideRouter([])] });
    fixture = TestBed.createComponent(Host);
    host().use.set(state.use ?? true);
    host().has.set(state.has ?? true);
    host().owner.set(state.owner ?? true);
    await render();
  }
  async function render(): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
  }

  afterEach(() => TestBed.resetTestingModule());

  it('com modelo, ligado: a chave marcada e "Usa o seu modelo de contrato"', async () => {
    await mount();
    expect(sw().getAttribute('aria-checked')).toBe('true');
    expect(sw().getAttribute('aria-disabled')).toBeNull();
    expect(sw().textContent).toContain('Gerar o contrato pelo modelo');
    expect(tile()).toBe('Usa o seu modelo de contrato | Criado ao salvar o aluguel.');
    expect(link()).toBeNull();
  });

  it('com modelo: o toque desliga e o quadro vira "Você envia o PDF depois"', async () => {
    await mount();
    sw().click();
    await render();
    expect(host().changes).toEqual([false]);
    expect(sw().getAttribute('aria-checked')).toBe('false');
    expect(tile()).toBe('Você envia o PDF depois | No detalhe do aluguel, quando ele estiver criado.');
  });

  it('o (i) explica quando o contrato é criado', async () => {
    await mount();
    const tip = el().querySelector('#rt-tip-ctr') as HTMLElement;
    expect(tip.hidden).toBe(true);
    (el().querySelector('button[aria-label="O que é gerar o contrato"]') as HTMLButtonElement).click();
    await render();
    expect(tip.hidden).toBe(false);
    expect(tip.textContent).toContain('quando você salva o aluguel');
  });

  it('sem modelo (dono): chave travada e desligada, atalho para criar e a nota do rascunho', async () => {
    await mount({ has: false, use: true });
    expect(sw().getAttribute('aria-checked')).toBe('false');
    expect(sw().getAttribute('aria-disabled')).toBe('true');
    expect(sw().textContent).toContain('Você ainda não tem um modelo de contrato.');
    sw().click();
    await render();
    expect(host().changes).toEqual([]);
    expect(tile()).toBe('Sem modelo, você envia o PDF depois | No detalhe do aluguel, quando ele estiver criado.');
    expect(link()!.textContent?.trim()).toBe('Criar meu modelo de contrato');
    expect(link()!.getAttribute('href')).toBe('/configuracoes/contratos');
    expect(el().textContent).toContain('O que você já preencheu aqui fica guardado.');
  });

  it('sem modelo (outra pessoa da equipe): sem atalho, pede ao dono', async () => {
    await mount({ has: false, owner: false });
    expect(link()).toBeNull();
    expect(tile()).toContain('Para gerar pelo modelo, peça ao dono da conta para criar um.');
    expect(el().textContent).not.toContain('fica guardado');
  });
});
