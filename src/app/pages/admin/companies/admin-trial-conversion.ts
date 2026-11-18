import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { Router, RouterLink } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { DefaultPageLayout } from '../../../components/layout/default-page-layout/default-page-layout';
import { AlertBanner } from '../../../components/alert-banner/alert-banner';
import { PageCard } from '../../../components/core/page-card/page-card';
import { StatusChip, type StatusChipTone } from '../../../components/core/status-chip/status-chip';
import {
  DataList,
  DataListActions,
  DataListCell,
  type DataListColumn,
} from '../../../components/lists/data-list/data-list';
import { DataListMenuItem } from '../../../components/lists/data-list/data-list-menu-item';
import { ListToolbar } from '../../../components/lists/list-toolbar/list-toolbar';
import { ApiErrorService } from '../../../services/api-error.service';
import { TrialConversionItem } from '../../../types/admin-charges.types';
import { AdminChargesService } from '../charges/admin-charges.service';
import { ContactActions } from '../contact/contact-actions';
import { AdminCompaniesTabs } from './admin-companies-tabs';
import { PersonNamePipe } from '../../../pipes/person-name.pipe';

const STAGE_LABELS = ['Só cadastro', 'Cadastrou veículo', 'Cadastrou motorista', 'Fez aluguel'];

const COUNT = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 });

/** "1 veículo", "2 veículos", "0 aluguéis". */
function plural(n: number, one: string, many: string): string {
  return `${COUNT.format(n)} ${n === 1 ? one : many}`;
}

/** Texto para comparar na busca: sem acento e sem caixa. */
function fold(value: string | null | undefined): string {
  return (value ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}

/** Data em pt-BR; `yyyy-MM-dd` sem fuso (meia-noite UTC mostraria o dia anterior em Brasília). */
export function formatConversionDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00` : iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

/**
 * "Converter testes" (admin v2, D5): empresas cujo teste acabou ou acaba em
 * até 7 dias, decidido por `trial_ends_at` (nunca pelo status), e que não pagam.
 * A ordem vem do servidor: melhor para converter primeiro. "Estender teste"
 * mora no detalhe da empresa (trilha A); aqui há só o link.
 *
 * <p>Padrão de lista (18/11/2026): `app-page-card "Lista"` + `app-list-toolbar` + `app-data-list`
 * (tabela a partir de 1024px, cartões abaixo, kebab). Os sinais de uso são texto corrido
 * ("2 veículos · 1 motorista · 1 aluguel"), não pílulas, que pareciam botões.</p>
 *
 * <p>A busca é local: o servidor devolve a lista inteira de uma vez (sem paginação), então
 * filtrar no navegador mostra exatamente o que existe.</p>
 */
@Component({
  selector: 'app-admin-trial-conversion',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    PersonNamePipe,
    DefaultPageLayout,
    AlertBanner,
    PageCard,
    StatusChip,
    DataList,
    DataListCell,
    DataListActions,
    DataListMenuItem,
    ListToolbar,
    RouterLink,
    ContactActions,
    AdminCompaniesTabs,
  ],
  templateUrl: './admin-trial-conversion.html',
})
export class AdminTrialConversion implements OnInit {
  private readonly service = inject(AdminChargesService);
  private readonly apiErrors = inject(ApiErrorService);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly items = signal<TrialConversionItem[]>([]);
  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly includeInternal = signal(false);
  protected readonly query = signal('');

  /** A ordem do servidor é preservada; a busca só esconde quem não casa. */
  protected readonly visible = computed(() => {
    const q = fold(this.query());
    const all = this.items();
    if (!q) return all;
    return all.filter((i) => fold(i.companyName).includes(q) || fold(i.ownerName).includes(q));
  });

  protected readonly columns: readonly DataListColumn<TrialConversionItem>[] = [
    { key: 'company', header: 'Empresa', primary: true, value: (i) => i.companyName },
    {
      key: 'stage',
      header: 'Até onde chegou',
      kind: 'status',
      value: (i) => this.stageLabel(i.activationStage),
      tone: (i) => this.stageTone(i.activationStage),
    },
    { key: 'usage', header: 'Uso', value: (i) => this.signals(i) },
    { key: 'access', header: 'Último acesso', value: (i) => this.lastAccess(i) },
    { key: 'owner', header: 'Dono', value: (i) => i.ownerName, noExport: true },
  ];

  protected readonly rowId = (i: TrialConversionItem): string => i.companyId;

  ngOnInit(): void {
    this.load();
  }

  protected toggleInternal(event: Event): void {
    this.includeInternal.set((event.target as HTMLInputElement).checked);
    this.load();
  }

  protected setQuery(value: string): void {
    this.query.set(value);
  }

  protected clearFilters(): void {
    this.query.set('');
  }

  protected openCompany(item: TrialConversionItem): void {
    void this.router.navigate(['/admin/companies', item.companyId]);
  }

  protected load(): void {
    this.loading.set(true);
    this.error.set(null);
    this.service
      .trialConversion(this.includeInternal())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.items.set(res);
          this.loading.set(false);
        },
        error: (err: HttpErrorResponse) => {
          this.loading.set(false);
          this.error.set(this.apiErrors.messageFor(err, 'Não foi possível carregar os testes.'));
        },
      });
  }

  protected stageLabel(stage: number): string {
    return STAGE_LABELS[stage] ?? STAGE_LABELS[0];
  }

  /** Quanto mais longe chegou, mais perto de pagar: aluguel verde, meio do caminho âmbar. */
  protected stageTone(stage: number): StatusChipTone {
    if (stage >= 3) return 'green';
    if (stage >= 1) return 'amber';
    return 'neutral';
  }

  protected trialLabel(item: TrialConversionItem): string {
    const n = item.daysSinceTrialEnd;
    if (n < 0) return -n === 1 ? 'Teste acaba amanhã' : `Teste acaba em ${-n} dias`;
    if (n === 0) return 'Teste acabou hoje';
    return n === 1 ? 'Teste acabou ontem' : `Teste acabou há ${n} dias`;
  }

  /** "2 veículos · 1 motorista · 0 aluguéis": texto corrido, nada que pareça botão. */
  protected signals(item: TrialConversionItem): string {
    return [
      plural(item.vehicles, 'veículo', 'veículos'),
      plural(item.drivers, 'motorista', 'motoristas'),
      plural(item.rentals, 'aluguel', 'aluguéis'),
    ].join(' · ');
  }

  /** Último acesso conhecido: presença (V122) ou, na falta, o último login. */
  protected lastAccess(item: TrialConversionItem): string {
    const iso = item.lastSeenAt ?? item.lastLoginAt;
    if (!iso) return 'Nunca registrado';
    return this.formatDate(iso);
  }

  protected formatDate(iso: string | null): string {
    return formatConversionDate(iso);
  }

  /** Mensagem curta, em pt-BR, oferecendo ajuda. Só o primeiro nome do dono. */
  protected whatsAppText(item: TrialConversionItem): string {
    const first = (item.ownerName ?? '').trim().split(/\s+/)[0];
    const hello = first ? `Olá, ${first}!` : 'Olá!';
    const when =
      item.daysSinceTrialEnd < 0
        ? `o teste da ${item.companyName} no MyCarsHub está acabando`
        : `o teste da ${item.companyName} no MyCarsHub terminou`;
    return `${hello} Aqui é da equipe MyCarsHub. Vi que ${when}. Posso te ajudar a configurar o que falta ou tirar alguma dúvida?`;
  }
}
