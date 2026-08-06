import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { ToastHost } from './components/toast-host/toast-host';
import { ImpersonationBanner } from './components/impersonation-banner/impersonation-banner';
import { ServiceWorkerUpdateService } from './services/service-worker-update.service';

@Component({
  selector: 'app-root',
  // O banner de impersonação mora aqui, e não dentro do `app-shell`, porque o
  // requisito é "visível em TODA tela" — inclusive nas que ficam fora da árvore
  // autenticada. Ele se esconde sozinho quando não há sessão.
  imports: [RouterOutlet, ToastHost, ImpersonationBanner],
  templateUrl: './app.html',
  styleUrl: './app.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class App implements OnInit {
  private readonly swUpdates = inject(ServiceWorkerUpdateService);
  protected readonly title = signal('my-cars-hub-front-end');

  ngOnInit(): void {
    this.swUpdates.init();
  }
}
