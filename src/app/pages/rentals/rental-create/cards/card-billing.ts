import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  ViewEncapsulation,
  computed,
  inject,
  input,
  output,
} from '@angular/core';
import { RouterLink } from '@angular/router';

import { InfoTip } from '../../../../components/info-tip/info-tip';

/**
 * Card 7 · Cobrança (pranchas CobrQ1–Q4 / CobrD1–D3). Sem título visível (dono, 21/11): cobranças
 * automáticas (pela conta Asaas da empresa) ou "Eu recebo por fora" (`automaticCharge`).
 * Só a tela: nada aqui conecta, envia ou muda o fluxo do Asaas. O estado é da página
 * (`RentalCreate`): aqui só se mostra e se avisa.
 */
@Component({
  selector: 'app-rc-billing',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, InfoTip],
  host: { class: 'rc-cb' },
  // Folha compartilhada pelos cards 5 a 8, sem encapsulamento (classes rt-*).
  styleUrl: './card-terms.css',
  encapsulation: ViewEncapsulation.None,
  styles: `
    .rt-opts { display: flex; flex-direction: column; gap: 4px; margin-top: 4px; }
    .rt-opt {
      display: flex; gap: 14px; align-items: flex-start; width: 100%; padding: 14px 12px; border: 0; border-radius: 16px;
      background: transparent; font: inherit; text-align: left; color: var(--color-fg); cursor: pointer;
    }
    .rt-opt[aria-disabled='true'] { opacity: 0.5; cursor: not-allowed; }
    .rt-opt:focus-visible { outline: 2px solid var(--color-primary-400); outline-offset: 2px; }
    .rt-mk {
      flex: none; width: 22px; height: 22px; margin-top: 1px; display: grid; place-items: center; border-radius: 11px;
      border: 2px solid var(--color-edge-field); transition: border-color 200ms cubic-bezier(0.32, 0.72, 0, 1);
    }
    .rt-mk i { width: 10px; height: 10px; border-radius: 5px; background: var(--color-primary-500); }
    .rt-opt[aria-checked='true'] .rt-mk { border-color: var(--color-primary-500); }
  `,
  template: `
    <div>
      <div class="rt-opts" role="radiogroup" aria-label="Como ele vai pagar" (keydown)="onKey($event)">
        <div class="rt-ckr">
          <button
            type="button"
            class="rt-opt"
            role="radio"
            data-testid="pay-automatic"
            [attr.aria-checked]="automatic()"
            [attr.aria-disabled]="autoLocked() ? 'true' : null"
            [attr.tabindex]="automatic() ? 0 : -1"
            (click)="pick(true)"
          >
            <span class="rt-mk">@if (automatic()) { <i></i> }</span>
            <span class="pe-ot">
              <b>Cobranças automáticas</b>
              @if (autoLocked()) {
                <span>Precisa da conta Asaas conectada.</span>
              } @else {
                <span>A gente manda cada cobrança por Pix e marca sozinho quando ele pagar.</span>
              }
            </span>
          </button>
          <app-info-tip #tAuto label="O que é Cobranças automáticas" controls="rt-tip-auto" />
        </div>
        <p class="rt-tip" id="rt-tip-auto" role="note" [hidden]="!tAuto.expanded()">
          Cada cobrança sai por Pix pela <b>sua conta Asaas</b>, na data de vencimento. Quando ele paga,
          o MyCarsHub marca como paga sozinho.
        </p>
        <button
          type="button"
          class="rt-opt"
          role="radio"
          data-testid="pay-outside"
          [attr.aria-checked]="!automatic()"
          [attr.tabindex]="automatic() ? -1 : 0"
          (click)="pick(false)"
        >
          <span class="rt-mk">@if (!automatic()) { <i></i> }</span>
          <span class="pe-ot">
            <b>Eu recebo por fora</b>
            <span>As cobranças ficam só anotadas. Você marca cada uma quando receber.</span>
          </span>
        </button>
      </div>
    </div>

    @if (automatic() && asaasConnected()) {
      <div class="rt-tile" data-testid="billing-tile">
        <span class="rt-ic ok">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"
            stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="10"></circle><path d="m8 12 3 3 5-6"></path>
          </svg>
        </span>
        <span class="rt-tx">
          <b>Sua conta Asaas está conectada</b>
          <span>Antes de criar, você vê o resumo das cobranças e confirma.</span>
        </span>
      </div>
    } @else if (automatic()) {
      <div class="rt-warn" data-testid="billing-warn">
        <p><b>Sua conta Asaas ainda não está conectada.</b> Sem ela, as cobranças automáticas não funcionam.</p>
        @if (isOwner()) {
          <a class="rt-pv" routerLink="/configuracoes/integracoes/asaas" data-testid="billing-connect">Conectar minha conta Asaas</a>
          <p class="rt-hint">O que você já preencheu aqui fica guardado.</p>
        } @else {
          <p class="rt-hint">Para usar cobranças automáticas, peça ao dono da conta para conectar o Asaas.</p>
        }
      </div>
    } @else {
      <div class="rt-tile" data-testid="billing-tile">
        <span class="rt-ic">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
            stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M9 11l3 3L22 4"></path><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"></path>
          </svg>
        </span>
        <span class="rt-tx">
          <b>Nada é enviado para ele</b>
          <span>Desconto e parcelas valem do mesmo jeito. Você marca cada cobrança como paga quando receber.</span>
        </span>
      </div>
      @if (autoLocked()) {
        <p class="rt-hint" data-testid="billing-ask-owner">
          Para usar cobranças automáticas, peça ao dono da conta para conectar o Asaas.
        </p>
      }
    }
    <p class="rt-hint">Dá para mudar uma cobrança depois, no aluguel.</p>
  `,
})
export class CardBilling {
  /** O valor de agora de `automaticCharge`. */
  readonly automatic = input(false);
  readonly asaasConnected = input(false);
  readonly isOwner = input(false);

  readonly automaticChange = output<boolean>();

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  /** Quem não é o dono não conecta o Asaas: sem conta conectada, a opção automática fica travada. */
  protected readonly autoLocked = computed(() => !this.asaasConnected() && !this.isOwner());

  protected pick(automatic: boolean): void {
    if (automatic && this.autoLocked()) return;
    if (automatic !== this.automatic()) this.automaticChange.emit(automatic);
  }

  /** Setas trocam a escolha e levam o foco junto (o padrão de radio do APG). */
  protected onKey(event: KeyboardEvent): void {
    if (!['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    if ((event.target as HTMLElement | null)?.getAttribute('role') !== 'radio') return;
    event.preventDefault();
    const next = !this.automatic();
    if (next && this.autoLocked()) return;
    this.automaticChange.emit(next);
    const id = next ? 'pay-automatic' : 'pay-outside';
    this.host.nativeElement.querySelector<HTMLElement>(`[data-testid="${id}"]`)?.focus();
  }
}
