import { ChangeDetectionStrategy, Component, inject, OnDestroy, OnInit } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { animate, state, style, transition, trigger } from '@angular/animations';
import { Sidebar } from '../../sidebar/sidebar';
import { LayoutStore } from './layout.store';

@Component({
  selector: 'app-shell',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterOutlet, Sidebar],
  animations: [
    trigger('contentMargin', [
      state('expanded', style({ marginLeft: '260px' })),
      state('collapsed', style({ marginLeft: '72px' })),
      state('mobile', style({ marginLeft: '0' })),
      transition('expanded <=> collapsed', animate('300ms cubic-bezier(0.4, 0, 0.2, 1)')),
      transition('* => mobile', animate('0ms')),
      transition('mobile => *', animate('0ms')),
    ]),
  ],
  template: `
    <div class="flex h-screen overflow-hidden bg-gray-50">
      <app-sidebar />
      <main
        class="flex-1 overflow-y-auto transition-none"
        [@contentMargin]="contentState()"
      >
        <div>
          <router-outlet />
        </div>
      </main>
    </div>
  `,
  styles: `
    :host {
      display: block;
      height: 100%;
    }
  `,
})
export class AppShell implements OnInit, OnDestroy {
  protected readonly layout = inject(LayoutStore);

  private resizeListener: (() => void) | null = null;

  protected contentState(): string {
    if (this.layout.isMobile()) {
      return 'mobile';
    }
    return this.layout.isCollapsed() ? 'collapsed' : 'expanded';
  }

  ngOnInit(): void {
    this.checkBreakpoint();
    this.resizeListener = () => this.checkBreakpoint();
    window.addEventListener('resize', this.resizeListener);
  }

  ngOnDestroy(): void {
    if (this.resizeListener) {
      window.removeEventListener('resize', this.resizeListener);
    }
  }

  private checkBreakpoint(): void {
    this.layout.setMobile(window.innerWidth < 1024);
  }
}