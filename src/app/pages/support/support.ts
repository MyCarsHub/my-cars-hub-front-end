import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { Location } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { environment } from '../../../environments/environment';
import { SupportTicketService } from '../../services/support-ticket.service';
import { SupportTicketChannel } from '../../types/support.types';

/**
 * Popup de Suporte — renderizado como overlay full-screen (via rota `/suporte`).
 * Usuário descreve o problema, escolhe canal (email ou WhatsApp). Ticket é
 * gravado no backend (audit + painel admin em /admin/suporte); se WhatsApp,
 * também abre wa.me em nova aba com a descrição pré-preenchida.
 * Fechar (Cancelar, backdrop, ESC, X) navega de volta pra rota anterior.
 */
@Component({
  selector: 'app-support',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule],
  templateUrl: './support.html',
  host: {
    '(document:keydown.escape)': 'close()',
  },
})
export class SupportPage {
  private readonly location = inject(Location);
  private readonly service = inject(SupportTicketService);
  private readonly fb = inject(FormBuilder);

  protected readonly whatsappNumber = environment.supportWhatsapp;
  protected readonly whatsappEnabled = this.whatsappNumber.length > 0;

  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly success = signal<string | null>(null);

  protected readonly form = this.fb.nonNullable.group({
    message: [
      '',
      [Validators.required, Validators.minLength(10), Validators.maxLength(2000)],
    ],
  });

  private readonly formValue = toSignal(this.form.valueChanges, {
    initialValue: this.form.getRawValue(),
  });

  protected readonly messageLength = computed(
    () => (this.formValue()?.message ?? '').length,
  );

  protected readonly messageTooShort = computed(() => this.messageLength() < 10);

  protected sendViaEmail(): void {
    if (!this.validate()) return;
    this.submit('EMAIL', () => {
      this.success.set('Ticket enviado — nosso time responderá por email em breve.');
    });
  }

  protected sendViaWhatsapp(): void {
    if (!this.whatsappEnabled) return;
    if (!this.validate()) return;
    const text = this.form.getRawValue().message.trim();
    this.submit('WHATSAPP', () => {
      const wa = `https://wa.me/${this.whatsappNumber}?text=${encodeURIComponent(text)}`;
      window.open(wa, '_blank', 'noopener,noreferrer');
      this.success.set('Ticket registrado e conversa aberta no WhatsApp.');
    });
  }

  protected close(): void {
    this.location.back();
  }

  private validate(): boolean {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.error.set('Descreva seu problema em pelo menos 10 caracteres.');
      return false;
    }
    return true;
  }

  private submit(channel: SupportTicketChannel, onSuccess: () => void): void {
    if (this.saving()) return;
    this.saving.set(true);
    this.error.set(null);
    this.success.set(null);
    const message = this.form.getRawValue().message.trim();
    this.service.create({ message, channel }).subscribe({
      next: () => {
        this.saving.set(false);
        this.form.reset({ message: '' });
        onSuccess();
      },
      error: (err: HttpErrorResponse) => {
        this.saving.set(false);
        const body = err.error;
        const msg =
          body && typeof body === 'object' && typeof body.message === 'string'
            ? body.message
            : 'Não foi possível enviar. Tente novamente.';
        this.error.set(msg);
      },
    });
  }
}
