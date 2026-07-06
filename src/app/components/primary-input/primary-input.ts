import { NgOptimizedImage } from '@angular/common';
import { Component, forwardRef, input, signal, ChangeDetectionStrategy } from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR, ReactiveFormsModule } from '@angular/forms';

type InputType = 'text' | 'email' | 'password' | 'number';

@Component({
  selector: 'app-primary-input',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    NgOptimizedImage
  ],
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => PrimaryInput),
      multi: true
    }
  ],
  templateUrl: './primary-input.html',
  styleUrl: './primary-input.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PrimaryInput implements ControlValueAccessor {
  label = input<string>("");
  type = input<InputType>("text");
  placeholder = input<string>("");
  iconSrc = input<string>("");
  maxLength = input<number | null>(null);

  protected readonly internalValue = signal<string>('');
  protected readonly isDisabled = signal<boolean>(false);

  onChange: any = () => {};
  onTouched: any = () => {};

  onInput(event: Event) {
    const value = (event.target as HTMLInputElement).value;
    this.internalValue.set(value);
    this.onChange(value);
  }

  writeValue(value: any): void {
    this.internalValue.set(value || '');
  }

  registerOnChange(fn: any): void {
    this.onChange = fn;
  }

  registerOnTouched(fn: any): void {
    this.onTouched = fn;
  }

  setDisabledState(isDisabled: boolean): void {
    this.isDisabled.set(isDisabled);
  }
}
