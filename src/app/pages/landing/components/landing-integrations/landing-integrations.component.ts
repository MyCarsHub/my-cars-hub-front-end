import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  inject,
  signal,
} from '@angular/core';

interface Brand {
  name: string;
  logoSrc: string;
  logoAlt: string;
  logoHeightPx: number;
}

interface BrandGroup {
  pill: string;
  caption: string;
  brands: Brand[];
}

@Component({
  selector: 'app-landing-integrations',
  templateUrl: './landing-integrations.component.html',
  styleUrls: ['./landing-integrations.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
})
export class LandingIntegrationsComponent implements AfterViewInit {
  private readonly host = inject(ElementRef<HTMLElement>);
  protected readonly revealed = signal(false);

  readonly groups: BrandGroup[] = [
    {
      pill: 'Pagamentos',
      caption: 'Gateways brasileiros — Pix, boleto, cartão.',
      brands: [
        { name: 'Asaas', logoSrc: 'logos/integrations/asaas.svg', logoAlt: 'Logo Asaas', logoHeightPx: 22 },
      ],
    },
  ];

  ngAfterViewInit(): void {
    if (typeof IntersectionObserver === 'undefined') {
      this.revealed.set(true);
      return;
    }
    const obs = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            e.target.classList.add('revealed');
            this.revealed.set(true);
            obs.unobserve(e.target);
          }
        }
      },
      { threshold: 0.15 },
    );
    this.host.nativeElement.querySelectorAll('.reveal').forEach((el: Element) => obs.observe(el));
  }
}
