import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { describe, it, expect, beforeEach } from 'vitest';
import { FieldControl, FormField } from './form-field';
import { applyFieldErrors } from '../../services/api-error';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, FormField, FieldControl],
  template: `
    <form [formGroup]="form">
      <app-form-field
        label="Placa"
        controlId="plate"
        hint="Formato: ABC1D23"
        [required]="true"
        [control]="form.controls.plate"
        [messages]="messages()"
      >
        <input appFieldControl formControlName="plate" class="border" />
      </app-form-field>
    </form>
  `,
})
class HostComponent {
  readonly form = new FormBuilder().nonNullable.group({
    plate: ['', [Validators.required, Validators.maxLength(7)]],
  });
  readonly messages = signal<Record<string, string>>({});
}

describe('FormField', () => {
  let fixture: ReturnType<typeof TestBed.createComponent<HostComponent>>;
  let host: HostComponent;

  function input(): HTMLInputElement {
    return fixture.nativeElement.querySelector('input') as HTMLInputElement;
  }
  function errorEl(): HTMLElement | null {
    return fixture.nativeElement.querySelector('[role="alert"]');
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [HostComponent] }).compileComponents();
    fixture = TestBed.createComponent(HostComponent);
    host = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('renders the label bound to the control id', () => {
    const label = fixture.nativeElement.querySelector('label') as HTMLLabelElement;
    expect(label.getAttribute('for')).toBe('plate');
    expect(label.textContent).toContain('Placa');
    expect(input().getAttribute('id')).toBe('plate');
  });

  it('describes the control by its hint while valid', () => {
    expect(input().getAttribute('aria-describedby')).toBe('plate-hint');
    expect(input().getAttribute('aria-invalid')).toBeNull();
    expect(errorEl()).toBeNull();
  });

  it('marks aria-required when required', () => {
    expect(input().getAttribute('aria-required')).toBe('true');
  });

  it('stays silent while the control is untouched', () => {
    host.form.controls.plate.setErrors({ required: true });
    fixture.detectChanges();
    expect(errorEl()).toBeNull();
  });

  it('shows a PT-BR message with role=alert once touched', () => {
    host.form.controls.plate.markAsTouched();
    fixture.detectChanges();

    expect(errorEl()?.textContent?.trim()).toBe('Campo obrigatório.');
    expect(errorEl()?.getAttribute('id')).toBe('plate-error');
    expect(input().getAttribute('aria-invalid')).toBe('true');
    expect(input().getAttribute('aria-describedby')).toBe('plate-error');
  });

  it('tints the control border when invalid', () => {
    host.form.controls.plate.markAsTouched();
    fixture.detectChanges();
    expect(input().classList.contains('border-rose-400')).toBe(true);
    expect(input().classList.contains('border-neutral-200')).toBe(false);
  });

  it('honours per-validator copy overrides', () => {
    host.messages.set({ required: 'Informe a placa.' });
    host.form.controls.plate.markAsTouched();
    fixture.detectChanges();
    expect(errorEl()?.textContent?.trim()).toBe('Informe a placa.');
  });

  it('shows a backend field error distributed by applyFieldErrors', () => {
    host.form.controls.plate.setValue('ABC1D23');
    applyFieldErrors(host.form, { plate: 'Placa já cadastrada nesta empresa.' });
    fixture.detectChanges();

    expect(errorEl()?.textContent?.trim()).toBe('Placa já cadastrada nesta empresa.');
    expect(input().getAttribute('aria-invalid')).toBe('true');
  });

  it('hides the hint while an error is showing', () => {
    host.form.controls.plate.markAsTouched();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('#plate-hint')).toBeNull();
  });
});
