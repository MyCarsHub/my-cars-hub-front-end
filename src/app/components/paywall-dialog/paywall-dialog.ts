import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
} from '@angular/core';
import { animate, style, transition, trigger } from '@angular/animations';
import { BlockReason } from '../../types/billing-access.types';

interface PaywallCopy {
  title: string;
  body: string;
  cta: string;
}

const CTA_SEE_PLANS = 'Ver planos';

@Component({
  selector: 'app-paywall-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './paywall-dialog.html',
  animations: [
    trigger('backdrop', [
      transition(':enter', [
        style({ opacity: 0 }),
        animate('180ms ease-out', style({ opacity: 1 })),
      ]),
      transition(':leave', [animate('160ms ease-in', style({ opacity: 0 }))]),
    ]),
    trigger('sheet', [
      transition(':enter', [
        style({ opacity: 0, transform: 'translateY(24px)' }),
        animate(
          '260ms cubic-bezier(0.4, 0, 0.2, 1)',
          style({ opacity: 1, transform: 'translateY(0)' }),
        ),
      ]),
      transition(':leave', [
        animate(
          '180ms cubic-bezier(0.4, 0, 0.2, 1)',
          style({ opacity: 0, transform: 'translateY(24px)' }),
        ),
      ]),
    ]),
  ],
})
export class PaywallDialog {
  open = input.required<boolean>();
  reason = input<BlockReason | null>(null);
  /** When true, no backdrop-close, no dismiss button. */
  hardBlock = input<boolean>(true);

  confirmed = output<void>();
  dismissed = output<void>();

  protected readonly copy = computed<PaywallCopy>(() => {
    switch (this.reason()) {
      case 'TRIAL_EXPIRED':
        return {
          title: 'Seu período de teste terminou',
          body: 'Assine o PRO para continuar usando o MyCarsHub.',
          cta: CTA_SEE_PLANS,
        };
      case 'PAYMENT_FAILED':
      case 'PAST_DUE':
        return {
          title: 'Pagamento pendente',
          body: 'Regularize o pagamento para reativar sua assinatura e voltar a usar o MyCarsHub.',
          cta: CTA_SEE_PLANS,
        };
      case 'CANCELED':
        return {
          title: 'Sua assinatura foi cancelada',
          body: 'Escolha um plano para retomar o acesso completo à plataforma.',
          cta: CTA_SEE_PLANS,
        };
      case 'NO_SUBSCRIPTION':
      default:
        return {
          title: 'Escolha um plano para começar',
          body: 'Você precisa de um plano ativo para acessar sua conta.',
          cta: CTA_SEE_PLANS,
        };
    }
  });

  protected onConfirm(): void {
    this.confirmed.emit();
  }

  protected onDismiss(): void {
    if (this.hardBlock()) return;
    this.dismissed.emit();
  }

  protected onBackdropClick(): void {
    if (this.hardBlock()) return;
    this.dismissed.emit();
  }
}
