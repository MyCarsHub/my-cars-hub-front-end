import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { ActivatedRoute, RouterLink } from '@angular/router';

import { PaintedCard } from '../../components/core/painted-card/painted-card';
import { StatusChip } from '../../components/core/status-chip/status-chip';
import { DefaultPageLayout } from '../../components/layout/default-page-layout/default-page-layout';
import { AdjustmentsService } from '../../services/adjustments.service';
import { ApiErrorService } from '../../services/api-error.service';
import { NotificationService } from '../../services/notification.service';
import { Adjustment } from '../../types/adjustment.types';
import { formatBRL } from '../../types/dashboard.types';
import {
  adjustmentStatusMeta,
  brDate,
  brDateTime,
  historyRow,
} from '../../utils/adjustments-view';
import { todayInBusinessTz } from '../../utils/business-clock';

type HeroTone = 'orange' | 'green' | 'plain';

/**
 * Detalhe do ajuste (DtAjuste): o motorista é o título, o status muda só no chip, o valor em
 * cartão pintado. Sem Editar e sem Excluir; as ações do canvas (Cancelar cobrança, Marcar como
 * paga, Enviar ao motorista) não existem no back-end e não são desenhadas. Atrasada não é
 * reemitida nem muda de data: o mesmo Pix continua valendo.
 */
@Component({
  selector: 'app-adjustment-detail',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, DefaultPageLayout, PaintedCard, StatusChip],
  templateUrl: './adjustment-detail.html',
})
export class AdjustmentDetail implements OnInit {
  private readonly adjustmentsService = inject(AdjustmentsService);
  private readonly apiErrors = inject(ApiErrorService);
  private readonly notifications = inject(NotificationService);
  private readonly route = inject(ActivatedRoute);

  private readonly today = todayInBusinessTz();

  protected readonly adjustment = signal<Adjustment | null>(null);
  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly copying = signal(false);

  protected readonly meta = computed(() => {
    const a = this.adjustment();
    return a ? adjustmentStatusMeta(a.status, a.dueDate, this.today) : null;
  });

  protected readonly hero = computed<{ tone: HeroTone; kicker: string; text: string } | null>(() => {
    const a = this.adjustment();
    const m = this.meta();
    if (!a || !m) return null;
    const due = brDate(a.dueDate);
    switch (m.key) {
      case 'PENDING':
        return { tone: 'orange', kicker: 'A receber', text: `Vence em ${due} · o motorista paga por Pix.` };
      case 'PAST_DUE':
        return {
          tone: 'orange',
          kicker: `Atrasada desde ${due}`,
          text: 'O Pix continua valendo pelo mesmo código. A cobrança não é reemitida nem muda de data.',
        };
      case 'PAID':
        return {
          tone: 'green',
          kicker: 'Recebido',
          text: a.paidAt ? `Pago por Pix em ${brDate(a.paidAt)}.` : 'Pago por Pix.',
        };
      case 'ISSUING':
        return {
          tone: 'plain',
          kicker: 'Emitindo',
          text: 'O Pix está sendo emitido no Asaas e fica pronto em alguns minutos. Nada mais precisa ser feito.',
        };
      case 'ISSUE_FAILED':
        return {
          tone: 'plain',
          kicker: 'Não emitida',
          text: a.failureReason
            ? `${a.failureReason} Nada foi cobrado do motorista.`
            : 'A emissão não foi concluída. Nada foi cobrado do motorista.',
        };
      case 'CANCELED':
        return {
          tone: 'plain',
          kicker: 'Cancelada',
          text: a.canceledAt
            ? `Cancelada em ${brDate(a.canceledAt)}. Nada foi cobrado do motorista.`
            : 'Cancelada. Nada foi cobrado do motorista.',
        };
      default:
        return { tone: 'plain', kicker: m.label, text: `Vencimento em ${due}.` };
    }
  });

  protected readonly canCopyPix = computed(() => {
    const a = this.adjustment();
    return !!a && a.pixAvailable && !!a.rentalId && !!a.chargeId && !!this.meta()?.open;
  });

  protected readonly history = computed(() => (this.adjustment()?.history ?? []).map(historyRow));

  ngOnInit(): void {
    this.load();
  }

  protected load(): void {
    const id = this.route.snapshot.paramMap.get('id');
    if (!id) {
      this.error.set('Ajuste não encontrado.');
      return;
    }
    this.loading.set(true);
    this.error.set(null);
    this.adjustmentsService.getOne(id).subscribe({
      next: (a) => {
        this.adjustment.set(a);
        this.loading.set(false);
      },
      error: (err: HttpErrorResponse) => {
        this.error.set(this.apiErrors.messageFor(err, 'Ajuste não encontrado.'));
        this.loading.set(false);
      },
    });
  }

  protected money(cents: number): string {
    return formatBRL(cents);
  }

  protected date(iso: string | null): string {
    return brDate(iso);
  }

  protected dateTime(iso: string | null): string {
    return brDateTime(iso);
  }

  protected copyPix(): void {
    const a = this.adjustment();
    if (!a?.rentalId || !a.chargeId || this.copying()) return;
    this.copying.set(true);
    this.adjustmentsService.pix(a.rentalId, a.chargeId).subscribe({
      next: async (payload) => {
        try {
          await navigator.clipboard.writeText(payload);
          this.notifications.success('Pix copia-e-cola copiado.');
        } catch {
          this.notifications.error('Não foi possível copiar o Pix neste aparelho.');
        }
        this.copying.set(false);
      },
      error: (err: unknown) => {
        this.copying.set(false);
        this.notifications.error(this.apiErrors.messageFor(err, 'Não foi possível obter o Pix.'));
      },
    });
  }
}
