import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { DefaultPageLayout } from '../../components/layout/default-page-layout/default-page-layout';
import { PageCard } from '../../components/core/page-card/page-card';
import { AdminMetricsService } from '../../services/admin-metrics.service';
import { DailyCount } from '../../types/admin-overview.types';
import { AdminEmailTestDialog } from './components/admin-email-test-dialog';
import { AdminOpsToolsDialog } from './components/admin-ops-tools-dialog';
import { ApiErrorService } from '../../services/api-error.service';

type AdminSectionAction = 'openEmailTest' | 'openOpsTools';

interface AdminSection {
  route: string | null;
  action?: AdminSectionAction;
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
    route: '/admin/users',
    title: 'Usuários',
    description: 'Listar, buscar, ativar/desativar e ajustar papéis.',
    icon: 'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2 M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
  },
  {
    route: '/admin/companies',
    title: 'Empresas',
    description: 'Listar tenants, inspecionar assinatura e suspender.',
    icon: 'M3 21h18 M5 21V7l8-4v18 M19 21V11l-6-4',
  },
  {
    route: '/admin/blog',
    title: 'Blog',
    description: 'Publicar, editar e despublicar posts do blog público.',
    icon: 'M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20',
  },
  {
    route: '/admin/suporte',
    title: 'Suporte',
    description: 'Triagem de tickets: em atendimento, resolver, reabrir.',
    icon: 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z',
  },
  {
    route: '/admin/auditoria',
    title: 'Auditoria',
    description: 'Trilha de todas as ações administrativas: quem fez, o que e quando.',
    icon: 'M9 11l3 3 8-8 M20 12v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h9',
  },
  {
    route: '/admin/billing',
    title: 'Billing',
    description: 'Assinaturas, problemas de cobrança em aberto e MRR por plano.',
    icon: 'M2 10h20 M4 6h16a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2z M7 15h2',
  },
  {
    route: null,
    action: 'openEmailTest',
    title: 'Testar templates',
    description: 'Envia todos os 13 templates para um email de validação.',
    icon: 'M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z M22 6 12 13 2 6',
  },
  {
    route: null,
    action: 'openOpsTools',
    title: 'Ferramentas',
    description: 'Ações operacionais de suporte, como regenerar o cronograma de um aluguel.',
    icon: 'M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z',
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

const RENTAL_STATUS_ORDER: Array<{ key: string; label: string; color: string }> = [
  { key: 'RESERVED', label: 'Reservado', color: '#3b82f6' },
  { key: 'ACTIVE', label: 'Em andamento', color: '#10b981' },
  { key: 'COMPLETED', label: 'Concluído', color: '#6366f1' },
  { key: 'CANCELED', label: 'Cancelado', color: '#6b7280' },
];

const FB_STATUS_ORDER: Array<{ key: string; label: string; color: string }> = [
  { key: 'BACKLOG', label: 'Backlog', color: '#9ca3af' },
  { key: 'PLANNED', label: 'Planejado', color: '#3b82f6' },
  { key: 'IN_PROGRESS', label: 'Em Desenvolvimento', color: '#f59e0b' },
  { key: 'DONE', label: 'Concluído', color: '#10b981' },
  { key: 'REJECTED', label: 'Rejeitado', color: '#ef4444' },
];

/** Contagem + valor em REAIS (o backend entrega centavos; a conversão é aqui). */
interface VolumeStat {
  count: number;
  amount: number;
}

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
  imports: [DefaultPageLayout, PageCard, RouterLink, AdminEmailTestDialog, AdminOpsToolsDialog],
  templateUrl: './admin-home.html',
})
export class AdminHome implements OnInit {
  private readonly metricsService = inject(AdminMetricsService);
  private readonly apiErrors = inject(ApiErrorService);

  protected readonly sections = SECTIONS;
  protected readonly emailTestOpen = signal(false);
  protected readonly opsToolsOpen = signal(false);
  protected readonly overview = this.metricsService.overview;
  protected readonly loading = this.metricsService.loading;
  protected readonly error = this.metricsService.error;

  /** Toggle: 'active' mostra apenas entidades ativas (padrão); 'all' inclui inativas/canceladas. */
  protected readonly scope = signal<'active' | 'all'>('active');

  protected setScope(next: 'active' | 'all'): void {
    this.scope.set(next);
  }

  protected readonly usersDisplay = computed(() => {
    const u = this.overview()?.users;
    if (!u) return 0;
    return this.scope() === 'active' ? u.activeTotal : u.total;
  });

  protected readonly companiesDisplay = computed(() => {
    const c = this.overview()?.companies;
    if (!c) return 0;
    return this.scope() === 'active' ? c.activeTotal : c.total;
  });

  protected readonly vehiclesDisplay = computed(() => {
    const v = this.overview()?.vehicles;
    if (!v) return 0;
    return this.scope() === 'active' ? v.activeTotal : v.total;
  });

  protected readonly mrr = computed(() => {
    const subs = this.overview()?.subscriptions;
    if (!subs) return 0;
    const cents = this.scope() === 'active'
      ? subs.mrrActiveOnlyCents
      : subs.mrrCents;
    return cents / 100;
  });

  protected readonly mrrSubtitle = computed(() =>
    this.scope() === 'active' ? 'Apenas ativas' : 'Ativas + trial',
  );

  protected readonly mrrActiveOnly = computed(() => {
    const subs = this.overview()?.subscriptions;
    if (!subs) return 0;
    return subs.mrrActiveOnlyCents / 100;
  });

  protected readonly arr = computed(() => {
    const subs = this.overview()?.subscriptions;
    if (!subs) return 0;
    return subs.arrCents / 100;
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

  /**
   * Aluguel FECHADO = status diferente de CANCELED. É negócio efetivado
   * (reservado, em andamento ou concluído), NÃO "concluído".
   */
  protected readonly closedRentals = computed<VolumeStat>(() => {
    const r = this.overview()?.rentals;
    return { count: r?.closedTotal ?? 0, amount: (r?.closedAmountCents ?? 0) / 100 };
  });

  /** Recorte conservador: apenas aluguéis COMPLETED. */
  protected readonly completedRentals = computed<VolumeStat>(() => {
    const r = this.overview()?.rentals;
    return { count: r?.completedTotal ?? 0, amount: (r?.completedAmountCents ?? 0) / 100 };
  });

  protected readonly contractsTotal = computed(() => this.overview()?.contracts?.total ?? 0);

  /** SUBCONJUNTO de `contractsTotal` — nunca exibir como total de contratos. */
  protected readonly contractsSigned = computed(() => this.overview()?.contracts?.signedTotal ?? 0);

  /** `byStatus` é esparso: status sem registro some do mapa e vale zero. */
  protected readonly rentalBars = computed<StatusBar[]>(() => {
    const map = this.overview()?.rentals?.byStatus ?? {};
    const total = Object.values(map).reduce((sum, n) => sum + n, 0);
    return RENTAL_STATUS_ORDER.map((s) => {
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
    this.loadOverview();
  }

  protected reload(): void {
    this.loadOverview();
  }

  /**
   * The service already puts the message in the page banner; claiming the error
   * stops the interceptor safety net from repeating it as a toast.
   */
  private loadOverview(): void {
    this.metricsService
      .loadOverview()
      .subscribe({ error: (err: unknown) => this.apiErrors.claim(err) });
  }

  /**
   * Cards sem rota abrem um diálogo; a seção declara qual pela sua `action`.
   * O `default` atribui a ação a `never`: uma nova entrada em `AdminSectionAction`
   * sem `case` aqui quebra a COMPILAÇÃO em vez de renderizar um botão inerte.
   */
  protected openAction(section: AdminSection): void {
    switch (section.action) {
      case 'openEmailTest':
        this.emailTestOpen.set(true);
        return;
      case 'openOpsTools':
        this.opsToolsOpen.set(true);
        return;
      case undefined:
        return;
      default: {
        const unhandled: never = section.action;
        throw new Error(`Ação administrativa não tratada: ${String(unhandled)}`);
      }
    }
  }

  protected closeEmailTest(): void {
    this.emailTestOpen.set(false);
  }

  protected closeOpsTools(): void {
    this.opsToolsOpen.set(false);
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
