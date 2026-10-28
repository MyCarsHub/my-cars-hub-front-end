import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  OnInit,
  inject,
  signal,
} from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { RouterLink } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { DefaultPageLayout } from '../../../components/layout/default-page-layout/default-page-layout';
import { AlertBanner } from '../../../components/alert-banner/alert-banner';
import { ApiErrorService } from '../../../services/api-error.service';
import { TrialConversionItem } from '../../../types/admin-charges.types';
import { AdminChargesService } from '../charges/admin-charges.service';
import { ContactActions } from '../contact/contact-actions';
import { AdminCompaniesTabs } from './admin-companies-tabs';

const STAGE_LABELS = ['Só cadastro', 'Cadastrou veículo', 'Cadastrou motorista', 'Fez aluguel'];

/**
 * "Converter testes" (admin v2, D5): empresas cujo teste acabou ou acaba em
 * até 7 dias, decidido por `trial_ends_at` (nunca pelo status), e que não pagam.
 * A ordem vem do servidor: melhor para converter primeiro. "Estender teste"
 * mora no detalhe da empresa (trilha A); aqui há só o link.
 */
@Component({
  selector: 'app-admin-trial-conversion',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DefaultPageLayout, AlertBanner, RouterLink, ContactActions, AdminCompaniesTabs],
  templateUrl: './admin-trial-conversion.html',
})
export class AdminTrialConversion implements OnInit {
  private readonly service = inject(AdminChargesService);
  private readonly apiErrors = inject(ApiErrorService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly items = signal<TrialConversionItem[]>([]);
  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly includeInternal = signal(false);

  ngOnInit(): void {
    this.load();
  }

  protected toggleInternal(event: Event): void {
    this.includeInternal.set((event.target as HTMLInputElement).checked);
    this.load();
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

  protected stageChip(stage: number): string {
    if (stage >= 3) return 'bg-success-50 text-success-900 dark:bg-success-500/15 dark:text-success-100';
    if (stage >= 1) return 'bg-amber-100 text-amber-900 dark:bg-amber-500/15 dark:text-amber-100';
    return 'bg-surface-sunken text-fg-soft';
  }

  protected trialLabel(item: TrialConversionItem): string {
    const n = item.daysSinceTrialEnd;
    if (n < 0) return -n === 1 ? 'Teste acaba amanhã' : `Teste acaba em ${-n} dias`;
    if (n === 0) return 'Teste acabou hoje';
    return n === 1 ? 'Teste acabou ontem' : `Teste acabou há ${n} dias`;
  }

  /** Último acesso conhecido: presença (V122) ou, na falta, o último login. */
  protected lastAccess(item: TrialConversionItem): string {
    const iso = item.lastSeenAt ?? item.lastLoginAt;
    if (!iso) return 'Nunca registrado';
    return this.formatDate(iso);
  }

  protected formatDate(iso: string | null): string {
    if (!iso) return '—';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
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
