import { ChangeDetectionStrategy, Component, Injectable, computed, inject, signal } from '@angular/core';

/** O que o aviso de atraso precisa mostrar. Montado pelo shell a partir de `/access-status`. */
export interface PastDueNotice {
  /** "31/10, 21:34" — fim da carência, no fuso do negócio. */
  deadline: string;
  /** Só o dono paga; os outros membros leem "avise o dono". */
  canPay: boolean;
  /** Nas últimas 24h o aviso não sai da tela. */
  canDismiss: boolean;
}

/**
 * Ponte sem dependências entre o shell (que lê o acesso e navega) e o aviso que
 * mora no `DefaultPageLayout`, logo abaixo do título de cada página. Sem
 * HttpClient nem Router aqui: o layout é usado por dezenas de specs que não
 * montam nenhum dos dois.
 */
@Injectable({ providedIn: 'root' })
export class PastDueBannerStore {
  readonly notice = signal<PastDueNotice | null>(null);
  /** Rota atual esconde o aviso (a própria Assinatura já diz tudo). */
  readonly hidden = signal(false);
  /** Ação de "Pagar agora", instalada pelo shell. */
  payNow: () => void = () => void 0;
  /** "Depois": esconde por 24h, instalada pelo shell. */
  later: () => void = () => void 0;
}

/**
 * Aviso app-wide de cobrança recusada, com o prazo (mockup 03). Mesmas cores do
 * aviso âmbar da Assinatura; "Pagar agora" é o único laranja da faixa.
 */
@Component({
  selector: 'app-past-due-banner',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    :host { display: block; }
    .banner {
      display: flex; gap: 12px; align-items: flex-start; padding: 16px; border-radius: 16px;
      background: #FFFBEB; border: 1px solid #FDE68A; color: #78350F; margin-bottom: 16px; flex-wrap: wrap;
      animation: pd-in 320ms cubic-bezier(0.32, 0.72, 0, 1) both;
    }
    :host-context(.dark) .banner { background: rgba(245, 158, 11, 0.1); border-color: rgba(245, 158, 11, 0.3); color: #FDE68A; }
    .bi svg { width: 20px; height: 20px; margin-top: 1px; }
    .bt { flex: 1; min-width: 0; }
    .bt b { display: block; font-size: 15px; font-weight: 700; }
    .bt span { display: block; font-size: 14px; margin-top: 2px; }
    .acts { display: flex; gap: 8px; margin-top: 0; flex-basis: 100%; padding-left: 32px; }
    .btn {
      display: inline-flex; align-items: center; justify-content: center; min-height: 44px; padding: 0 16px;
      border-radius: 12px; font-weight: 600; font-size: 15px; border: 0; cursor: pointer; flex: none;
      transition: transform 0.2s cubic-bezier(0.32, 0.72, 0, 1);
    }
    .btn:active { transform: scale(0.97); }
    .btn:focus-visible { outline: 2px solid #F63B04; outline-offset: 2px; }
    .primary { background: linear-gradient(180deg, #F84A16 0%, #F63B04 50%, #E23500 100%); color: #fff; box-shadow: inset 0 1px 0 rgba(255,255,255,.18); flex: 1; }
    .ghost { background: transparent; color: inherit; }
    @media (min-width: 1024px) {
      .banner { align-items: center; flex-wrap: nowrap; }
      .acts { flex-basis: auto; padding-left: 0; flex-direction: row-reverse; }
      .primary { flex: none; }
    }
    @keyframes pd-in { from { opacity: 0; transform: translateY(-6px); } }
    @media (prefers-reduced-motion: reduce) { .banner { animation: none; } .btn:active { transform: none; } }
  `,
  template: `
    @if (visible(); as n) {
      <div class="banner" role="status" data-testid="past-due-banner">
        <span class="bi" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/></svg>
        </span>
        <div class="bt">
          <b>Pagamento da assinatura recusado</b>
          @if (n.canPay) {
            <span>Pague até {{ n.deadline }} para manter o acesso.</span>
          } @else {
            <span>Avise o dono da conta: o acesso pausa em {{ n.deadline }} se a fatura não for paga.</span>
          }
        </div>
        @if (n.canPay) {
          <div class="acts">
            <button type="button" class="btn primary" (click)="store.payNow()" data-testid="past-due-pay">Pagar agora</button>
            @if (n.canDismiss) {
              <button type="button" class="btn ghost" (click)="store.later()">Depois</button>
            }
          </div>
        }
      </div>
    }
  `,
})
export class PastDueBanner {
  protected readonly store = inject(PastDueBannerStore);
  protected readonly visible = computed(() => (this.store.hidden() ? null : this.store.notice()));
}
