import { isPlatformBrowser } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  OnInit,
  PLATFORM_ID,
  computed,
  inject,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { environment } from '../../../environments/environment';
import { PublicStatus, StatusComponent, StatusDay } from '../../types/status.types';
import {
  COMPONENT_LABEL,
  dayLabel,
  incidentView,
  levelLabel,
  summaryOf,
  uptimeOf,
} from './status.copy';
import { StatusService } from './status.service';

/** A página só atualiza sozinha 1x por minuto — o servidor já guarda a resposta por 60 s. */
export const STATUS_REFRESH_MS = 60_000;

/**
 * Página pública «MyCarsHub Status» (`/status`). Sempre clara (rota pública, ver
 * `theme-scope.ts`), mobile-first, sem jargão. Se a API não responde, NÃO afirma que está
 * tudo bem: mostra «Não conseguimos verificar agora».
 */
@Component({
  selector: 'app-status-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  imports: [RouterLink],
  template: `
    <main class="min-h-dvh bg-canvas text-fg">
      <header class="bg-surface border-b border-border">
        <div class="mx-auto w-full max-w-3xl px-4 py-4 flex items-center justify-between gap-3">
          <a routerLink="/" class="flex items-center gap-2 min-h-[44px]" aria-label="MyCarsHub, voltar ao início">
            <img src="svg/logo-my-cars-hub-complete.svg" alt="MyCarsHub" class="h-7 w-auto" />
          </a>
          <a
            routerLink="/"
            class="text-sm font-semibold text-primary-700 min-h-[44px] inline-flex items-center
                   focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 rounded"
            >Voltar ao site</a
          >
        </div>
      </header>

      <div class="mx-auto w-full max-w-3xl px-4 py-6 flex flex-col gap-6">
        <div>
          <h1 class="text-2xl font-bold tracking-tight text-fg-strong">MyCarsHub Status</h1>
          <p class="text-sm text-fg-muted mt-1">
            Veja se está tudo funcionando, em palavras simples.
          </p>
        </div>

        <section
          data-summary
          [attr.data-tone]="summary().tone"
          aria-live="polite"
          class="rounded-2xl border-2 p-5 flex flex-col gap-2"
          [class.bg-success-50]="summary().tone === 'ok'"
          [class.border-success-500]="summary().tone === 'ok'"
          [class.bg-amber-50]="summary().tone === 'slow'"
          [class.border-amber-500]="summary().tone === 'slow'"
          [class.bg-red-50]="summary().tone === 'down'"
          [class.border-red-500]="summary().tone === 'down'"
          [class.bg-surface-muted]="summary().tone === 'unknown'"
          [class.border-border]="summary().tone === 'unknown'"
        >
          <p class="text-xl sm:text-2xl font-bold text-fg-strong leading-tight" data-summary-title>
            {{ summary().title }}
          </p>
          <p class="text-base text-fg-body leading-relaxed">{{ summary().body }}</p>
          @if (loading() && !status() && !failed()) {
            <p class="text-sm text-fg-muted">Carregando…</p>
          }
          @if (failed()) {
            <button
              type="button"
              data-retry
              (click)="load()"
              class="mt-2 self-start min-h-[44px] rounded-xl px-5 text-sm font-semibold text-white
                     bg-primary-700 hover:bg-primary-800 focus:outline-none focus-visible:ring-2
                     focus-visible:ring-primary-400 focus-visible:ring-offset-2"
            >
              Tentar de novo
            </button>
          }
        </section>

        @if (status(); as s) {
          <section aria-labelledby="componentes" class="flex flex-col gap-3">
            <div class="flex items-end justify-between gap-3">
              <h2 id="componentes" class="text-lg font-bold text-fg-strong">Como está cada parte</h2>
              <div role="group" aria-label="Período do histórico" class="inline-flex rounded-xl border border-border bg-surface p-1">
                <button
                  type="button"
                  data-range="30"
                  [attr.aria-pressed]="range() === 30"
                  (click)="range.set(30)"
                  class="min-h-[40px] px-3 rounded-lg text-sm font-semibold focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400"
                  [class.bg-primary-700]="range() === 30"
                  [class.text-white]="range() === 30"
                  [class.text-fg-body]="range() !== 30"
                >
                  30 dias
                </button>
                <button
                  type="button"
                  data-range="90"
                  [attr.aria-pressed]="range() === 90"
                  (click)="range.set(90)"
                  class="min-h-[40px] px-3 rounded-lg text-sm font-semibold focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400"
                  [class.bg-primary-700]="range() === 90"
                  [class.text-white]="range() === 90"
                  [class.text-fg-body]="range() !== 90"
                >
                  90 dias
                </button>
              </div>
            </div>

            <ul class="flex flex-col gap-3">
              @for (c of s.components; track c.key) {
                <li data-component [attr.data-key]="c.key" class="rounded-2xl bg-surface border border-border p-4 flex flex-col gap-3">
                  <div class="flex items-center justify-between gap-3">
                    <p data-name class="font-semibold text-fg-strong">{{ label(c.key) }}</p>
                    <p
                      class="text-sm font-semibold inline-flex items-center gap-2"
                      [class.text-success-800]="c.status === 'OPERATIONAL'"
                      [class.text-amber-800]="c.status === 'SLOW'"
                      [class.text-red-700]="c.status === 'DOWN'"
                      [class.text-fg-muted]="c.status === 'UNKNOWN'"
                    >
                      <span
                        aria-hidden="true"
                        class="inline-block size-2.5 rounded-full"
                        [class.bg-success-500]="c.status === 'OPERATIONAL'"
                        [class.bg-amber-500]="c.status === 'SLOW'"
                        [class.bg-red-500]="c.status === 'DOWN'"
                        [class.bg-neutral-400]="c.status === 'UNKNOWN'"
                      ></span>
                      {{ levelText(c.status) }}
                    </p>
                  </div>

                  <ul class="flex gap-[2px] h-9" [attr.aria-label]="'Histórico de ' + label(c.key)">
                    @for (d of visibleDays(c); track d.date) {
                      <li class="flex-1 min-w-0">
                        <button
                          type="button"
                          data-day
                          [attr.aria-label]="dayText(d)"
                          [title]="dayText(d)"
                          (click)="selectedDay.set(dayText(d))"
                          class="block w-full h-full rounded-[3px] focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400"
                          [class.bg-success-500]="d.status === 'OPERATIONAL'"
                          [class.bg-amber-500]="d.status === 'SLOW'"
                          [class.bg-red-500]="d.status === 'DOWN'"
                          [class.bg-neutral-200]="d.status === 'UNKNOWN'"
                        ></button>
                      </li>
                    }
                  </ul>
                  <div class="flex justify-between text-xs text-fg-muted">
                    <span>{{ range() }} dias atrás</span>
                    @if (uptime(c); as u) {
                      <span data-uptime>{{ u }} do tempo no ar</span>
                    }
                    <span>Hoje</span>
                  </div>
                </li>
              }
            </ul>

            <p class="text-sm text-fg-body min-h-[20px]" data-selected-day aria-live="polite">
              {{ selectedDay() ?? 'Toque numa barrinha para ver o dia.' }}
            </p>

            <div class="flex flex-wrap gap-x-4 gap-y-1 text-xs text-fg-muted" aria-label="Legenda">
              <span class="inline-flex items-center gap-1"><span aria-hidden="true" class="size-2.5 rounded-sm bg-success-500"></span>Funcionou</span>
              <span class="inline-flex items-center gap-1"><span aria-hidden="true" class="size-2.5 rounded-sm bg-amber-500"></span>Lentidão</span>
              <span class="inline-flex items-center gap-1"><span aria-hidden="true" class="size-2.5 rounded-sm bg-red-500"></span>Queda</span>
              <span class="inline-flex items-center gap-1"><span aria-hidden="true" class="size-2.5 rounded-sm bg-neutral-200"></span>Sem registro</span>
            </div>
          </section>

          <section aria-labelledby="incidentes" class="flex flex-col gap-3">
            <h2 id="incidentes" class="text-lg font-bold text-fg-strong">O que aconteceu recentemente</h2>
            @if (incidents().length === 0) {
              <p data-no-incidents class="rounded-2xl bg-surface border border-border p-4 text-fg-body">
                Nenhum problema nos últimos 90 dias.
              </p>
            } @else {
              <ul class="flex flex-col gap-3">
                @for (i of incidents(); track i.startedAt + i.title) {
                  <li data-incident class="rounded-2xl bg-surface border border-border p-4 flex flex-col gap-1">
                    <p class="font-semibold text-fg-strong">{{ i.title }}</p>
                    <p class="text-sm text-fg-body">{{ i.detail }}</p>
                  </li>
                }
              </ul>
            }
          </section>
        }

        <footer class="text-sm text-fg-muted flex flex-col gap-1 pb-6">
          @if (updatedAt()) {
            <p data-updated>Atualizado às {{ updatedAt() }}. A página se atualiza sozinha a cada minuto.</p>
          }
          <p>
            Algo não funciona e esta página diz que está tudo bem?
            @if (whatsappUrl) {
              <a [href]="whatsappUrl" class="font-semibold text-primary-700 underline" rel="noopener" target="_blank"
                >Fale com o suporte</a
              >.
            }
          </p>
        </footer>
      </div>
    </main>
  `,
})
export class StatusPage implements OnInit {
  private readonly service = inject(StatusService);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly status = signal<PublicStatus | null>(null);
  protected readonly loading = signal(true);
  protected readonly failed = signal(false);
  protected readonly range = signal<30 | 90>(30);
  protected readonly selectedDay = signal<string | null>(null);
  protected readonly updatedAt = signal<string | null>(null);

  protected readonly whatsappUrl = environment.supportWhatsapp
    ? `https://wa.me/${environment.supportWhatsapp}`
    : null;

  protected readonly summary = computed(() => summaryOf(this.status()));
  protected readonly incidents = computed(() =>
    (this.status()?.incidents ?? []).map((i) => incidentView(i)).slice(0, 15),
  );

  ngOnInit(): void {
    this.load();
    if (isPlatformBrowser(this.platformId)) {
      const timer = setInterval(() => this.load(), STATUS_REFRESH_MS);
      this.destroyRef.onDestroy(() => clearInterval(timer));
    }
  }

  load(): void {
    this.service.get().subscribe({
      next: (s) => {
        this.status.set(s);
        this.failed.set(false);
        this.loading.set(false);
        this.updatedAt.set(
          new Intl.DateTimeFormat('pt-BR', {
            timeZone: 'America/Sao_Paulo',
            hour: '2-digit',
            minute: '2-digit',
            hour12: false,
          }).format(new Date(s.generatedAt)),
        );
      },
      error: () => {
        // Nunca deixa a última resposta boa «morrer» como se fosse atual.
        this.status.set(null);
        this.failed.set(true);
        this.loading.set(false);
        this.updatedAt.set(null);
      },
    });
  }

  protected label(key: StatusComponent['key']): string {
    return COMPONENT_LABEL[key];
  }

  protected levelText(level: StatusComponent['status']): string {
    return levelLabel(level);
  }

  protected visibleDays(c: StatusComponent): StatusDay[] {
    return c.days.slice(-this.range());
  }

  protected dayText(d: StatusDay): string {
    return dayLabel(d);
  }

  protected uptime(c: StatusComponent): string | null {
    return uptimeOf(c, this.range());
  }
}
