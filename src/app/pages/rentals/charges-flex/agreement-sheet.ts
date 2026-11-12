import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';

import { BottomSheet } from '../../../components/core/bottom-sheet/bottom-sheet';
import { AlertBanner } from '../../../components/alert-banner/alert-banner';
import { ApiErrorService } from '../../../services/api-error.service';
import { AgreementDto, agreementReasonLabel } from '../../../types/agreement.types';
import { RentalBillingFrequency, RentalResponseDto } from '../../../types/rental.types';
import { ChargesFlexService } from './charges-flex.service';
import { agreementName, brDate, brDayMonth, brl, flexChargeLabel, periodWord, splitEvenly } from './charges-flex';

const ROLE_LABELS: Record<string, string> = { OWNER: 'dono', MANAGER: 'gerente' };

/**
 * FEAT-0573 — jornada D, passo 7 (e H: cadeia, atenção): o acordo por inteiro. Quem fez e
 * quando, o motivo, a descrição, o que saiu de cobrança, o que entrou no lugar e a cadeia de
 * renegociações. Só leitura; a ação de renegociar de novo mora no ⋮ de cada parcela.
 */
@Component({
  selector: 'app-agreement-sheet',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [BottomSheet, AlertBanner],
  template: `
    <app-bottom-sheet [title]="title()" [subtitle]="subtitle()" size="lg" (closed)="closed.emit()">
      <div class="flex flex-col gap-4" data-testid="agreement-sheet">
        @if (loading()) {
          <div class="flex flex-col gap-2" aria-busy="true">
            <div class="h-14 rounded-xl bg-surface-sunken animate-pulse motion-reduce:animate-none"></div>
            <div class="h-14 rounded-xl bg-surface-sunken animate-pulse motion-reduce:animate-none"></div>
            <div class="h-14 rounded-xl bg-surface-sunken animate-pulse motion-reduce:animate-none"></div>
          </div>
        } @else if (error(); as err) {
          <app-alert-banner variant="error" [message]="err" />
        } @else if (agreement(); as a) {
          @if (a.status === 'NEEDS_ATTENTION') {
            <app-alert-banner variant="warning" data-testid="agreement-needs-attention"
              message="Uma etapa deste acordo não foi confirmada. O suporte já foi avisado; não refaça o acordo." />
          } @else if (a.status === 'ABORTED') {
            <app-alert-banner variant="info" data-testid="agreement-aborted"
              message="Este acordo não foi concluído. As cobranças continuaram como estavam." />
          } @else if (a.status === 'CANCELLING' || a.status === 'ISSUING') {
            <app-alert-banner variant="info"
              message="Este acordo ainda está sendo concluído. Volte em alguns minutos." />
          }

          <dl class="flex flex-col gap-4 text-base" data-testid="agreement-details">
            <div class="enter-up flex flex-col gap-0.5" style="--stagger-i: 0">
              <dt class="text-sm text-fg-subtle">Quem fez</dt>
              <dd class="font-semibold text-fg">{{ who() }}</dd>
              <dd class="text-sm text-fg-subtle tabular-nums">{{ when() }}</dd>
            </div>
            <div class="enter-up flex flex-col gap-0.5" style="--stagger-i: 1">
              <dt class="text-sm text-fg-subtle">Motivo</dt>
              <dd class="font-semibold text-fg">{{ reason() }}</dd>
            </div>
            <div class="enter-up flex flex-col gap-0.5" style="--stagger-i: 2">
              <dt class="text-sm text-fg-subtle">Descrição</dt>
              <dd class="whitespace-pre-line text-fg-body" data-testid="agreement-description">{{ a.description }}</dd>
            </div>
            <div class="enter-up flex flex-col gap-0.5" style="--stagger-i: 3">
              <dt class="text-sm text-fg-subtle">Saíram de cobrança</dt>
              <dd class="font-semibold text-fg" data-testid="agreement-sources">{{ sourcesText() }}</dd>
              <dd class="text-sm text-fg-subtle">Somavam {{ money(a.originalTotalCents) }}. Estão como Renegociada.</dd>
            </div>
            <div class="enter-up flex flex-col gap-0.5" style="--stagger-i: 4">
              <dt class="text-sm text-fg-subtle">Entraram no lugar</dt>
              <dd class="font-semibold text-fg" data-testid="agreement-instalments">{{ instalmentsText() }}</dd>
              <dd class="text-sm text-fg-subtle tabular-nums">{{ instalmentsSub() }}</dd>
            </div>
            @if (fineText(); as fine) {
              <div class="enter-up flex flex-col gap-0.5" style="--stagger-i: 5">
                <dt class="text-sm text-fg-subtle">Multa por atraso</dt>
                <dd class="font-semibold text-fg">{{ fine.main }}</dd>
                <dd class="text-sm text-fg-subtle">{{ fine.sub }}</dd>
              </div>
            }
            @if (chain().length > 0) {
              <div class="enter-up flex flex-col gap-0.5" style="--stagger-i: 6" data-testid="agreement-chain">
                <dt class="text-sm text-fg-subtle">Ligações</dt>
                @for (link of chain(); track link.id) {
                  <dd>
                    <button type="button" (click)="open.emit(link.id)"
                      class="press min-h-11 text-left text-base font-medium text-primary-700 underline dark:text-primary-400 rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400">
                      {{ link.text }}
                    </button>
                  </dd>
                }
              </div>
            }
          </dl>
          <p class="text-sm text-fg-subtle">
            Se uma parcela atrasar, dá para renegociar de novo pelo ⋮ dela. O novo acordo fica ligado a este.
          </p>
        }
      </div>

      <div sheetFooter class="flex flex-col-reverse gap-2 lg:flex-row lg:justify-end lg:gap-3">
        <button type="button" (click)="close()"
          class="press min-h-12 w-full rounded-xl bg-surface-sunken px-5 text-base font-medium text-fg-muted transition-colors hover:bg-surface-strong focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 lg:w-auto">
          Fechar
        </button>
      </div>
    </app-bottom-sheet>
  `,
})
export class AgreementSheet implements OnInit {
  private readonly api = inject(ChargesFlexService);
  private readonly apiErrors = inject(ApiErrorService);

  readonly rental = input.required<RentalResponseDto>();
  readonly agreementId = input.required<string>();
  readonly subtitle = input<string | null>(null);
  /** Os acordos do aluguel já carregados (para nomear a cadeia sem outra chamada). */
  readonly known = input<readonly AgreementDto[]>([]);

  /** Abrir outro acordo da cadeia. */
  readonly open = output<string>();
  readonly closed = output<void>();

  private readonly sheet = viewChild(BottomSheet);

  protected readonly agreement = signal<AgreementDto | null>(null);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);

  ngOnInit(): void {
    const cached = this.known().find((a) => a.id === this.agreementId());
    if (cached) {
      this.agreement.set(cached);
      this.loading.set(false);
      return;
    }
    this.api.getAgreement(this.rental().id, this.agreementId()).subscribe({
      next: (a) => {
        this.agreement.set(a);
        this.loading.set(false);
      },
      error: (err: HttpErrorResponse) => {
        this.loading.set(false);
        this.error.set(this.apiErrors.messageFor(err, 'Não foi possível abrir o acordo.'));
      },
    });
  }

  protected close(): void {
    this.sheet()?.requestClose();
  }

  protected money(cents: number): string {
    return brl(cents);
  }

  private get frequency(): RentalBillingFrequency {
    return this.rental().billingFrequency;
  }

  protected readonly title = computed(() => {
    const a = this.agreement();
    if (!a) return 'Acordo';
    return `${agreementName(a.seq)} de ${brDate(a.createdAt?.slice(0, 10))}`;
  });

  protected readonly who = computed(() => {
    const by = this.agreement()?.createdBy;
    if (!by) return '—';
    const role = ROLE_LABELS[by.role];
    return role ? `${by.name}, ${role}` : by.name;
  });

  protected readonly when = computed(() => {
    const at = this.agreement()?.createdAt;
    if (!at) return '';
    const d = new Date(at);
    if (Number.isNaN(d.getTime())) return '';
    const date = d.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
    const time = d.toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' });
    return `${date} às ${time}`;
  });

  protected readonly reason = computed(() => agreementReasonLabel(this.agreement()?.reason));

  protected readonly sourcesText = computed(() => {
    const a = this.agreement();
    if (!a) return '';
    const labels = a.sources.map((s) => {
      const flex = flexChargeLabel(
        {
          kind: s.kind,
          periodIndex: s.periodIndex,
          instalmentIndex: s.instalmentIndex,
          instalmentCount: s.instalmentCount,
          agreementSeq: s.fromAgreementSeq,
        },
        this.frequency,
      );
      if (flex) return flex;
      if (s.kind === 'CAUCAO') return 'Caução';
      if (s.periodIndex != null) return `${periodWord(this.frequency)} ${s.periodIndex + 1}`;
      return 'Aluguel';
    });
    if (labels.length <= 1) return labels.join('');
    return `${labels.slice(0, -1).join(', ')} e ${labels[labels.length - 1]}`;
  });

  protected readonly instalmentsText = computed(() => {
    const list = this.agreement()?.instalments ?? [];
    if (list.length === 0) return '—';
    const amounts = new Set(list.map((c) => c.amount));
    if (list.length === 1) return `1 parcela de ${brl(list[0].amount)}`;
    return amounts.size === 1
      ? `${list.length} parcelas de ${brl(list[0].amount)}`
      : `${list.length} parcelas, de ${brl(Math.min(...amounts))} a ${brl(Math.max(...amounts))}`;
  });

  protected readonly instalmentsSub = computed(() => {
    const a = this.agreement();
    if (!a) return '';
    const dates = a.instalments.map((c) => c.dueDate).filter((d): d is string => !!d).sort();
    const range =
      dates.length === 0
        ? ''
        : dates.length === 1
          ? `${brDate(dates[0])}. `
          : `${dates.slice(0, -1).map(brDayMonth).join(', ')} e ${brDate(dates[dates.length - 1])}. `;
    const diff = a.differenceCents;
    const delta =
      diff === 0 ? 'o mesmo valor' : diff > 0 ? `${brl(diff)} a mais` : `${brl(-diff)} a menos`;
    return `${range}Somam ${brl(a.agreedTotalCents)}, ${delta}.`;
  });

  protected readonly fineText = computed<{ main: string; sub: string } | null>(() => {
    const r = this.rental();
    const n = this.agreement()?.instalments.length ?? 0;
    if (r.lateFineType !== 'FIXED' || !r.lateFineValue || n === 0) return null;
    const shares = splitEvenly(r.lateFineValue, n);
    const same = new Set(shares).size === 1;
    return {
      main: same ? `${brl(shares[0])} em cada parcela` : `${brl(shares[0])} por parcela, a última com os centavos`,
      sub: `Os ${brl(r.lateFineValue)} do aluguel, divididos por ${n}.`,
    };
  });

  protected readonly chain = computed(() => {
    const a = this.agreement();
    if (!a) return [];
    const seqOf = (id: string): number | null => {
      const known = this.known().find((k) => k.id === id);
      if (known) return known.seq;
      return a.sources.find((s) => s.fromAgreementId === id)?.fromAgreementSeq ?? null;
    };
    return [
      ...a.parentAgreementIds.map((id) => ({ id, text: `Veio do ${agreementName(seqOf(id) ?? 1)}` })),
      ...a.childAgreementIds.map((id) => ({ id, text: `Renegociado de novo no ${agreementName(seqOf(id) ?? 2)}` })),
    ];
  });
}
