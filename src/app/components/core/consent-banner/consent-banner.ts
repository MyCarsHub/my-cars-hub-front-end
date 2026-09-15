import {
  ChangeDetectionStrategy,
  Component,
  DOCUMENT,
  PLATFORM_ID,
  effect,
  inject,
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { RouterLink } from '@angular/router';

import { ConsentService } from '../../../services/consent.service';

/**
 * Banner de consentimento do Google Analytics 4.
 *
 * <h4>O texto</h4>
 * Diz o minimo honesto e verificavel: qual ferramenta, para que, que grava
 * cookie, que so liga com aceite, e que da para recusar e seguir navegando. Sem
 * nenhuma afirmacao juridica que o produto nao possa sustentar — a politica de
 * privacidade e quem detalha, e o link vai para la.
 *
 * <h4>Por que ele reserva espaco em vez de so flutuar</h4>
 * Ele e `fixed` no rodape, e no telefone o conteudo ocupa a largura toda. Sem
 * reservar altura, ele cobriria o fim do documento — inclusive o rodape, onde
 * mora o link da propria politica que este texto manda ler. Enquanto estiver na
 * tela, o `body` ganha um respiro do tamanho dele. Ja perdemos um node inteiro
 * para um botao `fixed` cobrindo o preco anual no telefone (FIX-0295).
 */
@Component({
  selector: 'app-consent-banner',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  template: `
    @if (consent.undecided()) {
      <div
        class="fixed inset-x-0 bottom-0 z-[90] border-t border-rule-contrast bg-paper px-4 py-4 shadow-[0_-8px_24px_-18px_rgba(10,10,10,0.35)] sm:px-6"
        role="dialog"
        aria-modal="false"
        aria-labelledby="consent-title"
        data-consent-banner
      >
        <div class="mx-auto flex max-w-[1200px] flex-col gap-3 sm:flex-row sm:items-center sm:gap-6">
          <div class="flex-1">
            <h2 id="consent-title" class="text-sm font-semibold text-ink">Cookies de análise</h2>
            <p class="mt-1 text-sm leading-[1.5] text-ink-soft">
              Usamos o Google Analytics para entender como o site é usado. Ele grava um cookie
              no seu navegador e só é ativado se você aceitar. Recusar não limita nada no site.
              Detalhes na
              <a
                routerLink="/politica-de-privacidade"
                class="font-semibold text-brand underline hover:text-brand-light"
                >Política de Privacidade</a
              >.
            </p>
          </div>
          <div class="flex shrink-0 gap-2">
            <button
              type="button"
              class="min-h-[44px] flex-1 rounded-lg border border-rule-contrast px-4 text-sm font-semibold text-ink hover:bg-paper-alt sm:flex-none"
              (click)="consent.reject()"
              data-consent-reject
            >
              Recusar
            </button>
            <button
              type="button"
              class="min-h-[44px] flex-1 rounded-lg bg-brand px-4 text-sm font-semibold text-white hover:bg-brand-light sm:flex-none"
              (click)="consent.accept()"
              data-consent-accept
            >
              Aceitar
            </button>
          </div>
        </div>
      </div>
    }
  `,
})
export class ConsentBanner {
  protected readonly consent = inject(ConsentService);
  private readonly document = inject(DOCUMENT);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  constructor() {
    effect(() => {
      const open = this.consent.undecided();
      if (!this.isBrowser) return;
      this.document.body.classList.toggle('has-consent-banner', open);
    });
  }
}
