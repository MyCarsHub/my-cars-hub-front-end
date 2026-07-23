import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { ToastHost } from './components/toast-host/toast-host';
import { ServiceWorkerUpdateService } from './services/service-worker-update.service';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, ToastHost],
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
