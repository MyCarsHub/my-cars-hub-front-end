import { ChangeDetectionStrategy, Component, ViewEncapsulation, computed, input, output } from '@angular/core';
import { RouterLink } from '@angular/router';

import { InfoTip } from '../../../../components/info-tip/info-tip';

/**
 * Card 7 · Cobrança. Igual ao card Contrato (dono, 22/11): a chave "Cobranças automáticas" na
 * linha inteira e, embaixo, o quadro do que acontece. Desligada = "Eu recebo por fora"
 * (`automaticCharge`). Só a tela: nada aqui conecta, envia ou muda o fluxo do Asaas. O estado é
 * da página (`RentalCreate`): aqui só se mostra e se avisa.
 */
@Component({
  selector: 'app-rc-billing',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, InfoTip],
  host: { class: 'rc-cb' },
  // Folha compartilhada pelos cards 5 a 8, sem encapsulamento (classes rt-*).
  styleUrl: './card-terms.css',
  encapsulation: ViewEncapsulation.None,
  template: `
    <div class="rt-col">
      <div class="rt-fld">
        <div class="rt-ckr">
          <button
            type="button"
            class="pe-tg"
            role="switch"
            data-testid="pay-automatic"
            [attr.aria-checked]="automatic()"
            [attr.aria-disabled]="autoLocked() && !automatic() ? 'true' : null"
            (click)="toggle()"
          >
            <span class="pe-ot">
              <b>Cobranças automáticas</b>
              @if (autoLocked()) {
                <span>Precisa da conta Asaas conectada.</span>
              } @else {
                <span>A gente manda cada cobrança por Pix e marca sozinho quando ele pagar.</span>
              }
            </span>
            <span class="pe-sw" [class.on]="automatic()" [class.rt-off]="autoLocked() && !automatic()"></span>
          </button>
          <app-info-tip #tAuto label="O que é Cobranças automáticas" controls="rt-tip-auto" />
        </div>
        <p class="rt-tip" id="rt-tip-auto" role="note" [hidden]="!tAuto.expanded()">
          Cada cobrança sai por Pix pela <b>sua conta Asaas</b>, na data de vencimento. Quando ele paga,
          o MyCarsHub marca como paga sozinho. Desligada, você recebe por fora e marca cada uma.
        </p>
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
            <b>Você recebe por fora</b>
            <span>Nada é enviado para ele. Você marca cada cobrança como paga quando receber.</span>
          </span>
        </div>
        @if (autoLocked()) {
          <p class="rt-hint" data-testid="billing-ask-owner">
            Para usar cobranças automáticas, peça ao dono da conta para conectar o Asaas.
          </p>
        }
      }
    </div>
    <p class="rt-hint">Dá para mudar uma cobrança depois, no aluguel.</p>
  `,
})
export class CardBilling {
  /** O valor de agora de `automaticCharge`. */
  readonly automatic = input(false);
  readonly asaasConnected = input(false);
  readonly isOwner = input(false);

  readonly automaticChange = output<boolean>();

  /** Quem não é o dono não conecta o Asaas: sem conta conectada, ligar a chave fica travado. */
  protected readonly autoLocked = computed(() => !this.asaasConnected() && !this.isOwner());

  protected toggle(): void {
    const next = !this.automatic();
    if (next && this.autoLocked()) return;
    this.automaticChange.emit(next);
  }
}
