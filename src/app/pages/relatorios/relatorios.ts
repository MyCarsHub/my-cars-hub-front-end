import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DefaultPageLayout } from '../../components/layout/default-page-layout/default-page-layout';
import { PageCard } from '../../components/core/page-card/page-card';
import { NotificationService } from '../../services/notification.service';
import { ReportsService } from '../../services/reports.service';
import {
  exportReportExcel,
  exportReportPdf,
  reportToMarkdown,
} from '../../utils/reports-export';
import { MonthlyPoint } from '../../types/reports.types';

function toIso(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

@Component({
  selector: 'app-relatorios',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DefaultPageLayout, PageCard, FormsModule],
  templateUrl: './relatorios.html',
})
export class Relatorios implements OnInit {
  private readonly reportsService = inject(ReportsService);
  private readonly notifications = inject(NotificationService);

  protected readonly report = this.reportsService.overview;
  protected readonly loading = this.reportsService.loading;
  protected readonly error = this.reportsService.error;

  protected readonly from = signal<string>('');
  protected readonly to = signal<string>('');
  protected readonly exporting = signal<'pdf' | 'excel' | 'md' | null>(null);
  protected readonly activePreset = signal<'thisMonth' | 'lastMonth' | 'last30' | 'thisYear' | 'custom'>('lastMonth');

  protected readonly formatBRL = (cents: number): string =>
    new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL',
      minimumFractionDigits: 2,
    }).format((cents ?? 0) / 100);

  protected readonly formatPct = (v: number): string =>
    `${(v * 100).toFixed(1).replace('.', ',')}%`;

  protected readonly fmtYearMonth = (ym: string): string => {
    const [y, m] = ym.split('-');
    const names = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
    return `${names[parseInt(m, 10) - 1]}/${y.slice(2)}`;
  };

  /** Escala 0-100 pra bar chart de receita mensal. */
  protected readonly monthlyMax = computed<number>(() => {
    const r = this.report();
    if (!r || r.financial.monthlyRevenue.length === 0) return 1;
    return Math.max(1, ...r.financial.monthlyRevenue.map((m) => m.revenueCents));
  });

  protected monthlyBarPct(cents: number): number {
    return (cents / this.monthlyMax()) * 100;
  }

  protected monthlyBarTitle(m: MonthlyPoint): string {
    const base = `${this.fmtYearMonth(m.yearMonth)}: ${this.formatBRL(m.revenueCents)}`;
    return m.isPartial ? `${base} (parcial — período não cobre o mês inteiro)` : base;
  }

  protected readonly hasPartialMonth = computed<boolean>(() => {
    const r = this.report();
    return !!r && r.financial.monthlyRevenue.some((m) => m.isPartial);
  });

  protected readonly netIsPositive = computed<boolean>(() => {
    const r = this.report();
    return !!r && r.financial.netProfitCents >= 0;
  });

  ngOnInit(): void {
    // Default: último mês
    const now = new Date();
    const first = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const last = new Date(now.getFullYear(), now.getMonth(), 0);
    this.from.set(toIso(first));
    this.to.set(toIso(last));
    this.load();
  }

  protected setPreset(preset: 'thisMonth' | 'lastMonth' | 'last30' | 'thisYear'): void {
    const now = new Date();
    let f: Date;
    let t: Date;
    switch (preset) {
      case 'thisMonth':
        f = new Date(now.getFullYear(), now.getMonth(), 1);
        t = now;
        break;
      case 'lastMonth':
        f = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        t = new Date(now.getFullYear(), now.getMonth(), 0);
        break;
      case 'last30':
        f = new Date(now);
        f.setDate(f.getDate() - 30);
        t = now;
        break;
      case 'thisYear':
        f = new Date(now.getFullYear(), 0, 1);
        t = now;
        break;
    }
    this.from.set(toIso(f));
    this.to.set(toIso(t));
    this.activePreset.set(preset);
    this.load();
  }

  protected load(): void {
    const f = this.from();
    const t = this.to();
    if (!f || !t) return;
    if (f > t) {
      this.notifications.warning('Data inicial não pode ser maior que a final.');
      return;
    }
    this.reportsService.loadOverview(f, t).subscribe({
      error: () => this.notifications.error('Falha ao carregar relatório.'),
    });
  }

  protected exportPdf(): void {
    const r = this.report();
    if (!r) return;
    this.exporting.set('pdf');
    try {
      exportReportPdf(r);
      this.notifications.success('PDF gerado.');
    } catch {
      this.notifications.error('Não foi possível gerar o PDF.');
    } finally {
      this.exporting.set(null);
    }
  }

  protected exportExcel(): void {
    const r = this.report();
    if (!r) return;
    this.exporting.set('excel');
    try {
      exportReportExcel(r);
      this.notifications.success('Excel gerado.');
    } catch {
      this.notifications.error('Não foi possível gerar o Excel.');
    } finally {
      this.exporting.set(null);
    }
  }

  protected async copyMarkdown(): Promise<void> {
    const r = this.report();
    if (!r) return;
    this.exporting.set('md');
    try {
      const md = reportToMarkdown(r);
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(md);
        this.notifications.success('Markdown copiado — cole em ChatGPT / Claude / Gemini.');
      } else {
        // Fallback: cria textarea temporária
        const ta = document.createElement('textarea');
        ta.value = md;
        ta.style.position = 'fixed';
        ta.style.left = '-9999px';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        this.notifications.success('Markdown copiado.');
      }
    } catch {
      this.notifications.error('Não foi possível copiar o Markdown.');
    } finally {
      this.exporting.set(null);
    }
  }
}
