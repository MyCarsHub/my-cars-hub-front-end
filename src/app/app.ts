import { NgComponentOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  InjectionToken,
  Type,
  effect,
  inject,
  signal,
} from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { ToastHost } from './components/toast-host/toast-host';
import { ImpersonationBanner } from './components/impersonation-banner/impersonation-banner';
import { ImpersonationService } from './services/impersonation.service';
import { ServiceWorkerUpdateService } from './services/service-worker-update.service';
import { ConsentBanner } from './components/core/consent-banner/consent-banner';
import { PlatformMaintenanceService } from './services/platform-maintenance.service';
import { SystemMaintenancePage } from './pages/system-maintenance/system-maintenance-page';

/**
 * Carregador do banner vermelho do modo edição. Token só para a spec poder
 * simular a falha do chunk; o padrão é o `import()` dinâmico.
 */
export const EDIT_BANNER_LOADER = new InjectionToken<() => Promise<Type<unknown>>>(
  'EDIT_BANNER_LOADER',
  {
    providedIn: 'root',
    factory: () => () =>
      import('./components/support-edit-banner/support-edit-banner').then(
        (m) => m.SupportEditBanner,
      ),
  },
);

const EDIT_BANNER_ATTEMPTS = 3;
const EDIT_BANNER_RETRY_MS = 1_000;

@Component({
  selector: 'app-root',
  // O banner de impersonação mora aqui, e não dentro do `app-shell`, porque o
  // requisito é "visível em TODA tela" — inclusive nas que ficam fora da árvore
  // autenticada. Ele se esconde sozinho quando não há sessão.
  imports: [
    RouterOutlet,
    ToastHost,
    ImpersonationBanner,
    NgComponentOutlet,
    ConsentBanner,
    SystemMaintenancePage,
  ],
  templateUrl: './app.html',
  styleUrl: './app.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class App implements OnInit {
  private readonly swUpdates = inject(ServiceWorkerUpdateService);
  /** A API sinalizou manutenção: a página ocupa a tela, o conteúdo fica montado por baixo. */
  protected readonly maintenance = inject(PlatformMaintenanceService).active;
  /** Sessão de EDIÇÃO: a barra vermelha substitui a âmbar (nunca as duas). */
  private readonly impersonation = inject(ImpersonationService);
  private readonly loadEditBanner = inject(EDIT_BANNER_LOADER);
  private loadingEditBanner = false;
  protected readonly editMode = this.impersonation.editMode;
  protected readonly editCompany = this.impersonation.companyName;
  /**
   * A barra do modo edição só existe durante uma sessão de EDIÇÃO — rara —, então
   * o componente entra por `import()` dinâmico e não pesa no bundle inicial.
   */
  protected readonly editBanner = signal<Type<unknown> | null>(null);
  protected readonly title = signal('my-cars-hub-front-end');

  constructor() {
    effect(() => {
      if (!this.editMode() || this.editBanner()) return;
      if (this.loadingEditBanner) return;
      this.loadingEditBanner = true;
      void this.loadEditBannerWithRetry().finally(() => (this.loadingEditBanner = false));
    });
  }

  /**
   * Enquanto o chunk não chega (ou falha de vez), `app.html` mostra a barra
   * mínima de reserva: uma sessão de EDIÇÃO nunca fica sem indicador.
   */
  private async loadEditBannerWithRetry(): Promise<void> {
    for (let attempt = 1; attempt <= EDIT_BANNER_ATTEMPTS; attempt++) {
      try {
        this.editBanner.set(await this.loadEditBanner());
        return;
      } catch {
        if (attempt === EDIT_BANNER_ATTEMPTS) return;
        await new Promise((resolve) => setTimeout(resolve, EDIT_BANNER_RETRY_MS * attempt));
      }
    }
  }

  protected endEdit(): void {
    this.impersonation.end().subscribe({ error: () => undefined });
  }

  ngOnInit(): void {
    this.swUpdates.init();
  }
}
