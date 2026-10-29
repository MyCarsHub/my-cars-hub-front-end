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
const CTA_UNDERSTOOD = 'Entendi';
const CTA_PAY_NOW = 'Pagar agora';

/**
 * Quem NÃO é o dono não pode regularizar o plano (a rota `/billing` é `roleGuard(['OWNER'])`
 * e o backend recusa as escritas), então a tela não manda assinar: diz quem resolve. Uma
 * cópia só para todos os motivos, porque a pessoa não tem o que fazer com a diferença entre
 * "teste terminou" e "pagamento pendente" — o próximo passo é o mesmo.
 */
const NON_OWNER_COPY: PaywallCopy = {
  title: 'Esta empresa está sem plano ativo',
  body: 'Só o dono da empresa pode regularizar o plano. Fale com ele para voltar a usar o MyCarsHub.',
  cta: CTA_UNDERSTOOD,
};

@Component({
  selector: 'app-paywall-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './paywall-dialog.html',
  styles: `
    /* Atraso (mockup 07): borda acesa no tom de bloqueio, mesma receita do cartão de status. */
    .paused { isolation: isolate; overflow: visible; }
    .paused::before {
      content: ''; position: absolute; inset: -1px; border-radius: inherit; padding: 2px; pointer-events: none;
      background: linear-gradient(180deg, rgba(194, 47, 0, 0.45) 0%, rgba(225, 29, 72, 0.7) 55%, #E11D48 100%);
      -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
      -webkit-mask-composite: xor; mask-composite: exclude;
    }
    .paused::after {
      content: ''; position: absolute; left: 0; right: 0; bottom: 0; height: 140px; z-index: -1; pointer-events: none;
      border-radius: inherit; background: radial-gradient(75% 95% at 50% 100%, rgba(225, 29, 72, 0.14), transparent 72%);
    }
    .paywall-kv { margin: 0; border: 1px solid var(--color-edge); border-radius: 12px; }
    .paywall-kv div { display: flex; justify-content: space-between; gap: 12px; padding: 12px 16px; font-size: 14.5px; }
    .paywall-kv dt { color: var(--color-fg-subtle); }
    .paywall-kv dd { margin: 0; color: var(--color-fg); font-weight: 600; font-family: var(--font-mono); }
  `,
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
  /**
   * `true` only for the OWNER — the one role that can open `/billing`. Defaults to `true`
   * so a caller that never passes it keeps the subscribe copy and CTA.
   */
  canRegularize = input<boolean>(true);
  /** "Starter" — plano da fatura em aberto (atraso). */
  planName = input<string | null>(null);
  /** "R$ 79,90" — valor em aberto (atraso). */
  amountDue = input<string | null>(null);

  /** OWNER pressed the plans CTA: the host navigates to `/billing`. */
  confirmed = output<void>();
  /** Non-owner pressed "Entendi": the host only closes the dialog, it navigates nowhere. */
  acknowledged = output<void>();
  dismissed = output<void>();
  /** Atraso: "Trocar cartão". */
  changeCard = output<void>();
  /** Atraso: "Falar com o suporte". */
  contactSupport = output<void>();

  /** Dono com fatura em aberto: o paywall vira a folha "Acesso pausado". */
  protected readonly paymentPaused = computed(() => {
    const r = this.reason();
    return this.canRegularize() && (r === 'PAYMENT_FAILED' || r === 'PAST_DUE');
  });

  protected readonly copy = computed<PaywallCopy>(() => {
    if (!this.canRegularize()) return NON_OWNER_COPY;
    switch (this.reason()) {
      case 'TRIAL_EXPIRED':
        return {
          title: 'Seu período de teste terminou',
          body: 'Assine o PRO para continuar usando o MyCarsHub.',
          cta: CTA_SEE_PLANS,
        };
      case 'PAYMENT_FAILED':
      case 'PAST_DUE': {
        // Mockup 07: quem deve vai direto para o pagamento, nunca para a grade
        // de planos (onde o plano atual aparece desabilitado — beco sem saída).
        const plan = this.planName();
        return {
          title: 'Acesso pausado',
          body: plan
            ? `A fatura do plano ${plan} não foi paga. Seus carros, motoristas e cobranças continuam salvos.`
            : 'A fatura da assinatura não foi paga. Seus carros, motoristas e cobranças continuam salvos.',
          cta: CTA_PAY_NOW,
        };
      }
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
    if (this.canRegularize()) this.confirmed.emit();
    else this.acknowledged.emit();
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
