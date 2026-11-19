import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  OnDestroy,
  OnInit,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { AdminCapabilitiesService } from '../../../services/admin-capabilities.service';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { BackLink } from '../../../components/core/back-link/back-link';
import { DefaultPageLayout } from '../../../components/layout/default-page-layout/default-page-layout';
import { PageCard } from '../../../components/core/page-card/page-card';
import { AlertBanner } from '../../../components/alert-banner/alert-banner';
import { NotificationService } from '../../../services/notification.service';
import { ApiErrorService } from '../../../services/api-error.service';
import { AdminCompaniesService } from '../admin-companies.service';
import { ImpersonationService } from '../../../services/impersonation.service';
import {
  AdminCompanyMember,
  AdminCompanySaleItem,
  AdminCompanySaleUndoItem,
} from '../../../types/admin-company.types';
import { SupportEditEntry } from './support-edit-entry';
import { TrialExtensionSheet } from './trial-extension-sheet';
import { TrialExtensionResponse } from '../../../services/admin-trial.service';
import { ContactRevealActions } from '../contact/contact-reveal-actions';
import { RegisterContactSheet } from '../contact/register-contact-sheet';
import { CompanyActivity } from './company-activity';
import { ActionsMenu } from '../../../components/core/actions-menu/actions-menu';
import { DataListActions } from '../../../components/lists/data-list/data-list';
import { DataListMenuItem } from '../../../components/lists/data-list/data-list-menu-item';
import type { RegisterContactResponse } from '../../../types/admin-segments.types';
import {
  businessDay,
  dayMonth,
  fullDay,
  relativePast,
  deadlineText,
  lastContactText,
  nextActionTitle,
  segmentChip,
  trialActionLabel,
  whatsAppMessage,
  whyLines,
} from '../segments/segment-copy';
import { subscriptionChip, type SubscriptionChip } from './subscription-status-chip';
import { formatBrl, BrlPipe } from '../../../pipes/brl.pipe';
import { BarChart, type BarSeries } from '../../../components/charts/bar-chart/bar-chart';
import { CHART_ORANGE } from '../../../components/charts/chart-tooltip/chart-tooltip';
import { ConfirmDialog } from '../../../components/core/confirm-dialog/confirm-dialog';
import { KvList } from '../../../components/core/kv-list/kv-list';
import { StatusChip, type StatusChipTone } from '../../../components/core/status-chip/status-chip';
import {
  DataList,
  DataListCell,
  type DataListColumn,
} from '../../../components/lists/data-list/data-list';
import { KpiCard } from '../../../components/kpi-card/kpi-card';
import { todayInBusinessTz } from '../../../utils/business-clock';
import { formatFullDate, formatTime, parseServerTime } from '../../../utils/server-time';
import { companyRoleLabel } from '../../../utils/role-labels';
import { PlatePipe } from '../../../pipes/plate.pipe';
import { PersonNamePipe } from '../../../pipes/person-name.pipe';
import { formatPhoneDisplay } from '../../../utils/phone-mask';
import { maskCep, normalizeCep } from '../../../utils/cep-mask';
import { planDisplayName } from '../../../utils/plan-grid-copy';
import { gatewayLabel } from '../billing/gateway-label';
import { companyStatusChip } from './company-status';

/** Texto e tom de `app-status-chip`: a cor da situação mora só no chip. */
interface ChipStyle {
  label: string;
  tone: StatusChipTone;
}

/** Vínculo do membro em português (o backend manda o enum cru), igual ao detalhe do usuário. */
const MEMBER_STATUS_LABELS: Record<string, string> = {
  ACTIVE: 'Ativo',
  INVITED: 'Convidado',
  ONBOARDING: 'Em cadastro',
  INACTIVE: 'Inativo',
  REMOVED: 'Removido',
};

/**
 * Uma linha do bloco "Operação". `value` já chega formatado (BRL ou contagem)
 * para manter o template burro; `zero` só governa a cor do número.
 */
interface OperationMetric {
  label: string;
  value: string;
  /** Qualificador da semântica — usado onde o rótulo sozinho enganaria. */
  hint: string | null;
  zero: boolean;
}

interface OperationGroup {
  key: string;
  title: string;
  metrics: OperationMetric[];
}

/**
 * Uma linha do bloco "Dados cadastrais". `value` já vem com o "—" da tela
 * quando o campo está vazio: preenchimento é PARCIAL por natureza (a V52 é
 * aditiva), então a ausência é estado normal, não erro.
 */
interface RegistrationRow {
  label: string;
  value: string;
  /** Campo vazio: o valor fica em cinza, como as métricas zeradas. */
  empty: boolean;
}

interface RegistrationSection {
  key: string;
  title: string;
  rows: RegistrationRow[];
}

const COUNT_FORMATTER = new Intl.NumberFormat('pt-BR');

function countMetric(label: string, value: number, hint: string | null = null): OperationMetric {
  return { label, value: COUNT_FORMATTER.format(value), hint, zero: value === 0 };
}

function moneyMetric(label: string, cents: number, hint: string | null = null): OperationMetric {
  return { label, value: formatBrl(cents), hint, zero: cents === 0 };
}

/** Linha cadastral: texto vazio/nulo vira o "—" que o resto da tela já usa. */
function registrationRow(label: string, value: string | null | undefined): RegistrationRow {
  const text = (value ?? '').trim();
  return { label, value: text === '' ? '—' : text, empty: text === '' };
}

const CONFIRMATION_WORD = 'SUSPENDER';

const MONTH_LABELS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

/** Dinheiro vindo do servidor: nulo/ausente é "—", NUNCA R$ 0 (zero é dado; nulo é desconhecido). */
function moneyOrDash(cents: number | null | undefined): string {
  return cents === null || cents === undefined ? '—' : formatBrl(cents);
}

/**
 * Acima de quantos meses o eixo do gráfico perde o ano ("mai/26" -> "mai"): o gráfico compartilhado
 * não rareia os rótulos do eixo, e num celular de 375 px uma coluna de 12 mal passa da largura de
 * três letras. Doze meses seguidos não repetem nome, então o rótulo curto ainda é único.
 */
const MANAGED_AXIS_WITH_YEAR_MAX = 6;

/** `yyyy-MM` -> "mai/26" (ou "mai" sem o ano); formato inesperado volta como veio. */
function monthLabel(month: string, withYear = true): string {
  const match = /^(\d{4})-(\d{2})$/.exec(month);
  if (!match) return month;
  const name = MONTH_LABELS[Number(match[2]) - 1] ?? match[2];
  return withYear ? `${name}/${match[1].slice(2)}` : name;
}

export interface SubscriptionRow {
  label: string;
  value: string;
}

@Component({
  selector: 'app-admin-company-detail',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    PersonNamePipe,
    PlatePipe,
    BackLink,
    ReactiveFormsModule,
    DefaultPageLayout,
    PageCard,
    AlertBanner,
    SupportEditEntry,
    TrialExtensionSheet,
    RouterLink,
    BarChart,
    ActionsMenu,
    DataListActions,
    DataListMenuItem,
    CompanyActivity,
    RegisterContactSheet,
    KpiCard,
    BrlPipe,
    ConfirmDialog,
    KvList,
    StatusChip,
    DataList,
    DataListCell,
  ],
  templateUrl: './admin-company-detail.html',
  // O único degradê da tela (regra do dono: "degradê só na Assinatura").
  styles: `
    .subscription-card {
      background: linear-gradient(135deg, #f63b04 0%, #c22f00 55%, #6e1b00 100%);
    }
  `,
})
export class AdminCompanyDetail implements OnInit, OnDestroy {
  protected readonly caps = inject(AdminCapabilitiesService);
  private readonly companiesService = inject(AdminCompaniesService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly notifications = inject(NotificationService);
  private readonly apiErrors = inject(ApiErrorService);
  private readonly impersonation = inject(ImpersonationService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly reveal = inject(ContactRevealActions);
  /** Entrada do modo edição: o item do ⋮ lê a chave e abre o diálogo dele. */
  protected readonly editEntry = viewChild(SupportEditEntry);

  private companyId: string | null = null;

  protected readonly detail = this.companiesService.detail;
  protected readonly loading = this.companiesService.detailLoading;
  /** Falha ao CARREGAR a empresa — banner com CTA de "tentar novamente". */
  protected readonly error = signal<string | null>(null);
  protected readonly updating = this.companiesService.statusUpdating;

  protected readonly confirmDialogOpen = signal(false);
  protected readonly confirmControl = new FormControl<string>('', {
    nonNullable: true,
    validators: [Validators.required],
  });
  /**
   * Falha da OPERACAO de suspender/reativar (ou da validação da palavra de
   * confirmação). Banner inline dentro do diálogo, nunca toast.
   */
  protected readonly actionError = signal<string | null>(null);

  /** Falha ao ABRIR a sessão de impersonação — banner inline no card do cabeçalho. */
  protected readonly impersonationError = signal<string | null>(null);
  protected readonly impersonationStarting = signal(false);

  protected readonly targetActive = computed(() => !(this.detail()?.active ?? false));

  protected readonly companyChip = computed<ChipStyle | null>(() => {
    return companyStatusChip(this.detail()?.status);
  });

  /**
   * Membros no `app-data-list` (tabela a partir de 1024px, cartões abaixo; sem linhas). Papel é
   * chip NEUTRO (quem a pessoa é); só a situação do vínculo tem cor.
   */
  protected readonly memberColumns: readonly DataListColumn<AdminCompanyMember>[] = [
    { key: 'name', header: 'Nome', primary: true, value: (m) => m.name },
    { key: 'phone', header: 'Telefone', value: (m) => m.phoneMasked, noExport: true },
    { key: 'role', header: 'Papel', kind: 'status', value: (m) => this.roleLabel(m.role) },
    {
      key: 'status',
      header: 'Situação',
      kind: 'status',
      value: (m) => this.memberStatusLabel(m.status),
      tone: (m) => this.memberStatusTone(m.status),
    },
    { key: 'seen', header: 'Visto por último', value: (m) => this.lastSeenLabel(m.lastSeenAt) },
  ];

  protected readonly memberId = (m: AdminCompanyMember): string => m.userId;

  /** A linha do membro abre o usuário (mouse e toque); o teclado usa o link do nome. */
  protected openMember(member: AdminCompanyMember): void {
    void this.router.navigate(['/admin/users', member.userId]);
  }

  protected readonly suspendMessage =
    `Ação de risco: a empresa perde o acesso na hora. Para confirmar, digite ${CONFIRMATION_WORD} no campo abaixo.`;
  protected readonly reactivateMessage = 'A empresa voltará a ter acesso normal à plataforma.';

  /** Texto do botão do diálogo: mostra o progresso enquanto a requisição está no ar. */
  protected readonly statusConfirmLabel = computed(() => {
    if (this.updating()) return 'Atualizando...';
    return this.targetActive() ? 'Reativar' : 'Suspender';
  });

  protected readonly subscriptionChip = computed<SubscriptionChip | null>(() => {
    const sub = this.detail()?.subscription;
    return subscriptionChip(sub?.status, sub?.trialEndsAt);
  });

  /**
   * Os seis grupos do bloco "Operação", já formatados.
   *
   * Rótulos são fiéis à semântica do backend, não ao nome do campo:
   * `closedTotal` é "não cancelados" (`status <> CANCELED`), `closedAmountCents`
   * é o valor CONTRATADO e `paidAmountCents` é o que ENTROU — os dois divergem
   * por natureza e nenhum deles é chamado de "faturamento". Em multas e
   * manutenções a quantidade conta tudo, mas o dinheiro exclui as canceladas.
   *
   * Devolve `[]` quando não há empresa carregada (ou, defensivamente, quando um
   * backend antigo não mandou `operations`) — o template esconde o bloco.
   */
  /**
   * Dados cadastrais em três seções (contato, endereço, representante).
   *
   * O bloco vem SEMPRE presente do backend, e cada campo pode ser nulo — a
   * seção existe mesmo toda vazia, mostrando "—" linha a linha. Sumir com ela
   * faria o suporte achar que a tela quebrou; mostrar "—" diz a verdade: não
   * há cadastro preenchido.
   *
   * LGPD: telefone, e-mail e nome do representante são dado pessoal. Eles vão
   * para a TELA e para nenhum outro lugar — nada de `console`/log aqui.
   */
  /** Admin v2 (D1) — o membro OWNER ativo, dono da barra de contato. */
  protected readonly owner = computed(
    () => this.detail()?.members.find((m) => m.role === 'OWNER' && m.status === 'ACTIVE') ?? null,
  );

  /** "Campinas, SP" a partir do cadastro; vazio vira "—". */
  protected readonly place = computed(() => {
    const reg = this.detail()?.registration;
    const parts = [reg?.addressCity, reg?.addressUf].map((p) => (p ?? '').trim()).filter((p) => p !== '');
    return parts.length > 0 ? parts.join(', ') : '—';
  });

  protected readonly engagement = computed(() => this.detail()?.engagement ?? null);

  protected readonly segment = computed(() => segmentChip(this.engagement()?.segment));

  /** Plano em chip NEUTRO (quem a empresa é); a cor fica para a situação. */
  protected readonly planChipLabel = computed(() => {
    const sub = this.detail()?.subscription;
    return sub ? this.planLabel(sub.planName, sub.planCode) : null;
  });

  /** "Cliente desde 24/09/2026 · renova em 30/11 · Campinas, SP". */
  protected readonly headerLine = computed(() => {
    const company = this.detail();
    if (!company) return '';
    const since = company.createdAt ? `Cliente desde ${this.formatDate(company.createdAt)}` : null;
    const deadline = deadlineText(this.engagement(), this.now());
    const place = this.place();
    return [since, deadline !== '—' ? deadline.charAt(0).toLowerCase() + deadline.slice(1) : null, place !== '—' ? place : null]
      .filter(Boolean)
      .join(' · ');
  });

  /** Relógio da tela (os testes trocam). */
  protected now(): Date {
    return new Date();
  }

  // ---- Cartões pintados (estilo do painel do dono) ----------------------------------------

  protected readonly managedCents = computed(() => this.detail()?.finance?.managedMonthCents ?? null);
  protected readonly receivedCents = computed(() => this.detail()?.finance?.receivedMonthCents ?? null);
  protected readonly overdueCents = computed(() => this.detail()?.finance?.overdueMonthCents ?? null);

  protected readonly managedDetail = computed(() => {
    const ops = this.detail()?.operations;
    if (!ops) return null;
    const n = ops.rentals.activeTotal;
    return n === 1 ? '1 aluguel ativo' : `${COUNT_FORMATTER.format(n)} aluguéis ativos`;
  });

  protected readonly receivedDetail = computed(() => {
    const managed = this.managedCents();
    const received = this.receivedCents();
    if (managed === null || received === null || managed <= 0) return 'dinheiro que entrou no mês';
    return `${Math.round((received / managed) * 100)}% do gerenciado`;
  });

  /** Cartão Assinatura (o único em degradê): "Pro · R$ 79,90" e o ciclo. */
  protected readonly subscriptionValue = computed(() => {
    const sub = this.detail()?.subscription;
    if (!sub) return 'Sem assinatura';
    const plan = this.planLabel(sub.planName, sub.planCode);
    return sub.listPriceCents ? `${plan} · ${formatBrl(sub.listPriceCents)}` : plan;
  });

  protected readonly subscriptionDetail = computed(() => {
    const sub = this.detail()?.subscription;
    if (!sub) return 'nenhum plano registrado';
    const deadline = deadlineText(this.engagement(), this.now());
    const cycle = sub.billingCycle === 'YEARLY' ? 'por ano' : sub.billingCycle === 'WEEKLY' ? 'por semana' : 'por mês';
    const parts = [sub.status === 'TRIALING' || sub.status === 'EXPIRED' ? null : cycle];
    if (deadline !== '—') parts.push(deadline.charAt(0).toLowerCase() + deadline.slice(1));
    else if (sub.nextBillingDate) parts.push(`próximo pagamento ${this.formatDate(sub.nextBillingDate)}`);
    if (sub.cancelAtPeriodEnd) parts.push('cancela no fim do ciclo');
    return parts.filter(Boolean).join(' · ') || '—';
  });

  // ---- Próxima ação ------------------------------------------------------------------

  protected readonly nextTitle = computed(() => nextActionTitle(this.engagement()));
  protected readonly why = computed(() => whyLines(this.engagement()));
  protected readonly message = computed(() => {
    const company = this.detail();
    if (!company) return null;
    return whatsAppMessage(this.engagement(), company.name, this.owner()?.name ?? null, this.now());
  });

  /** Chip "até 30/11": o prazo que a próxima ação tem (fim do teste ou renovação). */
  protected readonly nextUntil = computed(() => {
    const d = this.engagement()?.deadline;
    if (!d || d.kind === 'TRIAL_ENDED') return null;
    const day = businessDay(d.at);
    return day && day >= todayInBusinessTz(this.now()) ? `até ${dayMonth(day, this.now())}` : null;
  });

  /** O que o último contato fez com a empresa em "Hoje, para agir". */
  protected readonly contactNote = computed(() => {
    const e = this.engagement();
    if (!e) return null;
    const line = lastContactText(e, this.now());
    switch (e.today?.status) {
      case 'HIDDEN_UNTIL_DATE':
        return `${line}. Até ${dayMonth(e.today.hiddenUntil, this.now())} ela fica fora de “Hoje, para agir”.`;
      case 'HIDDEN_UNTIL_SEGMENT_CHANGES':
        return `${line}. Fica fora de “Hoje, para agir” até o segmento mudar.`;
      case 'NOT_INTERESTED':
        return 'Disse que não tem interesse: fora de “Hoje, para agir” e das sugestões até alguém registrar um contato novo.';
      case 'LISTED':
        return e.today.listedReason === 'FOLLOW_UP_DUE'
          ? `${line}. O retorno chegou: ela está em “Hoje, para agir”.`
          : 'Está em “Hoje, para agir” hoje.';
      default:
        return line;
    }
  });

  protected readonly trialLabel = computed(() => trialActionLabel(this.engagement()?.segment));

  /** Meses da série, do mais antigo ao corrente (o servidor já manda nessa ordem). */
  private readonly managedPoints = computed(() => this.detail()?.finance?.managedSeries ?? []);

  /** Eixo x das colunas: um rótulo por mês, sem o ano quando são muitos (ver a constante). */
  protected readonly managedLabels = computed(() => {
    const points = this.managedPoints();
    const withYear = points.length <= MANAGED_AXIS_WITH_YEAR_MAX;
    return points.map((point) => monthLabel(point.month, withYear));
  });

  /** Uma série só, em colunas verticais (centavos): altura fixa, não cresce um mês por linha. */
  protected readonly managedSeries = computed<BarSeries[]>(() => [
    {
      key: 'managed',
      label: 'Valor gerenciado',
      color: CHART_ORANGE,
      values: this.managedPoints().map((point) => point.managedCents),
    },
  ]);

  protected readonly subscriptionRows = computed<SubscriptionRow[]>(() => {
    const sub = this.detail()?.subscription;
    if (!sub) return [];
    const discount = sub.discountCents;
    return [
      { label: 'Preço de tabela', value: moneyOrDash(sub.listPriceCents) },
      {
        label: 'Desconto',
        value: discount === null || discount === undefined ? '—' : discount === 0 ? 'Sem desconto' : formatBrl(discount),
      },
      { label: 'Cobrado de verdade', value: moneyOrDash(sub.chargedCents) },
      {
        label: 'Forma de pagamento',
        value: sub.paymentMethod === 'PIX' ? 'Pix' : sub.paymentMethod === 'CARD' ? 'Cartão' : '—',
      },
    ];
  });

  protected readonly registrationSections = computed<RegistrationSection[]>(() => {
    const reg = this.detail()?.registration;
    if (!reg) return [];

    return [
      {
        key: 'contact',
        title: 'Contato',
        rows: [
          registrationRow('Telefone', formatPhoneDisplay(reg.phone)),
          registrationRow('E-mail', reg.email),
        ],
      },
      {
        key: 'address',
        title: 'Endereço',
        rows: [
          registrationRow('Logradouro', reg.addressStreet),
          registrationRow('Número', reg.addressNumber),
          registrationRow('Complemento', reg.addressComplement),
          registrationRow('Bairro', reg.addressDistrict),
          registrationRow('CEP', normalizeCep(reg.addressCep).length === 8 ? maskCep(reg.addressCep) : reg.addressCep),
          registrationRow('Cidade', reg.addressCity),
          registrationRow('UF', reg.addressUf),
        ],
      },
      {
        key: 'representative',
        title: 'Representante legal',
        rows: [
          registrationRow('Nome', reg.representativeName),
          registrationRow('Cargo', reg.representativeRole),
        ],
      },
    ];
  });

  /** Nenhum campo cadastral preenchido — a tela avisa em vez de só mostrar "—". */
  protected readonly registrationEmpty = computed(() =>
    this.registrationSections().every((section) => section.rows.every((row) => row.empty)),
  );

  // ---- Vendas (FEAT-0075) ------------------------------------------------

  protected readonly sales = computed<AdminCompanySaleItem[]>(
    () => this.detail()?.operations?.sales?.sales ?? [],
  );

  protected readonly saleUndos = computed<AdminCompanySaleUndoItem[]>(
    () => this.detail()?.operations?.sales?.undos ?? [],
  );

  protected readonly hasSalesHistory = computed(
    () => this.sales().length > 0 || this.saleUndos().length > 0,
  );

  /** Soma das vendas VIGENTES — o que a empresa tem de venda hoje. */
  protected readonly salesTotalCents = computed(() =>
    this.sales().reduce((sum, sale) => sum + (sale.saleValueCents ?? 0), 0),
  );

  protected readonly operationGroups = computed<OperationGroup[]>(() => {
    const ops = this.detail()?.operations;
    if (!ops) return [];

    return [
      {
        key: 'rentals',
        title: 'Aluguéis',
        metrics: [
          countMetric('Total', ops.rentals.total),
          countMetric('Ativos', ops.rentals.activeTotal),
          countMetric('Não cancelados', ops.rentals.closedTotal),
          moneyMetric('Valor contratado', ops.rentals.closedAmountCents, 'soma dos não cancelados'),
          countMetric('Concluídos', ops.rentals.completedTotal),
          moneyMetric('Valor dos concluídos', ops.rentals.completedAmountCents),
          countMetric('Cancelados', ops.rentals.canceledTotal),
          moneyMetric('Recebido', ops.rentals.paidAmountCents, 'cobranças pagas'),
        ],
      },
      {
        key: 'contracts',
        title: 'Contratos',
        metrics: [
          countMetric('Total', ops.contracts.total),
          countMetric('Gerados pelo sistema', ops.contracts.generatedTotal),
          countMetric(
            'Assinados digitalmente',
            ops.contracts.signedTotal,
            'assinatura em papel não entra',
          ),
        ],
      },
      {
        key: 'vehicles',
        title: 'Veículos',
        metrics: [
          countMetric('Total', ops.vehicles.total),
          countMetric('Ativos', ops.vehicles.activeTotal, 'exclui arquivados'),
        ],
      },
      {
        key: 'drivers',
        title: 'Motoristas',
        metrics: [
          countMetric('Total', ops.drivers.total),
          countMetric('Em atividade', ops.drivers.workingTotal),
        ],
      },
      {
        key: 'fines',
        title: 'Multas',
        metrics: [
          countMetric('Total', ops.fines.total),
          countMetric('Pendentes', ops.fines.pendingTotal),
          moneyMetric('Valor', ops.fines.amountCents, 'exclui canceladas'),
        ],
      },
      {
        key: 'maintenances',
        title: 'Manutenções',
        metrics: [
          countMetric('Total', ops.maintenances.total),
          moneyMetric('Custo', ops.maintenances.costCents, 'exclui canceladas'),
        ],
      },
      {
        // Vendas VIGENTES (desfazer apaga a linha; o fato fica na trilha, que
        // aparece na lista de desfazimentos abaixo do consolidado).
        key: 'sales',
        title: 'Vendas de veículo',
        metrics: [
          countMetric('Vendas vigentes', ops.sales?.sales?.length ?? 0),
          moneyMetric('Valor vendido', this.salesTotalCents(), 'soma das vigentes'),
          countMetric(
            'Desfazimentos',
            ops.sales?.undos?.length ?? 0,
            'inclui recusas por falta de vaga',
          ),
        ],
      },
    ];
  });

  /** Os quatro números da operação que sempre importam, em blocos compactos. */
  protected readonly operationTiles = computed(() => {
    const ops = this.detail()?.operations;
    if (!ops) return [];
    return [
      { key: 'vehicles', label: 'Veículos ativos', value: COUNT_FORMATTER.format(ops.vehicles.activeTotal) },
      { key: 'drivers', label: 'Motoristas', value: COUNT_FORMATTER.format(ops.drivers.total) },
      { key: 'rentals', label: 'Aluguéis ativos', value: COUNT_FORMATTER.format(ops.rentals.activeTotal) },
      { key: 'contracts', label: 'Contratos', value: COUNT_FORMATTER.format(ops.contracts.total) },
    ];
  });

  /** Grupos sem nenhum número: ficam recolhidos atrás de "ver tudo", em vez de meia tela de zeros. */
  protected readonly zeroGroupNames = computed(() =>
    this.operationGroups()
      .filter((g) => g.metrics.every((m) => m.zero))
      .map((g) => g.title.toLowerCase()),
  );

  protected readonly operationsOpen = signal(false);

  protected readonly operationsToggleLabel = computed(() => {
    const zero = this.zeroGroupNames();
    if (this.operationsOpen()) return 'Recolher os detalhes';
    if (zero.length === 0) return 'Ver tudo';
    const list = zero.length === 1 ? zero[0] : `${zero.slice(0, -1).join(', ')} e ${zero[zero.length - 1]}`;
    return `Sem registro: ${list} · ver tudo`;
  });

  ngOnInit(): void {
    this.caps.ensureLoaded().subscribe();
    this.route.paramMap
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((params) => {
        const id = params.get('id');
        if (!id) {
          this.router.navigate(['/admin/companies']);
          return;
        }
        this.companyId = id;
        this.loadDetail(id);
      });
  }

  ngOnDestroy(): void {
    this.companiesService.clearDetail();
  }

  protected reload(): void {
    if (this.companyId) this.loadDetail(this.companyId);
  }

  // ---- Conversa (⋮) -----------------------------------------------------------------

  protected readonly contactOpen = signal(false);

  protected whatsApp(): void {
    const company = this.detail();
    if (!company) return;
    void this.reveal.whatsApp('COMPANY', company.id, this.message());
  }

  protected openContact(): void {
    this.contactOpen.set(true);
  }

  protected closeContact(): void {
    this.contactOpen.set(false);
  }

  /** O cartão "Próxima ação" troca já com a resposta; a atividade vem no recarregamento. */
  protected onContactSaved(res: RegisterContactResponse): void {
    const company = this.detail();
    if (company) this.companiesService.patchEngagement(company.id, res.engagement);
    const ext = res.trialExtension;
    this.notifications.success(`Contato registrado.${ext ? ` Teste estendido em ${ext.days} dias.` : ''}`);
    this.reload();
  }

  // ---- Membros (⋮ da linha) ------------------------------------------------------------

  protected memberWhatsApp(member: AdminCompanyMember): void {
    void this.reveal.whatsApp('USER', member.userId, null, this.companyId);
  }

  protected memberCall(member: AdminCompanyMember): void {
    void this.reveal.call('USER', member.userId, this.companyId);
  }

  protected memberCopy(member: AdminCompanyMember): void {
    void this.reveal.copy('USER', member.userId, this.companyId);
  }

  protected readonly memberKebabLabel = (m: AdminCompanyMember): string => `Ações de ${m.name}`;

  // ---- Conta (⋮) ---------------------------------------------------------------------

  protected readonly internalUpdating = this.companiesService.internalUpdating;

  /** Empresa interna sai das métricas e dos segmentos; reversível no mesmo menu, sem confirmação. */
  protected toggleInternal(): void {
    const company = this.detail();
    if (!company) return;
    const target = !company.internal;
    this.companiesService.updateInternal(company.id, target).subscribe({
      next: () =>
        this.notifications.success(
          target
            ? 'Empresa marcada como interna. Fica fora das métricas e dos segmentos.'
            : 'Marca de interna desfeita. Empresa volta a contar nas métricas.',
        ),
      error: (err: HttpErrorResponse) =>
        this.notifications.error(
          this.apiErrors.messageFor(err, 'Não foi possível atualizar a marca de empresa interna.'),
        ),
    });
  }

  // ---- [trilha A] Estender teste -------------------------------------------

  protected readonly trialExtensionOpen = signal(false);

  /** Só faz sentido em teste: em andamento (TRIALING) ou vencido (EXPIRED). */
  protected readonly canExtendTrial = computed(() => {
    const status = this.detail()?.subscription?.status;
    return status === 'TRIALING' || status === 'EXPIRED';
  });

  protected openTrialExtension(): void {
    this.trialExtensionOpen.set(true);
  }

  protected closeTrialExtension(): void {
    this.trialExtensionOpen.set(false);
  }

  protected onTrialExtended(res: TrialExtensionResponse): void {
    this.trialExtensionOpen.set(false);
    const email = res.emailRecipients > 0
      ? ' A empresa foi avisada por e-mail.'
      : ' A empresa não tem e-mail cadastrado para o aviso.';
    this.notifications.success(`Teste estendido em ${res.days} dias.${email}`);
    this.reload();
  }

  private loadDetail(id: string): void {
    this.error.set(null);
    this.companiesService.loadDetail(id).subscribe({
      error: (err: HttpErrorResponse) => {
        this.error.set(this.apiErrors.messageFor(err, 'Não foi possível carregar a empresa.'));
      },
    });
  }

  /**
   * Abre a sessão "ver como empresa" e joga o admin direto no dashboard do
   * tenant. A navegação só acontece DEPOIS da troca de credencial, senão a
   * primeira tela carregaria com o token administrativo e mostraria dados do
   * contexto errado.
   */
  protected startImpersonation(): void {
    if (!this.companyId || this.impersonationStarting()) return;
    this.impersonationError.set(null);
    this.impersonationStarting.set(true);

    this.impersonation.start(this.companyId).subscribe({
      next: (session) => {
        this.impersonationStarting.set(false);
        this.notifications.info(
          `Você está vendo ${session.companyName} em modo somente leitura.`,
        );
        void this.router.navigate(['/dashboard']);
      },
      error: (err: HttpErrorResponse) => {
        this.impersonationStarting.set(false);
        this.impersonationError.set(
          this.apiErrors.messageFor(err, 'Não foi possível abrir a sessão de leitura.'),
        );
      },
    });
  }

  protected openStatusDialog(): void {
    this.confirmControl.reset('');
    this.actionError.set(null);
    this.confirmDialogOpen.set(true);
  }

  protected closeStatusDialog(): void {
    this.confirmDialogOpen.set(false);
    this.actionError.set(null);
  }

  protected confirmStatusChange(): void {
    const current = this.detail();
    if (!current || !this.companyId) return;

    const nextActive = !current.active;
    this.actionError.set(null);

    // Only require the typed confirmation when suspending — reactivating is safe.
    if (!nextActive) {
      const typed = (this.confirmControl.value ?? '').trim().toUpperCase();
      if (typed !== CONFIRMATION_WORD) {
        this.actionError.set(`Digite "${CONFIRMATION_WORD}" para confirmar.`);
        return;
      }
    }

    this.companiesService.updateStatus(this.companyId, nextActive).subscribe({
      next: (res) => {
        this.confirmDialogOpen.set(false);
        this.actionError.set(null);
        this.notifications.success(
          res.active ? 'Empresa reativada com sucesso.' : 'Empresa suspensa com sucesso.',
        );
      },
      error: (err: HttpErrorResponse) => {
        this.actionError.set(
          this.apiErrors.messageFor(err, 'Não foi possível atualizar o status da empresa.'),
        );
      },
    });
  }

  /**
   * Data (dia) — inclusive `LocalDate` (`yyyy-MM-dd`), como `saleDate`.
   *
   * A ÂNCORA `T00:00:00` não é enfeite: `new Date('2026-08-20')` é interpretado
   * como meia-noite UTC e, no fuso do Brasil (UTC-3), volta 19/08 — a tela
   * mostraria a venda um dia antes do que aconteceu. É a convenção já usada em
   * `drivers-list`, `financings-list`, `alerts-page` e `admin-home`; aqui ela é
   * seguida localmente (unificar as 6+ cópias é nó próprio).
   */
  protected formatDate(value: string | null | undefined): string {
    if (!value) return '—';
    if (value.length === 10) return fullDay(value);
    return formatFullDate(parseServerTime(value));
  }

  /** "hoje" / "ontem" / "há N dias" / data; nulo = "—" (a coluna é esparsa, não é "nunca acessou"). */
  protected lastSeenLabel(value: string | null | undefined): string {
    if (!value) return '—';
    return relativePast(value, this.now()) ?? '—';
  }

  protected formatDateTime(value: string | null): string {
    const date = parseServerTime(value);
    if (!date) return '—';
    return `${formatFullDate(date)}, ${formatTime(date)}`;
  }

  /**
   * Estado do evento da trilha, com a cor do que ele significa.
   *
   * O Java expõe `state` como String livre, então um estado NOVO chegaria aqui
   * sem aviso. Cair no "Desfeita" por omissão faria a tela AFIRMAR algo que
   * não sabe; estado não reconhecido aparece com o valor cru em chip neutro —
   * o suporte vê que existe algo novo em vez de ler uma informação errada.
   */
  protected undoStateChip(state: string): ChipStyle {
    if (state === 'UNDO_REFUSED') return { label: 'Recusado', tone: 'amber' };
    if (state === 'ACTIVE') return { label: 'Desfeita', tone: 'neutral' };
    return { label: state || 'Desconhecido', tone: 'neutral' };
  }

  protected roleLabel(role: string): string {
    return companyRoleLabel(role);
  }

  protected memberStatusLabel(status: string): string {
    return MEMBER_STATUS_LABELS[status] ?? status;
  }

  protected memberStatusTone(status: string): StatusChipTone {
    return status === 'ACTIVE' ? 'green' : status === 'INVITED' ? 'blue' : 'neutral';
  }

  /**
   * A trilha é append-only e o MESMO veículo pode ter vários eventos (desfeita,
   * recusada, desfeita de novo). Só o `vehicleId` colidiria; o índice sozinho
   * reordenaria o DOM à toa. O par identifica a linha de forma estável.
   */
  protected trackUndo(index: number, undo: AdminCompanySaleUndoItem): string {
    // O ÍNDICE entra sempre: dois eventos do mesmo veículo podem compartilhar
    // `createdAt` (mesmo segundo) ou ter os dois nulos, e aí a chave colidiria
    // — `@for` com chave repetida descarta linha em silêncio.
    return `${undo.vehicleId}-${undo.createdAt ?? 'sem-data'}-${index}`;
  }

  /** "Pro", nunca "PRO (PRO_MONTHLY_STRIPE)": o ciclo já tem a linha dele. */
  protected planLabel(name: string | null, code: string | null): string {
    return planDisplayName(name, code);
  }

  /** "Stripe", com maiúscula de nome próprio (o backend manda "stripe"). */
  protected gatewayName(raw: string | null): string {
    return gatewayLabel(raw);
  }

  protected billingCycleLabel(value: string | null): string {
    if (!value) return '—';
    const map: Record<string, string> = {
      WEEKLY: 'Semanal',
      MONTHLY: 'Mensal',
      YEARLY: 'Anual',
    };
    return map[value] ?? value;
  }
}
