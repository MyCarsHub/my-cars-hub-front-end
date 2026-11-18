import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { beforeEach, describe, expect, it } from 'vitest';
import { ConfirmDialog, type ConfirmDialogVariant } from './confirm-dialog';

describe('ConfirmDialog — variantes do botão de confirmar', () => {
  let fixture: ComponentFixture<ConfirmDialog>;

  const confirmButton = (): HTMLButtonElement => {
    const buttons = (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>('button');
    return buttons[buttons.length - 1];
  };

  function render(variant?: ConfirmDialogVariant): void {
    fixture = TestBed.createComponent(ConfirmDialog);
    fixture.componentRef.setInput('open', true);
    fixture.componentRef.setInput('confirmLabel', 'Reativar');
    if (variant) fixture.componentRef.setInput('variant', variant);
    fixture.detectChanges();
  }

  beforeEach(() => TestBed.configureTestingModule({ providers: [provideNoopAnimations()] }));

  it('sem variante continua laranja (info), como hoje', () => {
    render();
    expect(confirmButton().textContent?.trim()).toBe('Reativar');
    expect(confirmButton().className).toContain('bg-primary-500');
    expect(confirmButton().className).toContain('text-white');
  });

  it('danger e warning não mudaram', () => {
    render('danger');
    expect(confirmButton().className).toContain('bg-red-500');
    render('warning');
    expect(confirmButton().className).toContain('bg-amber-500');
  });

  it('success: verde sólido da marca (#10B981 = success-500) com texto branco', () => {
    render('success');
    const cls = confirmButton().className;
    expect(cls).toContain('bg-success-500');
    expect(cls).toContain('text-white');
    expect(cls).not.toContain('bg-primary-500');
  });

  it('success: ícone de confirmação verde no fundo verde claro', () => {
    render('success');
    const icon = (fixture.nativeElement as HTMLElement).querySelector('svg')!;
    expect(icon.getAttribute('class')).toContain('text-success-700');
    expect(icon.parentElement!.className).toContain('bg-success-50');
  });
});
