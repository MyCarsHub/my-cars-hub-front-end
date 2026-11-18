import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';

import { Heatmap } from '../../../components/charts/heatmap/heatmap';
import { PageCard } from '../../../components/core/page-card/page-card';
import { StatusChip } from '../../../components/core/status-chip/status-chip';
import { formatKpiNumber } from '../../../components/kpi-card/kpi-card';
import type { AdminUsage, UsageRole } from '../../../types/admin-home.types';
import { HEAT_COLUMNS, ROLE_TONE, dayLabel, heatRows, roleLabel } from './admin-home.view';

/** Uma pessoa do ranking, já com o número em texto. */
export interface TopPerson {
  readonly userId: string;
  readonly name: string;
  readonly role: string | null;
  readonly companyName: string | null;
  readonly value: string;
}

/**
 * Pure: o ranking certo para a tela. Acessos (captura por hora) quando a captura já começou;
 * antes disso, ações registradas, e a tela diz que são ações, nunca "acessos".
 */
export function topPeople(usage: AdminUsage | null): { byAccess: boolean; people: TopPerson[] } {
  if (!usage) return { byAccess: false, people: [] };
  const byAccess = usage.meta.accessSince !== null && usage.topByAccess.length > 0;
  const people = byAccess
    ? usage.topByAccess.map((p) => ({
        userId: p.userId,
        name: p.name,
        role: p.role,
        companyName: p.companyName,
        value: p.accessHours === 1 ? '1 h com acesso' : `${p.accessHours} h com acesso`,
      }))
    : usage.topByActions.map((p) => ({
        userId: p.userId,
        name: p.name,
        role: p.role,
        companyName: p.companyName,
        value: p.actions === 1 ? '1 ação' : `${p.actions} ações`,
      }));
  return { byAccess, people };
}

interface RoleCard {
  readonly role: UsageRole;
  readonly title: string;
  readonly subtitle: string;
  readonly big: string;
  readonly caption: string;
  readonly ratio: number | null;
  readonly seenText: string;
  readonly minis: readonly { label: string; value: string }[];
  readonly top: readonly TopPerson[];
}

const num = (n: number | null | undefined, kind: 'integer' | 'decimal' = 'integer'): string =>
  n === null || n === undefined ? '—' : formatKpiNumber(kind, n, kind === 'decimal' ? 1 : null);

/**
 * "Quem usa a plataforma": Donos, Gerenciadores e Motoristas. Só dado que a plataforma já guarda
 * (decisão do dono): presença dos últimos 7 dias, tamanho, aluguéis e multas. Finanças do
 * motorista não entram.
 */
@Component({
  selector: 'app-home-roles',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [PageCard, RouterLink],
  host: { class: 'block min-w-0' },
  template: `
    <div class="grid gap-3 grid-cols-1 lg:grid-cols-3" data-home-roles>
      @for (card of cards(); track card.role) {
        <app-page-card [title]="card.title" [fill]="true">
          <div class="px-4 sm:px-6 pb-5 flex flex-col gap-3 min-w-0 flex-1" [attr.data-role-card]="card.role">
            <p class="-mt-3 text-xs text-fg-subtle">{{ card.subtitle }}</p>
            @if (loading() && !usage()) {
              <div class="h-24 rounded-xl bg-surface-sunken animate-pulse motion-reduce:animate-none"></div>
            } @else {
              <p class="flex items-baseline gap-2 min-w-0">
                <b class="text-3xl font-semibold tracking-tight text-fg tabular-nums">{{ card.big }}</b>
                <span class="text-xs text-fg-subtle">{{ card.caption }}</span>
              </p>
              <div class="flex flex-col gap-1">
                <p class="flex justify-between gap-2 text-xs text-fg-subtle">
                  <span>Acessaram nos últimos 7 dias</span>
                  <b class="text-fg tabular-nums">{{ card.seenText }}</b>
                </p>
                <div class="h-2 rounded-full bg-surface-sunken overflow-hidden" aria-hidden="true">
                  <div
                    class="h-full rounded-full bg-success-500 transition-[width] duration-500 motion-reduce:transition-none"
                    [style.width.%]="(card.ratio ?? 0) * 100"
                  ></div>
                </div>
              </div>
              <dl class="grid grid-cols-2 gap-1.5">
                @for (m of card.minis; track m.label) {
                  <div class="rounded-xl bg-surface-muted px-3 py-2 min-w-0 flex flex-col-reverse">
                    <dt class="text-[11px] text-fg-subtle truncate">{{ m.label }}</dt>
                    <dd class="m-0 text-base font-semibold text-fg tabular-nums">{{ m.value }}</dd>
                  </div>
                }
              </dl>
              <div class="flex flex-col gap-1.5">
                <span class="text-[11px] text-fg-subtle">{{ topTitle() }}</span>
                @for (p of card.top; track p.userId; let i = $index) {
                  <a
                    [routerLink]="['/admin/users', p.userId]"
                    class="press flex items-center gap-2 min-h-11 text-xs rounded-xl px-1 -mx-1 hover:bg-surface-muted
                           focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400"
                  >
                    <span class="size-6 shrink-0 grid place-items-center rounded-full bg-surface-sunken text-[10px] font-bold text-fg-body">{{ i + 1 }}</span>
                    <span class="flex-1 min-w-0 truncate text-fg">{{ p.name }}</span>
                    <b class="shrink-0 text-fg tabular-nums">{{ p.value }}</b>
                  </a>
                } @empty {
                  <p class="text-xs text-fg-subtle">{{ emptyTop() }}</p>
                }
              </div>
            }
          </div>
        </app-page-card>
      }
    </div>
  `,
})
export class HomeRoles {
  readonly usage = input<AdminUsage | null>(null);
  readonly loading = input(false);
  /** Empresas no escopo (o "donos em N empresas"). */
  readonly companies = input<number | null>(null);

  private readonly top = computed(() => topPeople(this.usage()));
  protected readonly topTitle = computed(() => (this.top().byAccess ? 'Quem mais acessa' : 'Mais ativos (ações)'));
  protected readonly emptyTop = computed(() => {
    // A lista vem dos acessos quando há captura; a frase diz o que foi medido.
    if (this.top().byAccess) return 'Ninguém deste papel acessou no período.';
    const since = dayLabel(this.usage()?.meta.actionsSince ?? null);
    return since ? 'Ninguém deste papel agiu no período.' : 'Ações registradas a partir da captura.';
  });

  protected readonly cards = computed<RoleCard[]>(() => {
    const u = this.usage();
    const role = (r: UsageRole) => u?.roles.find((x) => x.role === r) ?? null;
    const topOf = (r: UsageRole) => this.top().people.filter((p) => p.role === r).slice(0, 3);
    const seen = (r: UsageRole) => {
      const row = role(r);
      if (!row || row.seen7dRatio === null) return { ratio: null, text: '—' };
      return { ratio: row.seen7dRatio, text: formatKpiNumber('ratio', row.seen7dRatio) };
    };
    const owners = role('OWNER');
    const managers = role('MANAGER');
    const companies = this.companies();
    return [
      {
        role: 'OWNER',
        title: 'Donos',
        subtitle: 'Quem contrata a plataforma',
        big: num(owners?.people),
        caption: companies === null ? 'donos' : `donos em ${num(companies)} empresas`,
        ...this.seenOf(seen('OWNER')),
        minis: [
          { label: 'Veículos por dono', value: num(u?.owners.vehiclesPerOwner, 'decimal') },
          { label: 'Aluguéis ativos', value: num(u?.owners.activeRentals) },
        ],
        top: topOf('OWNER'),
      },
      {
        role: 'MANAGER',
        title: 'Gerenciadores',
        subtitle: 'Quem opera o dia a dia',
        big: num(managers?.people),
        caption: 'gerenciadores ativos',
        ...this.seenOf(seen('MANAGER')),
        minis: [
          { label: 'Por empresa', value: num(u?.managers.managersPerCompany, 'decimal') },
          { label: 'Multas registradas', value: num(u?.managers.finesRegistered) },
        ],
        top: topOf('MANAGER'),
      },
      {
        role: 'DRIVER',
        title: 'Motoristas',
        subtitle: 'Quem aluga os carros',
        big: num(u?.drivers.driverRecords),
        caption: 'motoristas cadastrados',
        ...this.seenOf(seen('DRIVER')),
        minis: [
          { label: 'Com acesso ao app', value: num(u?.drivers.withAppAccess) },
          { label: 'Aluguéis ativos', value: num(u?.drivers.activeRentals) },
        ],
        top: topOf('DRIVER'),
      },
    ];
  });

  private seenOf(s: { ratio: number | null; text: string }): { ratio: number | null; seenText: string } {
    return { ratio: s.ratio, seenText: s.text };
  }
}

/**
 * "Quando acessam": dia da semana x faixa de 2 horas, em São Paulo. Até a captura de acessos ter
 * dado, o mapa é de AÇÕES e o título diz isso ("Quando agem").
 */
@Component({
  selector: 'app-home-activity-map',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [PageCard, Heatmap],
  host: { class: 'block min-w-0' },
  template: `
    <app-page-card [title]="byAccess() ? 'Quando acessam' : 'Quando agem'" [fill]="true">
      <div class="px-4 sm:px-6 pb-5 flex flex-col gap-3 min-w-0 flex-1" data-home-activity>
        <p class="-mt-3 text-xs text-fg-subtle">{{ subtitle() }}</p>
        @if (loading() && !usage()) {
          <div class="h-40 rounded-xl bg-surface-sunken animate-pulse motion-reduce:animate-none"></div>
        } @else if (empty()) {
          <p data-empty class="text-sm text-fg-subtle text-center py-10">{{ emptyText() }}</p>
        } @else {
          <app-heatmap
            [rows]="rows()"
            [columns]="columns"
            [ticks]="ticks"
            [unit]="byAccess() ? 'pessoas' : 'ações'"
            [ariaLabel]="byAccess() ? 'Pessoas acessando por dia e faixa de horas' : 'Ações por dia e faixa de horas'"
          />
        }
      </div>
    </app-page-card>
  `,
})
export class HomeActivityMap {
  readonly usage = input<AdminUsage | null>(null);
  readonly loading = input(false);

  protected readonly columns = HEAT_COLUMNS;
  protected readonly ticks = [
    { index: 0, text: '0h' },
    { index: 3, text: '6h' },
    { index: 6, text: '12h' },
    { index: 9, text: '18h' },
    { index: 11, text: '22h' },
  ];

  protected readonly byAccess = computed(() => {
    const u = this.usage();
    return !!u && u.meta.accessSince !== null && u.accessHeatmap.length > 0;
  });
  private readonly cells = computed(() => {
    const u = this.usage();
    if (!u) return [];
    return this.byAccess() ? u.accessHeatmap : u.actionsHeatmap;
  });
  protected readonly rows = computed(() => heatRows(this.cells()));
  protected readonly empty = computed(() => this.cells().every((c) => !(c.count > 0)));

  protected readonly subtitle = computed(() => {
    const u = this.usage();
    if (this.byAccess()) {
      return `Pessoas acessando por dia da semana e faixa de horas. Registrando desde ${dayLabel(u?.meta.accessSince ?? null)}.`;
    }
    const since = dayLabel(u?.meta.actionsSince ?? null);
    return (
      'Ações por dia da semana e faixa de horas.' +
      (since ? ` Ações registradas desde ${since};` : '') +
      ' os acessos entram quando a captura tiver dado.'
    );
  });
  protected readonly emptyText = computed(() => {
    const since = dayLabel(this.usage()?.meta.actionsSince ?? null);
    return since ? `Nenhuma ação no período. Registrando desde ${since}.` : 'Nada registrado ainda.';
  });
}

/** "Quem mais acessa": top 5 com o papel em chip. A linha abre o usuário. */
@Component({
  selector: 'app-home-top-users',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [PageCard, StatusChip, RouterLink],
  host: { class: 'block min-w-0' },
  template: `
    <app-page-card [title]="byAccess() ? 'Quem mais acessa' : 'Quem mais age'" [fill]="true">
      <div class="px-4 sm:px-6 pb-5 flex flex-col gap-3 min-w-0 flex-1" data-home-top-users>
        <p class="-mt-3 text-xs text-fg-subtle">
          {{ byAccess() ? 'Horas com acesso no período' : 'Ações registradas no período (acessos contam desde a captura)' }}
        </p>
        @if (loading() && !usage()) {
          <div class="h-32 rounded-xl bg-surface-sunken animate-pulse motion-reduce:animate-none"></div>
        } @else {
          <ol class="flex flex-col gap-1.5">
            @for (p of people(); track p.userId) {
              <li>
                <a
                  [routerLink]="['/admin/users', p.userId]"
                  data-top-user
                  class="press flex items-center gap-2 min-h-11 rounded-xl bg-surface-muted px-3 py-1.5 min-w-0 hover:bg-surface-sunken
                         focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400"
                >
                  <app-status-chip size="sm" [tone]="tone">{{ label(p.role) }}</app-status-chip>
                  <span class="flex-1 min-w-0">
                    <b class="block text-sm font-semibold text-fg truncate">{{ p.name }}</b>
                    @if (p.companyName) {
                      <span class="block text-[11px] text-fg-subtle truncate">{{ p.companyName }}</span>
                    }
                  </span>
                  <span class="shrink-0 text-xs text-fg-muted tabular-nums">{{ p.value }}</span>
                </a>
              </li>
            } @empty {
              <li class="text-sm text-fg-subtle text-center py-6">Ninguém no período.</li>
            }
          </ol>
        }
      </div>
    </app-page-card>
  `,
})
export class HomeTopUsers {
  readonly usage = input<AdminUsage | null>(null);
  readonly loading = input(false);

  private readonly top = computed(() => topPeople(this.usage()));
  protected readonly byAccess = computed(() => this.top().byAccess);
  protected readonly people = computed(() => this.top().people.slice(0, 5));
  protected readonly label = roleLabel;
  protected readonly tone = ROLE_TONE;
}

/** "Onde estão os clientes": empresas por UF, e a barra "Sem UF" sempre (senão 3 parece o total). */
@Component({
  selector: 'app-home-ufs',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [PageCard],
  host: { class: 'block min-w-0' },
  template: `
    <app-page-card title="Onde estão os clientes" [fill]="true">
      <div class="px-4 sm:px-6 pb-5 flex flex-col gap-3 min-w-0 flex-1" data-home-ufs>
        <p class="-mt-3 text-xs text-fg-subtle">Empresas por estado cadastrado</p>
        @if (loading() && !usage()) {
          <div class="h-32 rounded-xl bg-surface-sunken animate-pulse motion-reduce:animate-none"></div>
        } @else {
          <ul class="flex flex-col gap-2" aria-label="Empresas por estado">
            @for (row of rows(); track row.uf) {
              <li data-uf-row class="flex items-center gap-2 text-xs min-w-0">
                <b class="w-12 shrink-0 text-fg">{{ row.uf }}</b>
                <span class="flex-1 h-2 rounded-full bg-surface-sunken overflow-hidden" aria-hidden="true">
                  <span
                    class="block h-full rounded-full transition-[width] duration-500 motion-reduce:transition-none"
                    [class.bg-success-500]="!row.missing"
                    [class.bg-fg-faint]="row.missing"
                    [style.width.%]="row.pct"
                  ></span>
                </span>
                <span class="w-8 shrink-0 text-right text-fg-muted tabular-nums">{{ row.n }}</span>
              </li>
            } @empty {
              <li class="text-sm text-fg-subtle text-center py-6">Nenhuma empresa neste escopo.</li>
            }
          </ul>
        }
      </div>
    </app-page-card>
  `,
})
export class HomeUfs {
  readonly usage = input<AdminUsage | null>(null);
  readonly loading = input(false);

  protected readonly rows = computed(() => {
    const u = this.usage();
    if (!u) return [];
    const list = [
      ...u.byUf.map((r) => ({ uf: r.uf, n: r.companies, missing: false })),
      ...(u.withoutUf > 0 ? [{ uf: 'Sem UF', n: u.withoutUf, missing: true }] : []),
    ];
    const max = Math.max(0, ...list.map((r) => r.n));
    return list.map((r) => ({ ...r, pct: max > 0 ? (r.n / max) * 100 : 0 }));
  });
}
