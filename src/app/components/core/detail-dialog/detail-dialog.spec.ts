import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { describe, it, expect, beforeEach } from 'vitest';

import { DetailDialog } from './detail-dialog';

/**
 * `DetailDialog` é a implementação de referência do bloco de focus management
 * dos diálogos (documentation/FIXES.md). O que precisa ficar protegido aqui é
 * exatamente o que os outros diálogos ainda não fazem: Tab preso no painel,
 * foco devolvido ao gatilho, Escape e trava de scroll do body.
 */
@Component({
  selector: 'app-detail-dialog-host',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DetailDialog],
  template: `
    <button type="button" id="trigger" (click)="open.set(true)">Abrir</button>
    <app-detail-dialog [open]="open()" title="Sugestão longa" (closed)="open.set(false)">
      <button type="button" id="inner">Ação interna</button>
    </app-detail-dialog>
  `,
})
class DetailDialogHost {
  readonly open = signal(false);
}

describe('DetailDialog', () => {
  let fixture: ComponentFixture<DetailDialogHost>;

  /** Renderiza o `@if` e deixa o effect de foco/scroll rodar. */
  function settle(): void {
    fixture.detectChanges();
    fixture.detectChanges();
  }

  function host(): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }

  function panel(): HTMLElement {
    const el = host().querySelector<HTMLElement>('[role="dialog"] [tabindex="-1"]');
    if (!el) throw new Error('painel do diálogo não renderizado');
    return el;
  }

  function press(key: string, options: KeyboardEventInit = {}): void {
    const target = (document.activeElement as HTMLElement | null) ?? panel();
    target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, ...options }));
    settle();
  }

  function focusables(): HTMLElement[] {
    return Array.from(panel().querySelectorAll<HTMLElement>('button:not([disabled])'));
  }

  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [DetailDialogHost],
      providers: [provideNoopAnimations()],
    });
    fixture = TestBed.createComponent(DetailDialogHost);
    fixture.detectChanges();
  });

  it('não renderiza nada enquanto fechado', () => {
    expect(host().querySelector('[role="dialog"]')).toBeNull();
  });

  it('ao abrir, foca o painel e trava a rolagem do body', () => {
    fixture.componentInstance.open.set(true);
    settle();

    expect(document.activeElement).toBe(panel());
    expect(document.body.style.overflow).toBe('hidden');
  });

  it('devolve o foco ao elemento que abriu e destrava o body ao fechar', () => {
    const trigger = host().querySelector<HTMLButtonElement>('#trigger');
    trigger?.focus();
    expect(document.activeElement).toBe(trigger);

    fixture.componentInstance.open.set(true);
    settle();
    expect(document.activeElement).not.toBe(trigger);

    fixture.componentInstance.open.set(false);
    settle();

    expect(document.activeElement).toBe(trigger);
    expect(document.body.style.overflow).not.toBe('hidden');
  });

  it('Escape fecha o diálogo', async () => {
    fixture.componentInstance.open.set(true);
    settle();

    press('Escape');

    expect(fixture.componentInstance.open()).toBe(false);
    // a remoção do nó é concluída depois do `:leave`, mesmo com animações noop
    await fixture.whenStable();
    fixture.detectChanges();
    expect(host().querySelector('[role="dialog"]')).toBeNull();
  });

  it('Tab no último focável volta para o primeiro (focus trap)', () => {
    fixture.componentInstance.open.set(true);
    settle();

    const items = focusables();
    expect(items.length).toBeGreaterThan(1);

    items[items.length - 1].focus();
    press('Tab');

    expect(document.activeElement).toBe(items[0]);
  });

  it('Shift+Tab no primeiro focável vai para o último (focus trap)', () => {
    fixture.componentInstance.open.set(true);
    settle();

    const items = focusables();
    items[0].focus();
    press('Tab', { shiftKey: true });

    expect(document.activeElement).toBe(items[items.length - 1]);
  });

  it('Shift+Tab a partir do painel vai para o último focável', () => {
    fixture.componentInstance.open.set(true);
    settle();

    expect(document.activeElement).toBe(panel());
    press('Tab', { shiftKey: true });

    const items = focusables();
    expect(document.activeElement).toBe(items[items.length - 1]);
  });

  it('projeta o conteúdo do caller e o botão de fechar emite (closed)', () => {
    fixture.componentInstance.open.set(true);
    settle();

    expect(panel().querySelector('#inner')).not.toBeNull();

    const buttons = focusables();
    buttons[buttons.length - 1].click();
    settle();

    expect(fixture.componentInstance.open()).toBe(false);
  });
});
