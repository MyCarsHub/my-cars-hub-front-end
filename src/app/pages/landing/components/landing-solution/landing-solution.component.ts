import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  inject,
} from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';

interface Pillar {
  titleBefore: string;
  emphasis: string;
  titleAfter: string;
  body: string;
  iconHtml: SafeHtml;
  viz: 'progress' | 'kpis' | 'alert';
  mid?: boolean;
}

@Component({
  selector: 'app-landing-solution',
  templateUrl: './landing-solution.component.html',
  styleUrls: ['./landing-solution.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
})
export class LandingSolutionComponent implements AfterViewInit {
  private readonly host = inject(ElementRef<HTMLElement>);
  private readonly sanitizer = inject(DomSanitizer);

  readonly pillars: Pillar[] = [
    {
      titleBefore: 'Fecha o mês em',
      emphasis: 'minutos',
      titleAfter: ', não em madrugadas.',
      body: 'Conciliação automática entre cobranças, contratos e devoluções. Dashboards prontos, sem export/import.',
      iconHtml: this.sanitizer.bypassSecurityTrustHtml(
        '<svg viewBox="0 0 24 24" fill="none" class="w-[22px] h-[22px]"><path d="M3 12h4l3-7 4 14 3-7h4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
      ),
      viz: 'progress',
    },
    {
      titleBefore: 'Decide com',
      emphasis: 'dados',
      titleAfter: ', não com chutes.',
      body: 'Receita, ocupação e inadimplência num painel só — em tempo real, por veículo e por motorista.',
      iconHtml: this.sanitizer.bypassSecurityTrustHtml(
        '<svg viewBox="0 0 24 24" fill="none" class="w-[22px] h-[22px]"><path d="M3 17l5-5 4 4 7-7M15 9h6V3" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
      ),
      viz: 'kpis',
      mid: true,
    },
    {
      titleBefore: 'Frota',
      emphasis: 'não para',
      titleAfter: ' sem você saber.',
      body: 'Manutenções agendadas com alerta antecipado. Vistoria digital antes e depois da locação.',
      iconHtml: this.sanitizer.bypassSecurityTrustHtml(
        '<svg viewBox="0 0 24 24" fill="none" class="w-[22px] h-[22px]"><path d="M12 3a6 6 0 0 0-6 6c0 4-2 5-2 7h16c0-2-2-3-2-7a6 6 0 0 0-6-6Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M10 19a2 2 0 0 0 4 0" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
      ),
      viz: 'alert',
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
      { threshold: 0.2 },
    );
    this.host.nativeElement.querySelectorAll('.reveal').forEach((el: Element) => obs.observe(el));
  }
}
