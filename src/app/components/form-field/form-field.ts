import {
  ChangeDetectionStrategy,
  Component,
  Directive,
  computed,
  inject,
  input,
} from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { AbstractControl } from '@angular/forms';
import { EMPTY, switchMap } from 'rxjs';
import { resolveValidationMessage } from '../../services/validation-messages';

let nextFieldId = 0;

/**
 * Label + projected control + single inline error message.
 *
 * Owns the accessibility wiring for the field: it renders the `role="alert"` message
 * and exposes `fieldId` / `describedBy` / `invalid` for the companion
 * `appFieldControl` directive, which puts `aria-invalid` / `aria-describedby` on the
 * real `<input>` / `<select>` / `<textarea>`.
 *
 * Field-level errors are ALWAYS inline — never a toast.
 */
@Component({
  selector: 'app-form-field',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    @if (label()) {
      <label class="block text-sm font-medium text-neutral-700 mb-1.5" [attr.for]="fieldId()">
        {{ label() }}
        @if (required()) {
          <span class="text-primary-700" aria-hidden="true">*</span>
        }
      </label>
    }

    <ng-content />

    @if (hint() && !errorMessage()) {
      <p class="text-xs text-neutral-400 mt-1" [id]="hintId()">{{ hint() }}</p>
    }
    @if (errorMessage(); as message) {
      <p class="text-xs text-rose-600 mt-1" [id]="errorId()" role="alert">{{ message }}</p>
    }
  `,
})
export class FormField {
  /** Visible label. Leave empty to render the control without one. */
  readonly label = input('');
  /** The control this field represents. Drives the error message and ARIA state. */
  readonly control = input<AbstractControl | null>(null);
  /** Explicit DOM id; auto-generated when omitted. */
  readonly controlId = input('');
  /** Persistent helper text, hidden while an error is showing. */
  readonly hint = input('');
  /** Renders the `*` marker and sets `aria-required` on the control. */
  readonly required = input(false);
  /** Per-validator copy overrides, e.g. `{ pattern: 'Placa inválida.' }`. */
  readonly messages = input<Readonly<Record<string, string>>>({});
  /** `touched` (default) only shows after interaction; `always` shows immediately. */
  readonly showWhen = input<'touched' | 'always'>('touched');

  private readonly autoId = `field-${++nextFieldId}`;

  /**
   * Reactive-forms controls are not signals, so mirror their event stream
   * (`AbstractControl.events`, Angular 18+) to re-evaluate the computeds below.
   */
  private readonly controlEvent = toSignal(
    toObservable(this.control).pipe(switchMap((control) => control?.events ?? EMPTY)),
  );

  readonly fieldId = computed(() => this.controlId() || this.autoId);
  readonly errorId = computed(() => `${this.fieldId()}-error`);
  readonly hintId = computed(() => `${this.fieldId()}-hint`);

  readonly errorMessage = computed<string | null>(() => {
    this.controlEvent();
    const control = this.control();
    if (!control) return null;
    if (this.showWhen() === 'touched' && !control.touched && !control.dirty) return null;
    return resolveValidationMessage(control.errors, this.messages());
  });

  readonly invalid = computed(() => this.errorMessage() !== null);

  readonly describedBy = computed<string | null>(() => {
    if (this.invalid()) return this.errorId();
    return this.hint() ? this.hintId() : null;
  });
}

/**
 * Put this on the native control projected into `<app-form-field>`.
 * It owns `id`, `aria-invalid`, `aria-describedby`, `aria-required` and the border tint.
 *
 * The consuming template must NOT keep a static `border-neutral-200` class on the
 * control — this directive toggles it against `border-rose-400`.
 */
@Directive({
  selector: '[appFieldControl]',
  host: {
    '[attr.id]': 'field.fieldId()',
    '[attr.aria-invalid]': 'field.invalid() ? "true" : null',
    '[attr.aria-describedby]': 'field.describedBy()',
    '[attr.aria-required]': 'field.required() ? "true" : null',
    '[class.border-neutral-200]': '!field.invalid()',
    '[class.border-rose-400]': 'field.invalid()',
  },
})
export class FieldControl {
  protected readonly field = inject(FormField);
}
