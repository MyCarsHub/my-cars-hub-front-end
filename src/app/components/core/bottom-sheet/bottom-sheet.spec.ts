import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BOTTOM_SHEET_LEAVE_MS, BottomSheet } from './bottom-sheet';

@Component({
  imports: [BottomSheet],
  template: `
    <button type="button" id="opener">abrir</button>
    @if (open()) {
      <app-bottom-sheet title="Título" subtitle="Sub" [busy]="busy()" (closed)="onClosed()">
        <input id="first" />
        <button type="button" id="last">ok</button>
        <div sheetFooter><span id="footer">rodapé</span></div>
      </app-bottom-sheet>
    }
  `,
})
class Host {
  readonly open = signal(true);
  readonly busy = signal(false);
  closedCount = 0;
  onClosed(): void {
    this.closedCount++;
    this.open.set(false);
  }
}

describe('BottomSheet', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ imports: [Host] });
  });

  afterEach(() => vi.useRealTimers());

  function render() {
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    return fixture;
  }

  it('é um diálogo modal rotulado pelo título, com conteúdo e rodapé projetados', () => {
    const el: HTMLElement = render().nativeElement;
    const dialog = el.querySelector('[role="dialog"]') as HTMLElement;

    expect(dialog.getAttribute('aria-modal')).toBe('true');
    const title = el.querySelector('#' + dialog.getAttribute('aria-labelledby')) as HTMLElement;
    expect(title.textContent).toContain('Título');
    expect(el.querySelector('#first')).not.toBeNull();
    expect(el.querySelector('#footer')?.textContent).toContain('rodapé');
  });

  it('Esc fecha DEPOIS da animação de saída', () => {
    const fixture = render();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    fixture.detectChanges();

    expect(fixture.componentInstance.closedCount).toBe(0);
    expect(fixture.nativeElement.querySelector('.leaving')).not.toBeNull();

    vi.advanceTimersByTime(BOTTOM_SHEET_LEAVE_MS);
    fixture.detectChanges();
    expect(fixture.componentInstance.closedCount).toBe(1);
    expect(fixture.nativeElement.querySelector('[role="dialog"]')).toBeNull();
  });

  it('o fundo e o botão Fechar também fecham', () => {
    const fixture = render();
    (fixture.nativeElement.querySelector('[data-testid="bottom-sheet-close"]') as HTMLButtonElement).click();
    vi.advanceTimersByTime(BOTTOM_SHEET_LEAVE_MS);
    expect(fixture.componentInstance.closedCount).toBe(1);
  });

  it('com uma ação em voo (busy) não fecha', () => {
    const fixture = render();
    fixture.componentInstance.busy.set(true);
    fixture.detectChanges();

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    vi.advanceTimersByTime(BOTTOM_SHEET_LEAVE_MS * 2);
    expect(fixture.componentInstance.closedCount).toBe(0);
  });

  it('Tab no último controle volta ao primeiro (foco preso na folha)', () => {
    const fixture = render();
    const el: HTMLElement = fixture.nativeElement;
    const last = el.querySelector('#last') as HTMLButtonElement;
    last.focus();

    const tab = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    last.dispatchEvent(tab);

    expect(tab.defaultPrevented).toBe(true);
    expect(document.activeElement?.getAttribute('data-testid')).toBe('bottom-sheet-close');
  });
});
