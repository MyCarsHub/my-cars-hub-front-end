import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { beforeEach, describe, expect, it } from 'vitest';
import { ActionsMenu } from './actions-menu';

@Component({
  imports: [ActionsMenu],
  template: `
    <div (click)="rowClicks.set(rowClicks() + 1)" data-testid="row">
      <app-actions-menu label="Mais ações">
        <button type="button" role="menuitem" data-testid="edit" (click)="picked.set('edit')">
          Editar
        </button>
        <button type="button" role="menuitem" disabled data-testid="blocked">Bloqueado</button>
        <button type="button" role="menuitem" data-testid="delete" (click)="picked.set('delete')">
          Excluir
        </button>
      </app-actions-menu>
    </div>
  `,
})
class HostComponent {
  readonly picked = signal<string | null>(null);
  readonly rowClicks = signal(0);
}

function trigger(fixture: ComponentFixture<HostComponent>): HTMLButtonElement {
  return fixture.debugElement.query(By.css('button[aria-haspopup="menu"]')).nativeElement;
}

function menu(fixture: ComponentFixture<HostComponent>): HTMLElement | null {
  return fixture.debugElement.query(By.css('[role="menu"]'))?.nativeElement ?? null;
}

function item(fixture: ComponentFixture<HostComponent>, testId: string): HTMLElement {
  return fixture.debugElement.query(By.css(`[data-testid="${testId}"]`)).nativeElement;
}

describe('ActionsMenu', () => {
  let fixture: ComponentFixture<HostComponent>;

  beforeEach(() => {
    fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
  });

  it('starts closed with correct ARIA on the trigger', () => {
    const btn = trigger(fixture);
    expect(btn.getAttribute('aria-expanded')).toBe('false');
    expect(btn.getAttribute('aria-haspopup')).toBe('menu');
    expect(btn.getAttribute('aria-label')).toBe('Mais ações');
    expect(btn.getAttribute('aria-controls')).toBeNull();
    expect(menu(fixture)).toBeNull();
  });

  it('opens on click and wires aria-controls to the menu id', () => {
    const btn = trigger(fixture);
    btn.click();
    fixture.detectChanges();

    const panel = menu(fixture);
    expect(panel).not.toBeNull();
    expect(btn.getAttribute('aria-expanded')).toBe('true');
    expect(btn.getAttribute('aria-controls')).toBe(panel?.id);
    expect(panel?.getAttribute('aria-labelledby')).toBe(btn.id);
  });

  it('closes when the trigger is clicked again', () => {
    const btn = trigger(fixture);
    btn.click();
    fixture.detectChanges();
    btn.click();
    fixture.detectChanges();

    expect(menu(fixture)).toBeNull();
    expect(btn.getAttribute('aria-expanded')).toBe('false');
  });

  it('renders the panel as fixed and clamped inside the viewport (no clipping/overflow)', () => {
    trigger(fixture).click();
    fixture.detectChanges();

    const panel = menu(fixture) as HTMLElement;
    const style = panel.style;
    // Tailwind utilities are not compiled in jsdom, so assert the class itself.
    expect(panel.classList.contains('fixed')).toBe(true);
    expect(parseFloat(style.left)).toBeGreaterThanOrEqual(0);
    expect(parseFloat(style.left) + parseFloat(style.width)).toBeLessThanOrEqual(window.innerWidth);
    expect(parseFloat(style.top)).toBeGreaterThanOrEqual(0);
    expect(parseFloat(style.maxHeight)).toBeGreaterThan(0);
  });

  it('focuses the first enabled item on open', () => {
    trigger(fixture).click();
    fixture.detectChanges();

    expect(document.activeElement).toBe(item(fixture, 'edit'));
  });

  it('moves focus with arrow keys and skips disabled items', () => {
    const btn = trigger(fixture);
    btn.click();
    fixture.detectChanges();

    const panel = menu(fixture) as HTMLElement;
    panel.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect(document.activeElement).toBe(item(fixture, 'delete'));

    panel.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect(document.activeElement).toBe(item(fixture, 'edit'));

    panel.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
    expect(document.activeElement).toBe(item(fixture, 'delete'));

    panel.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
    expect(document.activeElement).toBe(item(fixture, 'edit'));
  });

  it('closes on Escape and returns focus to the trigger', () => {
    const btn = trigger(fixture);
    btn.click();
    fixture.detectChanges();

    (menu(fixture) as HTMLElement).dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    );
    fixture.detectChanges();

    expect(menu(fixture)).toBeNull();
    expect(document.activeElement).toBe(btn);
  });

  it('closes on Tab and returns focus to the trigger', () => {
    const btn = trigger(fixture);
    btn.click();
    fixture.detectChanges();

    (menu(fixture) as HTMLElement).dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }),
    );
    fixture.detectChanges();

    expect(menu(fixture)).toBeNull();
    expect(document.activeElement).toBe(btn);
  });

  it('closes after an item is activated and forwards the item action', () => {
    trigger(fixture).click();
    fixture.detectChanges();

    item(fixture, 'delete').click();
    fixture.detectChanges();

    expect(fixture.componentInstance.picked()).toBe('delete');
    expect(menu(fixture)).toBeNull();
  });

  it('closes on an outside pointerdown', () => {
    trigger(fixture).click();
    fixture.detectChanges();

    document.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    fixture.detectChanges();

    expect(menu(fixture)).toBeNull();
  });

  it('does not leak clicks to the surrounding clickable row', () => {
    const btn = trigger(fixture);
    btn.click();
    fixture.detectChanges();
    item(fixture, 'edit').click();
    fixture.detectChanges();

    expect(fixture.componentInstance.rowClicks()).toBe(0);
  });

  it('opens with ArrowDown from the trigger', () => {
    const btn = trigger(fixture);
    btn.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    fixture.detectChanges();

    expect(menu(fixture)).not.toBeNull();
    expect(document.activeElement).toBe(item(fixture, 'edit'));
  });
});
