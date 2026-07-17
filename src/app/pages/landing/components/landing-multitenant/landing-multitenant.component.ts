import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  inject,
} from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';

interface Company {
  role: string;
  name: string;
  description: string;
  roleIcon: SafeHtml;
  roleClass: string;
}

@Component({
  selector: 'app-landing-multitenant',
  templateUrl: './landing-multitenant.component.html',
  styleUrls: ['./landing-multitenant.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
})
export class LandingMultitenantComponent implements AfterViewInit {
  private readonly host = inject(ElementRef<HTMLElement>);
  private readonly sanitizer = inject(DomSanitizer);

  readonly companies: Company[] = [
    {
      role: 'Proprietário',
      name: 'RodaCar Locadora',
      description: 'Controle total: frota, contratos e financeiro',
      roleClass: 'bg-brand-tint text-brand-strong border-[rgba(235,63,0,0.16)]',
      roleIcon: this.sanitizer.bypassSecurityTrustHtml(
        '<svg viewBox="0 0 24 24" width="14" height="14" fill="none"><path d="M3 21V10l9-6 9 6v11" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M9 21v-7h6v7" stroke="currentColor" stroke-width="1.8"/></svg>',
      ),
    },
    {
      role: 'Gestor',
      name: 'VelozLoc Frotas',
      description: 'Operações sem acesso financeiro completo',
      roleClass: 'bg-paper-alt text-ink border-rule-strong',
      roleIcon: this.sanitizer.bypassSecurityTrustHtml(
        '<svg viewBox="0 0 24 24" width="14" height="14" fill="none"><circle cx="12" cy="8" r="4" stroke="currentColor" stroke-width="1.8"/><path d="M4 21c1-4 4-6 8-6s7 2 8 6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
      ),
    },
    {
      role: 'Motorista',
      name: 'CityFrota',
      description: 'Seus contratos, multas e histórico',
      roleClass: 'bg-paper-2 text-muted border-rule',
      roleIcon: this.sanitizer.bypassSecurityTrustHtml(
        '<svg viewBox="0 0 24 24" width="14" height="14" fill="none"><path d="M5 17l1.5-5A2 2 0 0 1 8.4 11h7.2a2 2 0 0 1 1.9 1.5L19 17v3h-2v-1.5H7V20H5v-3z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><circle cx="8" cy="18" r="1.2" fill="currentColor"/><circle cx="16" cy="18" r="1.2" fill="currentColor"/></svg>',
      ),
    },
  ];

  ngAfterViewInit(): void {
    const obs = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            e.target.classList.add('revealed');
            obs.unobserve(e.target);
          }
        }
      },
      { threshold: 0.15 },
    );
    this.host.nativeElement.querySelectorAll('.reveal').forEach((el: Element) => obs.observe(el));
  }
}
