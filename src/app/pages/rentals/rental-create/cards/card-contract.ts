import { ChangeDetectionStrategy, Component, ViewEncapsulation, computed, input, output } from '@angular/core';
import { RouterLink } from '@angular/router';

import { InfoTip } from '../../../../components/info-tip/info-tip';

/**
 * Card 6 · Contrato (pranchas CtrK1–K4 / CtrD1–D3). A chave "Gerar o contrato pelo modelo" e,
 * embaixo, o quadro do que acontece. Sem modelo, a chave fica desligada e travada; o dono da
 * conta ganha o atalho para criar um. O estado é da página (`RentalCreate`): aqui só se mostra
 * e se avisa.
 */
@Component({
  selector: 'app-rc-contract',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, InfoTip],
  host: { class: 'rc-cb' },
  // Folha compartilhada pelos cards 5 a 8, sem encapsulamento (classes rt-*).
  styleUrl: './card-terms.css',
  encapsulation: ViewEncapsulation.None,
  template: `
    <div class="rt-g2">
      <div class="rt-fld">
        <div class="rt-ckr">
          <button
            type="button"
            class="pe-tg"
            role="switch"
            data-testid="contract-template"
            [attr.aria-checked]="on()"
            [attr.aria-disabled]="hasContractTemplate() ? null : 'true'"
            (click)="toggle()"
          >
            <span class="pe-ot">
              <b>Gerar o contrato pelo modelo</b>
              @if (hasContractTemplate()) {
                <span>Sai pronto com os dados do motorista, do carro e deste aluguel.</span>
              } @else {
                <span>Você ainda não tem um modelo de contrato.</span>
              }
            </span>
            <span class="pe-sw" [class.on]="on()" [class.rt-off]="!hasContractTemplate()"></span>
          </button>
          <app-info-tip #tCtr label="O que é gerar o contrato" controls="rt-tip-ctr" />
        </div>
        <p class="rt-tip" id="rt-tip-ctr" role="note" [hidden]="!tCtr.expanded()">
          O contrato é criado <b>quando você salva o aluguel</b>, já com os dados do motorista, do carro,
          dos valores e das datas. Depois você encontra ele no detalhe do aluguel.
        </p>
      </div>

      <div class="rt-tile" data-testid="contract-tile">
        @if (on()) {
          <span class="rt-ic ok">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
              stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
              <path d="M14 2v6h6M8 13h8M8 17h5"></path>
            </svg>
          </span>
          <span class="rt-tx"><b>Usa o seu modelo de contrato</b><span>Criado ao salvar o aluguel.</span></span>
        } @else {
          <span class="rt-ic">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
              stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M12 16V4M7 9l5-5 5 5"></path><path d="M4 16v4h16v-4"></path>
            </svg>
          </span>
          @if (hasContractTemplate()) {
            <span class="rt-tx">
              <b>Você envia o PDF depois</b><span>No detalhe do aluguel, quando ele estiver criado.</span>
            </span>
          } @else {
            <span class="rt-tx">
              <b>Sem modelo, você envia o PDF depois</b>
              @if (isOwner()) {
                <span>No detalhe do aluguel, quando ele estiver criado.</span>
              } @else {
                <span>Para gerar pelo modelo, peça ao dono da conta para criar um.</span>
              }
            </span>
          }
        }
      </div>
    </div>

    @if (!hasContractTemplate() && isOwner()) {
      <a class="rt-pv" routerLink="/configuracoes/contratos" data-testid="contract-create">Criar meu modelo de contrato</a>
      <p class="rt-hint">O que você já preencheu aqui fica guardado.</p>
    }
  `,
})
export class CardContract {
  /** O valor de agora de `useContractTemplate`. */
  readonly useTemplate = input(false);
  readonly hasContractTemplate = input(false);
  readonly isOwner = input(false);

  readonly useTemplateChange = output<boolean>();

  /** Sem modelo não há o que gerar: a chave aparece desligada, mesmo com um rascunho antigo ligado. */
  protected readonly on = computed(() => this.hasContractTemplate() && this.useTemplate());

  protected toggle(): void {
    if (!this.hasContractTemplate()) return;
    this.useTemplateChange.emit(!this.useTemplate());
  }
}
