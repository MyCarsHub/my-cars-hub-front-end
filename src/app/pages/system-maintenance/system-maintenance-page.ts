import { isPlatformBrowser } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  OnInit,
  PLATFORM_ID,
  inject,
  signal,
} from '@angular/core';
import { Meta, Title } from '@angular/platform-browser';
import { Router } from '@angular/router';
import { environment } from '../../../environments/environment';
import { PlatformMaintenanceService } from '../../services/platform-maintenance.service';

/** Primeira nova tentativa automática: 60 s; dobra a cada falha até 5 min. */
export const MAINTENANCE_RETRY_MS = 60_000;
export const MAINTENANCE_RETRY_MAX_MS = 300_000;

export const MAINTENANCE_STILL_DOWN = 'Ainda em manutenção. Tente de novo em alguns minutos.';

/**
 * Tela inteira de manutenção (handoff "Páginas de sistema"): sem shell, sem logo, sem
 * previsão de retorno. Serve a rota `/manutencao` e o modo global do app (`App` a
 * renderiza no lugar do conteúdo quando a API sinaliza manutenção).
 *
 * "Verificar novamente" desabilita o botão ("Verificando…"), pergunta ao serviço de
 * manutenção e, se voltou, sai da tela — para o painel quando está na rota própria, ou de
 * volta ao que o usuário estava fazendo quando é o modo global. Também tenta sozinha, com
 * backoff, para não depender de ele clicar.
 */
@Component({
  selector: 'app-system-maintenance-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <main
      class="relative min-h-dvh bg-gray-50 flex flex-col items-center px-4 pt-6 pb-8 overflow-hidden"
    >
      <section
        class="flex-1 w-full max-w-[1040px] flex flex-col items-center justify-center gap-6 text-center py-4"
      >
        <picture class="block w-full max-w-[820px]">
          <source type="image/webp" srcset="png/manutencao-ilustracao.webp" />
          <img
            src="png/manutencao-ilustracao.png"
            width="1672"
            height="941"
            loading="eager"
            class="block w-full h-auto"
            alt="Ilustração: peças da marca em manutenção, com cones, escada e caixa de ferramentas"
          />
        </picture>

        <div class="flex flex-col items-center gap-2">
          <h1
            class="font-bold tracking-tight leading-tight text-neutral-900 text-[clamp(24px,5vw,36px)]"
          >
            Estamos em manutenção.
          </h1>
          <p class="text-base text-neutral-600 max-w-[42ch] leading-relaxed">
            Estamos atualizando o MyCarsHub para deixá-lo melhor. Seus dados estão seguros e tudo
            volta ao normal em breve.
          </p>
        </div>

        <div class="w-full max-w-[360px] flex flex-col gap-2 pt-2">
          <button
            type="button"
            data-check
            [disabled]="checking()"
            (click)="check()"
            class="w-full min-h-[44px] rounded-xl px-5 text-sm font-semibold text-white bg-primary-500
                   hover:bg-primary-600 shadow-sm disabled:opacity-60 disabled:cursor-not-allowed
                   focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400
                   focus-visible:ring-offset-2"
          >
            {{ checking() ? 'Verificando…' : 'Verificar novamente' }}
          </button>
          <p
            role="status"
            aria-live="polite"
            data-status
            class="text-sm text-neutral-600 min-h-5"
          >
            {{ message() }}
          </p>
        </div>
      </section>

      @if (supportUrl) {
        <p class="relative text-sm text-neutral-600 text-center">
          Urgente?
          <a
            [href]="supportUrl"
            target="_blank"
            rel="noopener noreferrer"
            class="font-medium text-primary-700 hover:text-primary-500 underline-offset-2 hover:underline
                   focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 rounded"
            >Fale com o suporte</a
          >
        </p>
      }
    </main>
  `,
})
export class SystemMaintenancePage implements OnInit {
  private readonly maintenance = inject(PlatformMaintenanceService);
  private readonly router = inject(Router);
  private readonly title = inject(Title);
  private readonly meta = inject(Meta);
  private readonly destroyRef = inject(DestroyRef);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  protected readonly checking = signal(false);
  protected readonly message = signal('');

  protected readonly supportUrl = environment.supportWhatsapp
    ? `https://wa.me/${environment.supportWhatsapp}`
    : '';

  private timer: ReturnType<typeof setTimeout> | null = null;
  private nextDelay = MAINTENANCE_RETRY_MS;
  private previousTitle = '';

  ngOnInit(): void {
    this.previousTitle = this.title.getTitle();
    this.title.setTitle('Em manutenção · MyCarsHub');
    this.meta.updateTag({ name: 'robots', content: 'noindex' });

    this.destroyRef.onDestroy(() => {
      this.clearTimer();
      this.title.setTitle(this.previousTitle);
    });

    if (this.isBrowser) this.scheduleRetry();
  }

  protected check(): void {
    if (this.checking()) return;
    this.runCheck(true);
  }

  private runCheck(manual: boolean): void {
    this.clearTimer();
    this.checking.set(true);
    if (manual) this.message.set('');

    this.maintenance.isBackUp().subscribe((up) => {
      this.checking.set(false);
      if (up) {
        this.leave();
        return;
      }
      this.message.set(MAINTENANCE_STILL_DOWN);
      this.nextDelay = Math.min(this.nextDelay * 2, MAINTENANCE_RETRY_MAX_MS);
      this.scheduleRetry();
    });
  }

  private leave(): void {
    this.clearTimer();
    this.maintenance.leave();
    // Na rota própria não há para onde "voltar": segue para o painel (o guard cuida do login).
    if (this.router.url.startsWith('/manutencao')) {
      void this.router.navigateByUrl('/dashboard');
    }
  }

  private scheduleRetry(): void {
    this.clearTimer();
    this.timer = setTimeout(() => this.runCheck(false), this.nextDelay);
  }

  private clearTimer(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}
