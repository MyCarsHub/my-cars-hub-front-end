import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { DefaultPageLayout } from '../../components/layout/default-page-layout/default-page-layout';
import { PageCard } from '../../components/core/page-card/page-card';
import { AdminMetricsService } from '../../services/admin-metrics.service';
import { DailyCount } from '../../types/admin-overview.types';

interface AdminSection {
  route: string | null;
  title: string;
  description: string;
  icon: string;
  disabled?: boolean;
  badge?: string;
}

const SECTIONS: AdminSection[] = [
  {
    route: '/admin/feedback',
    title: 'Moderação de Feedback',
    description: 'Triagem do roadmap: mover, rejeitar com nota, remover.',
    icon: 'M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2M9 5a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2M9 5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2m-6 9 2 2 4-4',
  },
  {
    route: null,
    title: 'Usuários',
    description: 'Listar, buscar e auditar contas. Em breve.',
    icon: 'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2 M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
    disabled: true,
    badge: 'Em breve',
  },
  {
    route: null,
    title: 'Empresas',
    description: 'Visão geral das empresas cadastradas.',
    icon: 'M3 21h18 M5 21V7l8-4v18 M19 21V11l-6-4',
    disabled: true,
    badge: 'Em breve',
  },
];

interface StatusBar {
  key: string;
  label: string;
  count: number;
  color: string;
  percent: number;
}

const SUB_STATUS_ORDER: Array<{ key: string; label: string; color: string }> = [
  { key: 'ACTIVE', label: 'Ativa', color: '#10b981' },
  { key: 'TRIALING', label: 'Trial', color: '#3b82f6' },
  { key: 'PAST_DUE', label: 'Atrasada', color: '#f59e0b' },
  { key: 'CANCELED', label: 'Cancelada', color: '#6b7280' },
  { key: 'EXPIRED', label: 'Expirada', color: '#ef4444' },
];

const FB_STATUS_ORDER: Array<{ key: string; label: string; color: string }> = [
  { key: 'BACKLOG', label: 'Backlog', color: '#9ca3af' },
  { key: 'PLANNED', label: 'Planejado', color: '#3b82f6' },
  { key: 'IN_PROGRESS', label: 'Em Desenvolvimento', color: '#f59e0b' },
  { key: 'DONE', label: 'Concluído', color: '#10b981' },
  { key: 'REJECTED', label: 'Rejeitado', color: '#ef4444' },
];

interface SparkPoint {
  x: number;
  y: number;
  raw: DailyCount;
}

interface Spark {
  path: string;
  area: string;
  points: SparkPoint[];
  max: number;
  width: number;
  height: number;
}

@Component({
  selector: 'app-admin-home',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DefaultPageLayout, PageCard, RouterLink],
  templateUrl: './admin-home.html',
})
export class AdminHome implements OnInit {
  private readonly metricsService = inject(AdminMetricsService);

  protected readonly sections = SECTIONS;
  protected readonly overview = this.metricsService.overview;
  protected readonly loading = this.metricsService.loading;
  protected readonly error = this.metricsService.error;

  protected readonly mrr = computed(() => {
    const cents = this.overview()?.subscriptions.mrrCents ?? 0;
    return cents / 100;
  });

  protected readonly subscriptionBars = computed<StatusBar[]>(() => {
    const map = this.overview()?.subscriptions.byStatus ?? {};
    const total = Object.values(map).reduce((sum, n) => sum + n, 0);
    return SUB_STATUS_ORDER.map((s) => {
      const count = map[s.key] ?? 0;
      return {
        key: s.key,
        label: s.label,
        count,
        color: s.color,
        percent: total > 0 ? (count / total) * 100 : 0,
      };
    });
  });

  protected readonly feedbackBars = computed<StatusBar[]>(() => {
    const map = this.overview()?.feedback.byStatus ?? {};
    const total = Object.values(map).reduce((sum, n) => sum + n, 0);
    return FB_STATUS_ORDER.map((s) => {
      const count = map[s.key] ?? 0;
      return {
        key: s.key,
        label: s.label,
        count,
        color: s.color,
        percent: total > 0 ? (count / total) * 100 : 0,
      };
    });
  });

  protected readonly usersSpark = computed<Spark | null>(() => {
    const days = this.overview()?.users.newByDay;
    if (!days || days.length === 0) return null;
    const width = 600;
    const height = 120;
    const padX = 4;
    const padY = 6;
    const max = Math.max(1, ...days.map((d) => d.count));
    const step = (width - padX * 2) / Math.max(1, days.length - 1);
    const points: SparkPoint[] = days.map((d, i) => ({
      raw: d,
      x: padX + i * step,
      y: padY + (height - padY * 2) * (1 - d.count / max),
    }));
    const path = points
      .map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`)
      .join(' ');
    const first = points[0];
    const last = points[points.length - 1];
    const area = `${path} L${last.x.toFixed(1)},${(height - padY).toFixed(1)} L${first.x.toFixed(1)},${(height - padY).toFixed(1)} Z`;
    return { path, area, points, max, width, height };
  });

  ngOnInit(): void {
    this.metricsService.loadOverview().subscribe({ error: () => {} });
  }

  protected reload(): void {
    this.metricsService.loadOverview().subscribe({ error: () => {} });
  }

  protected formatCurrency(value: number): string {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL',
    }).format(value);
  }

  protected formatDayLabel(date: string): string {
    const d = new Date(date + 'T00:00:00');
    return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
  }
}
