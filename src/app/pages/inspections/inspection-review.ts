import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { HttpErrorResponse } from '@angular/common/http';
import {
  AbstractControl,
  FormControl,
  ReactiveFormsModule,
  ValidationErrors,
  Validators,
} from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { Observable, map, of } from 'rxjs';
import { AlertBanner } from '../../components/alert-banner/alert-banner';
import { PageCard } from '../../components/core/page-card/page-card';
import { ConfirmDialog } from '../../components/core/confirm-dialog/confirm-dialog';
import { DocumentPreviewService } from '../../components/document-preview/document-preview.service';
import type { DocumentPreviewItem } from '../../components/document-preview/document-preview.types';
import { FieldControl, FormField } from '../../components/form-field/form-field';
import { DefaultPageLayout } from '../../components/layout/default-page-layout/default-page-layout';
import { ApiErrorService } from '../../services/api-error.service';
import { InspectionsService } from '../../services/inspections.service';
import { NotificationService } from '../../services/notification.service';
import { SessionService } from '../../services/session.service';
import type { Inspection, InspectionPhoto, InspectionStatus } from '../../types/inspection.types';
import { INSPECTION_STATUS_META } from '../../utils/status-maps';
import {
  AngleFrame,
  OdometerView,
  buildFrames,
  carName,
  colorAndYear,
  firstName,
  formatDate,
  formatDateTime,
  formatPhone,
  kindLabel,
  kindWord,
  odometerView,
} from './inspection-view';
import { INSPECTIONS_ROOT } from './driver/driver-inspection-guide';
import { DetailField, DriverInspectionDetail } from './driver/driver-inspection-detail';

/** Motivo em branco e motivo vazio sao a mesma coisa para quem vai ler. */
function notBlank(control: AbstractControl): ValidationErrors | null {
  return String(control.value ?? '').trim() === '' ? { required: true } : null;
}

/**
 * `/vistorias/:id` — os DETALHES da vistoria: quem, qual carro, o hodometro, as 14 fotos e,
 * para quem decide, a decisao.
 *
 * Era um componente embutido na linha da lista ("Fotos enviadas"); passou a ser uma PAGINA
 * porque 14 fotos, o hodometro e a decisao nao cabem numa linha — e porque o dono precisa
 * de um endereco para mandar "olha essa vistoria". O nome do arquivo ficou: a revisao
 * continua sendo o proposito dela.
 *
 * ## Tres papeis na mesma tela
 *
 * - OWNER/MANAGER, vistoria `SUBMITTED`: ve tudo e decide (cartao "Sua decisao").
 * - OWNER/MANAGER, outra situacao: so le. O PDF aparece quando `APPROVED`.
 * - MOTORISTA: le a PROPRIA vistoria (o servidor escopa), sem a decisao. Continuar a que
 *   esta em andamento e refazer a recusada moram na tela de captura; daqui ha um atalho.
 *
 * ## O que o servidor ja garante, e por que a tela repete
 *
 * `approve` e `reject` sao OWNER/MANAGER, travado no backend. O recorte aqui e defesa em
 * profundidade: a tela nao OFERECE o que o servidor vai recusar.
 */
@Component({
  selector: 'app-inspection-review',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ReactiveFormsModule,
    RouterLink,
    DefaultPageLayout,
    PageCard,
    AlertBanner,
    ConfirmDialog,
    FormField,
    FieldControl,
    DriverInspectionDetail,
  ],
  templateUrl: './inspection-review.html',
})
export class InspectionReview implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly service = inject(InspectionsService);
  private readonly session = inject(SessionService);
  private readonly apiErrors = inject(ApiErrorService);
  private readonly notifications = inject(NotificationService);
  private readonly preview = inject(DocumentPreviewService);
  private readonly destroyRef = inject(DestroyRef);
  /** Where the inspection screens live (`/vistorias`; the local demo mounts them elsewhere). */
  protected readonly root = inject(INSPECTIONS_ROOT);

  // ----------------------------------------------------------------- estado

  protected readonly id = signal<string>('');
  protected readonly loading = signal(true);
  protected readonly loadError = signal<string | null>(null);
  protected readonly inspection = signal<Inspection | null>(null);

  /** `null` = ainda nao chegaram (ou falharam). `[]` = chegaram e nao ha nenhuma. */
  protected readonly photos = signal<InspectionPhoto[] | null>(null);
  protected readonly photosError = signal<string | null>(null);
  protected readonly loadingPhotos = signal(false);

  /**
   * Uma URL assinada expira. Quando a imagem falha, recarregamos a lista UMA vez — o caso
   * comum e a tela ficar aberta alem da validade. Mais de uma vez seria laco: se o link novo
   * tambem falha, a causa nao e expiracao, e insistir so faz a tela piscar.
   */
  private refreshedForExpiry = false;
  protected readonly expired = signal(false);

  protected readonly rejecting = signal(false);
  protected readonly confirmingReject = signal(false);
  protected readonly deciding = signal(false);
  protected readonly decisionError = signal<string | null>(null);


  protected readonly reasonControl = new FormControl('', {
    nonNullable: true,
    validators: [notBlank, Validators.maxLength(1000)],
  });
  protected readonly reasonMessages = {
    required: 'Escreva o motivo da recusa.',
    maxlength: 'O motivo pode ter até 1000 caracteres.',
  };

  // --------------------------------------------------------------- derivados

  protected readonly role = this.session.getCompanyRoleFromToken();
  protected readonly isDriver = this.role === 'DRIVER';
  private readonly isOperator = this.role === 'OWNER' || this.role === 'MANAGER';

  protected readonly status = computed(() => this.inspection()?.status ?? 'PENDING');
  protected readonly statusMeta = computed(() => INSPECTION_STATUS_META[this.status()]);

  /** O subtitulo do cabecalho: "Retirada realizada em 09/10/2026 08:42." */
  protected readonly subtitle = computed(() => {
    const current = this.inspection();
    if (!current) return '';
    const when = formatDateTime(current.performedAt);
    return `${kindLabel(current.kind)} realizada${when ? ` em ${when}` : ''}.`;
  });

  protected readonly plate = computed(() => this.inspection()?.vehiclePlate?.trim() || null);
  protected readonly vehicle = computed(() => {
    const current = this.inspection();
    return current ? carName(current) : null;
  });
  protected readonly colorYear = computed(() => {
    const current = this.inspection();
    return current ? colorAndYear(current) : null;
  });
  protected readonly driverName = computed(() => this.inspection()?.driverName?.trim() || null);
  protected readonly driverFirstName = computed(() => firstName(this.inspection()?.driverName));
  protected readonly phone = computed(() => formatPhone(this.inspection()?.driverPhone));
  protected readonly odometer = computed<OdometerView | null>(() => {
    const current = this.inspection();
    return current ? odometerView(current) : null;
  });

  /** Os quadros: 14 angulos, com ou sem foto. Vazio ate as fotos chegarem. */
  protected readonly frames = computed<AngleFrame[]>(() => {
    const list = this.photos();
    if (list === null) return [];
    return buildFrames(list, this.inspection()?.requiredAngles);
  });

  protected readonly receivedCount = computed(
    () => this.frames().filter((f) => f.hasPhoto).length,
  );
  protected readonly totalCount = computed(() => this.frames().length);
  protected readonly missingCount = computed(() => this.totalCount() - this.receivedCount());

  /** "14 de 14 ângulos enviados. O laudo…" / "9 de 14 ângulos enviados. Faltam 5 fotos." */
  protected readonly photoSummary = computed(() => {
    const total = this.totalCount();
    const got = this.receivedCount();
    if (got === total) {
      return `${got} de ${total} ângulos enviados. O laudo em PDF é gerado a partir dessas fotos.`;
    }
    const missing = total - got;
    return `${got} de ${total} ângulos enviados. ${
      missing === 1 ? 'Falta 1 foto' : `Faltam ${missing} fotos`
    }.`;
  });

  /** Fotos que EXISTEM e nao puderam ser exibidas (a assinatura falhou). */
  protected readonly unavailable = computed(() =>
    this.frames().filter((f) => f.hasPhoto && f.signedUrl === null),
  );

  /** Recarregar serve para falha da lista e para foto que nao assinou. */
  protected readonly canRetryPhotos = computed(
    () => !this.loadingPhotos() && (this.photosError() !== null || this.unavailable().length > 0),
  );

  /** O titulo do cartao das fotos: "Vistoria de retirada". */
  protected readonly galleryTitle = computed(() => {
    const current = this.inspection();
    return current ? `Vistoria de ${kindWord(current.kind)}` : 'Vistoria';
  });

  // ------------------------------------------------------------- decisao

  /** O cartao "Sua decisao": so para quem decide, e so enquanto aguarda decisao. */
  protected readonly canDecide = computed(() => this.isOperator && this.status() === 'SUBMITTED');

  /**
   * APROVAR exige as 14 fotos VISIVEIS e o hodometro. "Nao se aprova sem ver" vale igual
   * para a falha parcial: ver 13 de 14 nao e ver, e o angulo que faltou e justamente o que
   * ninguem conferiu. Sem hodometro o servidor tambem recusa (`INSPECTION_NO_ODOMETER`).
   */
  protected readonly approveBlocked = computed(() => {
    const frames = this.frames();
    const photosOk =
      this.photos() !== null &&
      frames.length > 0 &&
      frames.every((f) => f.hasPhoto && f.signedUrl !== null);
    const odometerOk = this.inspection()?.odometerKm != null;
    return !(photosOk && odometerOk);
  });

  protected readonly rejectedReason = computed(
    () => this.inspection()?.rejectionReason?.trim() || null,
  );

  protected readonly pendingMessage = computed(() => {
    const first = this.driverFirstName() ?? 'O motorista';
    const total = this.totalCount() || 14;
    const got = this.photos() !== null ? this.receivedCount() : (this.inspection()?.photoCount ?? 0);
    return `Aguardando ${first} enviar as ${total} fotos e o hodômetro pelo celular (${got}/${total}).`;
  });

  protected readonly confirmMessage = computed(() => {
    const first = this.driverFirstName() ?? 'O motorista';
    const plate = this.plate() ?? 'do veículo';
    return `${first} será avisado e precisa refazer a vistoria do veículo «${plate}» do zero.`;
  });

  protected readonly pdfName = computed(() => {
    const current = this.inspection();
    if (!current) return 'vistoria.pdf';
    return `vistoria-${kindWord(current.kind)}-${this.plate() ?? current.id}.pdf`;
  });

  // ------------------------------------------------------------------ ciclo

  ngOnInit(): void {
    // O id vem do OBSERVAVEL: navegar de uma vistoria para outra reusa a instancia.
    this.route.paramMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((params) => {
      const id = params.get('id') ?? '';
      if (!id || id === this.id()) return;
      this.id.set(id);
      this.resetDecision();
      this.load();
    });
  }

  protected load(): void {
    const id = this.id();
    if (!id) return;
    this.loading.set(true);
    this.loadError.set(null);
    this.service.getOne(id).subscribe({
      next: (found) => {
        this.inspection.set(found);
        this.loading.set(false);
        this.loadPhotos();
      },
      error: (err: unknown) => {
        this.loading.set(false);
        this.apiErrors.claim(err);
        this.loadError.set(
          this.apiErrors.messageFor(err, 'Não foi possível carregar esta vistoria.'),
        );
      },
    });
  }

  protected loadPhotos(): void {
    const id = this.id();
    if (!id) return;
    this.loadingPhotos.set(true);
    this.photosError.set(null);

    this.service.photos(id).subscribe({
      next: (list) => {
        this.loadingPhotos.set(false);
        this.photos.set(list ?? []);
      },
      error: (err: unknown) => {
        this.loadingPhotos.set(false);
        this.photos.set(null);
        this.apiErrors.claim(err);
        this.photosError.set(
          this.apiErrors.messageFor(
            err,
            'Não conseguimos carregar as fotos desta vistoria. Sem vê-las não dá para decidir.',
          ),
        );
      },
    });
  }

  /** A imagem morreu: provavelmente a URL assinada venceu. */
  protected onImageError(): void {
    if (this.refreshedForExpiry) {
      this.expired.set(true);
      return;
    }
    this.refreshedForExpiry = true;
    this.loadPhotos();
  }

  // ---------------------------------------------------------- visualizador

  /**
   * Abre a foto no visualizador do app (`DocumentPreviewService`): galeria com anterior,
   * proxima, swipe e zoom. Entram na galeria os angulos que TEM foto — os vazios nao tem o
   * que mostrar —, na ordem do roteiro; o titulo e o angulo e a legenda diz quando a foto foi
   * tirada (numa vistoria periodica, foto de hoje e de tres semanas atras sao indistinguiveis
   * para quem aprova).
   */
  protected openViewer(angle: string): void {
    const withPhoto = this.frames().filter((f) => f.hasPhoto);
    const startIndex = withPhoto.findIndex((f) => f.angle === angle);
    if (startIndex < 0) return;
    this.preview.open({
      items: withPhoto.map((frame) => this.photoItem(frame)),
      startIndex,
    });
  }

  private photoItem(frame: AngleFrame): DocumentPreviewItem {
    const current = this.inspection();
    const stem = current
      ? `vistoria-${kindWord(current.kind)}-${this.plate() ?? current.id}`
      : 'vistoria';
    return {
      source: this.photoSource(frame.angle),
      fileName: `${stem}-${frame.angle.toLowerCase()}`,
      title: frame.label,
      // Sem ponto final: o visualizador concatena " · FORMATO · tamanho" depois da legenda.
      caption: frame.takenAt ? `Tirada em ${frame.takenAt}` : undefined,
      errorMessage: 'Esta foto não carregou agora. Ela está salva — tente de novo.',
    };
  }

  /**
   * De onde o visualizador busca os bytes da foto. A PRIMEIRA tentativa usa a URL que a tela
   * ja tem; "Tentar de novo" (e a foto cuja assinatura falhou) pede a lista outra vez, porque
   * a URL assinada expira e repetir a mesma so repetiria a falha.
   */
  private photoSource(angle: string): () => Observable<string> {
    let attempts = 0;
    return () => {
      const known = this.frames().find((f) => f.angle === angle)?.signedUrl ?? null;
      if (attempts++ === 0 && known) return of(known);
      return this.service.photos(this.id()).pipe(
        map((list) => {
          const fresh = buildFrames(list ?? [], this.inspection()?.requiredAngles).find(
            (f) => f.angle === angle,
          )?.signedUrl;
          if (!fresh) throw new Error('photo-url-unavailable');
          // A lista nova vale para a tela inteira: a proxima abertura (e as outras fotos da
          // galeria) nao comecam com a URL vencida.
          this.photos.set(list);
          return fresh;
        }),
      );
    };
  }

  // --------------------------------------------------------------- decisao

  protected approve(): void {
    if (!this.canDecide() || this.approveBlocked() || this.deciding()) return;

    this.deciding.set(true);
    this.decisionError.set(null);
    const plate = this.plate() ?? 'veículo';

    this.service.approve(this.id()).subscribe({
      next: (result) => {
        this.deciding.set(false);
        this.notifications.success(`Vistoria de «${plate}» aprovada.`);
        this.afterDecision(result.status);
      },
      error: (err: unknown) => this.failDecision(err),
    });
  }

  protected startReject(): void {
    if (!this.canDecide()) return;
    this.decisionError.set(null);
    this.rejecting.set(true);
  }

  protected cancelReject(): void {
    this.rejecting.set(false);
    this.reasonControl.reset('');
    this.decisionError.set(null);
  }

  /**
   * RECUSA EXIGE MOTIVO na tela, nao so no servidor. O backend rejeita vazio com 400, mas
   * essa recusa chegaria depois do envio e sem apontar o campo — e quem vai refotografar
   * precisa saber o que estava errado. So com motivo abre a confirmacao.
   */
  protected askRejectConfirmation(): void {
    if (!this.canDecide() || this.deciding()) return;
    this.reasonControl.markAsTouched();
    if (this.reasonControl.invalid) return;
    this.confirmingReject.set(true);
  }

  protected dismissConfirmation(): void {
    this.confirmingReject.set(false);
  }

  protected confirmReject(): void {
    this.confirmingReject.set(false);
    if (!this.canDecide() || this.deciding() || this.reasonControl.invalid) return;

    this.deciding.set(true);
    this.decisionError.set(null);
    const plate = this.plate() ?? 'veículo';
    const first = this.driverFirstName();

    this.service.reject(this.id(), this.reasonControl.value.trim()).subscribe({
      next: (result) => {
        this.deciding.set(false);
        this.notifications.success(
          `Vistoria de «${plate}» recusada. ${first ?? 'O motorista'} foi avisado.`,
        );
        this.afterDecision(result.status);
      },
      error: (err: unknown) => this.failDecision(err),
    });
  }

  /**
   * Depois da decisao o servidor mudou a vistoria: relê o detalhe. A situacao devolvida pela
   * decisao entra NA HORA, antes da releitura — sem isso o cartao "Sua decisao" ficaria na
   * tela, clicavel, ate a leitura voltar (ou para sempre, se ela falhar).
   */
  private afterDecision(status: InspectionStatus): void {
    this.inspection.update((current) => (current ? { ...current, status } : current));
    this.resetDecision();
    this.load();
  }

  private resetDecision(): void {
    this.rejecting.set(false);
    this.confirmingReject.set(false);
    this.deciding.set(false);
    this.decisionError.set(null);
    this.reasonControl.reset('');
  }

  /**
   * FALHAR NAO E DECIDIR. Em erro nada muda na tela — o motivo digitado FICA, para a pessoa
   * nao redigitar — e a mensagem do servidor (em portugues, p.ex. "aprovar exige o
   * hodometro") e a que aparece.
   */
  private failDecision(err: unknown): void {
    this.deciding.set(false);
    this.apiErrors.claim(err);
    if (err instanceof HttpErrorResponse && err.status === 403) {
      this.decisionError.set(
        'Só o dono ou o gerente da empresa pode aprovar ou recusar uma vistoria.',
      );
      return;
    }
    this.decisionError.set(
      this.apiErrors.messageFor(
        err,
        'Não conseguimos registrar sua decisão agora. Nada foi alterado — tente de novo.',
      ),
    );
  }

  // -------------------------------------------------------------------- PDF

  /**
   * Abre o laudo no visualizador do app (`DocumentPreviewService`, pdf.js), nunca numa aba
   * nova. O modal abre no toque, pede a URL assinada e mostra a falha (inclusive a
   * mensagem do servidor, ex. laudo ainda não gerado) dentro dele, com "Tentar de novo".
   */
  protected viewReport(): void {
    this.preview.open({
      source: () => this.service.reportUrl(this.id()),
      fileName: this.pdfName(),
      title: 'Laudo da vistoria',
      caption: this.pdfName(),
      errorMessage: 'Não foi possível abrir o laudo agora. Tente de novo.',
    });
  }

  // ------------------------------------------------------- motorista (prototipo)

  /** "Retirada · 04/08/2026." — the driver's subtitle, as in the prototype. */
  protected readonly driverSubtitle = computed(() => {
    const current = this.inspection();
    if (!current) return '';
    const when = formatDate(current.performedAt);
    return `${kindLabel(current.kind)}${when ? ` · ${when}` : ''}.`;
  });

  /** "Resumo": vehicle, colour and year, kind, odometer. Absent data reads "—", never zero. */
  protected readonly driverFields = computed<DetailField[]>(() => {
    const current = this.inspection();
    if (!current) return [];
    const vehicle = [this.plate(), this.vehicle()].filter(Boolean).join(' · ');
    return [
      { label: 'Veículo', value: vehicle || '—' },
      { label: 'Cor e ano', value: this.colorYear() ?? '—' },
      { label: 'Tipo', value: kindLabel(current.kind) },
      { label: 'Hodômetro informado', value: this.odometer()?.value ?? '—' },
    ];
  });

  protected readonly captureLink = computed(() => [this.root, this.id(), 'captura']);
}
