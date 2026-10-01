import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { AlertBanner } from '../../components/alert-banner/alert-banner';
import { DefaultPageLayout } from '../../components/layout/default-page-layout/default-page-layout';
import { ApiErrorService } from '../../services/api-error.service';
import { InspectionsService } from '../../services/inspections.service';
import { SessionService } from '../../services/session.service';
import { Inspection, InspectionKind } from '../../types/inspection.types';
// A câmera ao vivo do ALUGUEL, importada SEM alteração. O dono foi literal: "o do
// aluguel não é para mexer". Preferi o acoplamento entre pastas a extrair o
// componente para um lugar compartilhado, porque a extração mexeria em arquivos de
// `rentals` — e o contrato dela (`label` entra, `captured`/`cancelled` saem) já é
// exatamente o que esta tela precisa.
import { LiveCameraSheet } from '../rentals/documents/live-camera-sheet';

/** Rótulo legível do ângulo — o backend manda a chave, a tela mostra o nome. */
function angleLabel(angle: string): string {
  const text = angle.replace(/_/g, ' ').toLowerCase();
  return text.charAt(0).toUpperCase() + text.slice(1);
}

interface AngleSlot {
  readonly angle: string;
  readonly label: string;
  readonly done: boolean;
}

@Component({
  selector: 'app-inspection-capture',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DefaultPageLayout, AlertBanner, RouterLink, LiveCameraSheet],
  templateUrl: './inspection-capture.html',
})
export class InspectionCapture implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly service = inject(InspectionsService);
  private readonly session = inject(SessionService);
  private readonly apiErrors = inject(ApiErrorService);

  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly inspection = signal<Inspection | null>(null);

  /** Ângulo sendo fotografado agora; `null` = nenhuma câmera aberta. */
  protected readonly activeAngle = signal<string | null>(null);
  protected readonly uploading = signal(false);
  protected readonly uploadError = signal<string | null>(null);

  /**
   * MOTORISTA SÓ FOTOGRAFA NO MOMENTO — sem galeria. Não é preferência de UI.
   *
   * Uma foto da galeria pode ser de outro dia ou de outro carro, e é exatamente isso
   * que a vistoria existe para impedir: ela vale como registro do estado do veículo
   * NAQUELE instante. Para OWNER e MANAGER a galeria é aceitável porque eles são quem
   * responde pela frota e às vezes precisam anexar uma foto tirada minutos antes.
   *
   * Se você veio "uniformizar as três experiências" numa limpeza: isto é um controle,
   * não uma inconsistência. Removê-lo mata a garantia sem ninguém notar.
   */
  protected readonly canPickFromGallery = computed(
    () => this.session.getCompanyRoleFromToken() !== 'DRIVER',
  );

  /** Os ângulos vêm da VISTORIA (retrato do roteiro no dia), nunca de lista fixa. */
  protected readonly slots = computed<AngleSlot[]>(() => {
    const current = this.inspection();
    if (!current) return [];
    const done = new Set(current.capturedAngles);
    return current.requiredAngles.map((angle) => ({
      angle,
      label: angleLabel(angle),
      done: done.has(angle),
    }));
  });

  protected readonly doneCount = computed(() => this.slots().filter((s) => s.done).length);
  protected readonly totalCount = computed(() => this.slots().length);
  protected readonly isComplete = computed(
    () => this.totalCount() > 0 && this.doneCount() === this.totalCount(),
  );

  /** O próximo ângulo sem foto — o que o botão principal abre. */
  protected readonly nextPending = computed(() => this.slots().find((s) => !s.done) ?? null);

  protected readonly activeLabel = computed(() => {
    const angle = this.activeAngle();
    return angle ? angleLabel(angle) : '';
  });

  ngOnInit(): void {
    const existing = this.route.snapshot.paramMap.get('id');
    if (existing) {
      // RETOMADA: a vistoria já existe e `capturedAngles` diz o que falta.
      this.load(existing);
      return;
    }

    const vehicleId = (this.route.snapshot.queryParamMap.get('vehicleId') ?? '').trim();
    if (!vehicleId) {
      this.error.set('Escolha um veículo para iniciar a vistoria.');
      this.loading.set(false);
      return;
    }

    const rentalId = this.route.snapshot.queryParamMap.get('rentalId');
    const kind = (this.route.snapshot.queryParamMap.get('kind') ?? 'FLEET') as InspectionKind;

    this.service.create({ vehicleId, rentalId: rentalId || null, kind }).subscribe({
      next: (created) => {
        this.inspection.set(created);
        this.loading.set(false);
        // A URL passa a apontar para a vistoria criada: recarregar a página ou voltar
        // a ela depois retoma em vez de abrir uma segunda vistoria do mesmo carro.
        void this.router.navigate(['/vistorias', created.id, 'captura'], {
          replaceUrl: true,
        });
      },
      error: (err: unknown) => this.fail(err, 'Não foi possível iniciar a vistoria.'),
    });
  }

  private load(id: string): void {
    this.service.getOne(id).subscribe({
      next: (found) => {
        this.inspection.set(found);
        this.loading.set(false);
      },
      error: (err: unknown) => this.fail(err, 'Não foi possível abrir esta vistoria.'),
    });
  }

  protected openCamera(angle: string): void {
    this.uploadError.set(null);
    this.activeAngle.set(angle);
  }

  protected closeCamera(): void {
    this.activeAngle.set(null);
  }

  /** Foto da galeria — só chega aqui para OWNER/MANAGER; o template esconde do motorista. */
  protected onFilePicked(event: Event, angle: string): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (file) this.send(angle, file);
  }

  protected onCaptured(file: File): void {
    const angle = this.activeAngle();
    this.activeAngle.set(null);
    if (angle) this.send(angle, file);
  }

  /**
   * Sobe UMA foto e adota a vistoria que volta.
   *
   * A resposta traz `capturedAngles` atualizado, então o progresso vem do SERVIDOR e
   * não de um contador local que poderia divergir depois de um erro.
   */
  private send(angle: string, file: File): void {
    const current = this.inspection();
    if (!current || this.uploading()) return;

    this.uploading.set(true);
    this.uploadError.set(null);

    this.service.uploadPhoto(current.id, angle, file).subscribe({
      next: (updated) => {
        this.inspection.set(updated);
        this.uploading.set(false);
      },
      error: (err: unknown) => {
        this.uploading.set(false);
        // Falha de UMA foto não derruba a tela: as anteriores já estão no servidor e o
        // usuário repete só esta. Era esse o ponto de subir uma a uma.
        this.uploadError.set(
          this.apiErrors.messageFor(err, 'Não foi possível enviar esta foto. Tente de novo.'),
        );
      },
    });
  }

  private fail(err: unknown, fallback: string): void {
    this.loading.set(false);
    this.apiErrors.claim(err);

    // O backend decide QUEM vistoria QUAL veículo (OWNER/MANAGER qualquer um da
    // empresa; DRIVER só o de um aluguel ATIVO dele). Um 403 aqui não é falha: é essa
    // regra. A frase explica a regra em vez de mostrar o erro cru.
    if (err instanceof HttpErrorResponse && err.status === 403) {
      this.error.set(
        'Você não pode vistoriar este veículo. Motoristas só vistoriam o carro de um ' +
          'aluguel ativo; para os demais, peça ao dono ou ao gerente da empresa.',
      );
      return;
    }

    this.error.set(this.apiErrors.messageFor(err, fallback));
  }
}
