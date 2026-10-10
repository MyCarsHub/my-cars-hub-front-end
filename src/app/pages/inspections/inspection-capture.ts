import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  OnDestroy,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { HttpErrorResponse } from '@angular/common/http';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { AlertBanner } from '../../components/alert-banner/alert-banner';
import { PageCard } from '../../components/core/page-card/page-card';
import { PageLoader } from '../../components/page-loader/page-loader';
import { DefaultPageLayout } from '../../components/layout/default-page-layout/default-page-layout';
import { ApiErrorService } from '../../services/api-error.service';
import { ImageCompressionService } from '../../services/image-compression.service';
import { InspectionsService } from '../../services/inspections.service';
import { SessionService } from '../../services/session.service';
import { Inspection, InspectionKind, InspectionStatus } from '../../types/inspection.types';
// A câmera ao vivo do ALUGUEL, importada SEM alteração. O dono foi literal: "o do
// aluguel não é para mexer". Preferi o acoplamento entre pastas a extrair o
// componente para um lugar compartilhado, porque a extração mexeria em arquivos de
// `rentals` — e o contrato dela (`label` entra, `captured`/`cancelled` saem) já é
// exatamente o que esta tela precisa.
import { LiveCameraSheet } from '../rentals/documents/live-camera-sheet';
import { angleLabel } from './angle-label';

/**
 * Teto de uma foto, igual ao do backend (8 MB). A compressao no cliente reduz uma
 * foto de camera de 10-20 MB para algumas centenas de KB; este teto e a REDE: se a
 * compressao nao puder decodificar o arquivo (ela devolve o original em vez de
 * falhar) e ele passar do limite, a pessoa e avisada ANTES de gastar o upload, em
 * vez de ver um 413 depois de esperar a rede.
 */
const MAX_PHOTO_BYTES = 8 * 1024 * 1024;


/**
 * A vistoria existe; so o endereco nao trocou. Recarregar perderia a
 * retomada, entao a frase diz o que fazer para nao perde-la.
 */
const NAV_FAILED_MESSAGE =
  'A vistoria foi criada, mas não conseguimos abrir o endereço dela. ' +
  'Continue fotografando por aqui; não recarregue a página.';

/**
 * Um quadro da grade, com a MESMA forma do slot do card de aluguel
 * (`rental-inspection-card.ts`), porque a tela passou a ser a mesma coisa visualmente e
 * duas formas diferentes para o mesmo quadro divergiriam no primeiro ajuste.
 *
 * `previewUrl` e `signedUrl` existem os DOIS, e a ordem importa: o preview local aparece no
 * instante da foto, e a URL do servidor e a que sobrevive a recarga. O aluguel resolve
 * assim (`slot.previewUrl || slot.photo?.signedUrl`) e aqui e igual.
 */
interface AngleSlot {
  readonly angle: string;
  readonly label: string;
  readonly done: boolean;
  /** `objectURL` da foto que acabou de ser tirada — feedback imediato, antes do servidor. */
  readonly previewUrl: string | null;
  /** URL assinada vinda de `GET /inspections/{id}/photos`; curta e reassinada a cada carga. */
  readonly signedUrl: string | null;
  /** `true` so no quadro cuja foto esta subindo AGORA — o envio e um por vez. */
  readonly uploading: boolean;
  /** Em que passo esta a foto deste quadro; `null` = parada. */
  readonly phase: 'compressing' | 'uploading' | null;
  /** Por que a foto deste quadro nao subiu; `null` = nao falhou. */
  readonly failure: string | null;
  /** `true` quando reenviar o MESMO arquivo adianta (falha de rede, nao de tamanho). */
  readonly canRetry: boolean;
}

/** Uma foto que nao subiu, guardada por angulo para reenviar sem refotografar. */
interface FailedUpload {
  readonly file: File;
  readonly message: string;
  readonly retryable: boolean;
}

const STATUS_TITLES: Readonly<Record<InspectionStatus, string>> = {
  PENDING: 'Fazer vistoria',
  SUBMITTED: 'Vistoria enviada',
  APPROVED: 'Vistoria aprovada',
  REJECTED: 'Vistoria recusada',
};

@Component({
  selector: 'app-inspection-capture',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DefaultPageLayout, PageCard, PageLoader, AlertBanner, RouterLink, LiveCameraSheet],
  templateUrl: './inspection-capture.html',
})
export class InspectionCapture implements OnInit, OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly service = inject(InspectionsService);
  private readonly session = inject(SessionService);
  private readonly apiErrors = inject(ApiErrorService);
  private readonly compression = inject(ImageCompressionService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly inspection = signal<Inspection | null>(null);

  /** Ângulo sendo fotografado agora; `null` = nenhuma câmera aberta. */
  protected readonly activeAngle = signal<string | null>(null);
  protected readonly uploading = signal(false);
  /**
   * Faixa de erro da tela: a ULTIMA falha de foto, ou o aviso de endereco. A causa
   * por foto vive em `failures`, dentro do quadro de cada uma — esta faixa so da a
   * mensagem de topo para quem nao esta olhando o quadro.
   */
  protected readonly uploadError = signal<string | null>(null);

  /**
   * As fotos que FALHARAM, por angulo, guardadas para reenviar.
   *
   * Sem isto, "tente de novo" significava reabrir a camera e refotografar o
   * mesmo angulo. Na rua, em 3G, falha de upload e o caso COMUM — e refazer a
   * foto a cada falha ensina a pessoa que o aplicativo nao funciona. O arquivo
   * ja esta na memoria (e ja comprimido); reenviar o MESMO nao custa nada.
   *
   * E um mapa e nao uma unica pendencia porque o envio e um por vez mas a pessoa
   * continua fotografando: duas falhas seguidas nao podem se sobrescrever, ou a
   * primeira foto se perderia em silencio. Cada quadro mostra a sua.
   *
   * Limpo no sucesso do angulo e ao abrir a camera dele de proposito: pendente
   * que sobrevive a uma foto nova reenviaria uma foto velha.
   */
  private readonly failures = signal<Readonly<Record<string, FailedUpload>>>({});

  /**
   * O FECHAMENTO. Tres sinais, porque "enviando", "enviada" e "falhou ao
   * enviar" sao estados distintos e a pessoa precisa distinguir os tres.
   */
  protected readonly submitting = signal(false);
  protected readonly submitError = signal<string | null>(null);

  /**
   * O status que o SERVIDOR devolveu no envio nesta sessao.
   *
   * `null` = ainda nao enviamos aqui. A tela nao inventa o estado: ela repete o
   * que o backend respondeu. Vence o `status` da vistoria em memoria porque a
   * resposta do envio e mais nova que o ultimo detalhe lido.
   */
  protected readonly reviewStatus = signal<InspectionStatus | null>(null);

  /**
   * ONDE a vistoria esta no ciclo — e o que decide o que a tela oferece.
   *
   * Ausente cai em `PENDING`: um servidor que nao manda `status` e o servidor de
   * antes desta mudanca, em que a unica coisa possivel nesta tela era fotografar.
   * Este e o UNICO lugar que aplica o padrao.
   */
  protected readonly status = computed<InspectionStatus>(
    () => this.reviewStatus() ?? this.inspection()?.status ?? 'PENDING',
  );

  protected readonly submitted = computed(
    () => this.status() === 'SUBMITTED' || this.status() === 'APPROVED',
  );
  protected readonly rejected = computed(() => this.status() === 'REJECTED');
  protected readonly approved = computed(() => this.status() === 'APPROVED');

  protected readonly pageTitle = computed(() => STATUS_TITLES[this.status()]);
  protected readonly pageDescription = computed(() => {
    switch (this.status()) {
      case 'PENDING':
        return 'Fotografe cada ângulo do roteiro. Cada foto é enviada na hora.';
      case 'SUBMITTED':
        return 'As fotos foram enviadas e aguardam a decisão do dono da empresa.';
      case 'APPROVED':
        return 'Esta vistoria foi aprovada. As fotos abaixo são o registro dela.';
      case 'REJECTED':
        return 'Esta vistoria foi recusada. Veja o motivo e refaça.';
    }
  });

  /** Por que foi recusada; vazio quando o servidor nao disse (a tela nao inventa). */
  protected readonly rejectionReason = computed(
    () => (this.inspection()?.rejectionReason ?? '').trim() || null,
  );
  /** Data da decisao, ja legivel. `null` quando o servidor nao mandou ou nao e uma data. */
  protected readonly reviewedAtLabel = computed(() => {
    const iso = this.inspection()?.reviewedAt;
    if (!iso) return null;
    const date = new Date(iso);
    return Number.isNaN(date.getTime()) ? null : date.toLocaleDateString('pt-BR');
  });

  /** `Refazer vistoria`: a chamada em curso e o erro dela, que e diferente do de foto. */
  protected readonly recapturing = signal(false);
  protected readonly recaptureError = signal<string | null>(null);

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
    () => this.session.getCompanyRoleFromToken() !== 'DRIVER' && this.canCapture(),
  );

  /**
   * So `PENDING` fotografa. `SUBMITTED` e `APPROVED` ja saíram das maos de quem
   * fotografou, e `REJECTED` nao troca foto: ela vira OUTRA vistoria pelo
   * `recapture`. Continuar oferecendo camera nesses estados seria a tela
   * prometendo o que o servidor vai recusar.
   */
  protected readonly canCapture = computed(() => this.status() === 'PENDING');

  /**
   * URL assinada por angulo, de `GET /inspections/{id}/photos`.
   *
   * `signedUrl` pode vir NULA com a foto existindo (o contrato diz isso e o review ja trata):
   * nesse caso o quadro mostra que a foto esta la e nao pode ser exibida, nunca "sem foto".
   */
  private readonly signedByAngle = signal<Record<string, string | null>>({});

  /**
   * `objectURL` local por angulo, criado no instante da captura.
   *
   * E o que faz a foto VOLTAR PARA A TELA na hora, sem esperar upload nem reassinatura.
   * Revogado ao ser substituido e na saida da tela, senao cada refotografia deixa um blob
   * preso na memoria.
   */
  private readonly previewByAngle = signal<Record<string, string>>({});

  /** O angulo cuja foto esta sendo preparada/enviada agora, e em que passo. O envio e um por vez. */
  private readonly sending = signal<{ angle: string; phase: 'compressing' | 'uploading' } | null>(
    null,
  );

  /** Os ângulos vêm da VISTORIA (retrato do roteiro no dia), nunca de lista fixa. */
  protected readonly slots = computed<AngleSlot[]>(() => {
    const current = this.inspection();
    if (!current) return [];
    const done = new Set(current.capturedAngles);
    const signed = this.signedByAngle();
    const preview = this.previewByAngle();
    const sending = this.sending();
    const failed = this.failures();
    return current.requiredAngles.map((angle) => ({
      angle,
      label: angleLabel(angle),
      done: done.has(angle),
      previewUrl: preview[angle] ?? null,
      signedUrl: signed[angle] ?? null,
      uploading: sending?.angle === angle,
      phase: sending?.angle === angle ? sending.phase : null,
      failure: failed[angle]?.message ?? null,
      canRetry: failed[angle]?.retryable ?? false,
    }));
  });

  protected readonly doneCount = computed(() => this.slots().filter((s) => s.done).length);
  protected readonly totalCount = computed(() => this.slots().length);
  protected readonly isComplete = computed(
    () => this.totalCount() > 0 && this.doneCount() === this.totalCount(),
  );

  /** Os angulos que ainda nao tem foto — o que o passo de finalizar tem de nomear. */
  protected readonly missingSlots = computed(() => this.slots().filter((s) => !s.done));

  protected readonly missingSummary = computed(() => {
    const missing = this.missingSlots().length;
    return missing === 1
      ? 'Falta 1 foto para poder finalizar.'
      : `Faltam ${missing} fotos para poder finalizar.`;
  });

  protected readonly activeLabel = computed(() => {
    const angle = this.activeAngle();
    return angle ? angleLabel(angle) : '';
  });

  ngOnInit(): void {
    // O id vem do OBSERVAVEL e nao so do snapshot: depois de `recapture` a URL troca de
    // `/vistorias/A/captura` para `/vistorias/B/captura`, e o Angular REUSA esta
    // instancia para a mesma rota. Sem ouvir a mudanca, "voltar" no navegador deixaria
    // na tela a vistoria B sob o endereco de A.
    this.route.paramMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((params) => {
      const id = params.get('id');
      if (id) {
        // A navegacao que NOS mesmos fizemos (criar/refazer) cai aqui com o id que
        // a tela ja esta mostrando — recarregar so repetiria a leitura.
        if (this.inspection()?.id !== id && this.loadingId !== id) this.load(id);
        return;
      }
      if (this.inspection() === null && this.loading()) this.startNew();
    });
  }

  private startNew(): void {
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
        this.goTo(created.id);
      },
      error: (err: unknown) => this.fail(err, 'Não foi possível iniciar a vistoria.'),
    });
  }

  /**
   * Aponta o endereco para a vistoria que a tela ja esta mostrando.
   *
   * A promessa NAO e descartada: `void router.navigate(...)` engolia os dois modos
   * de falha — `false` (um guard recusou) e a rejeicao —, e nos dois a pessoa ficava
   * olhando uma tela que nao mudou, sem nada a fazer.
   *
   * A vistoria JA EXISTE aqui: o fracasso e so do endereco, e o que se perde e a
   * retomada. Por isso a mensagem e acionavel e nomeia o efeito real.
   */
  private goTo(id: string): void {
    this.router
      .navigate(['/vistorias', id, 'captura'], { replaceUrl: true })
      .then((ok) => {
        if (!ok) this.uploadError.set(NAV_FAILED_MESSAGE);
      })
      .catch(() => this.uploadError.set(NAV_FAILED_MESSAGE));
  }

  /** A vistoria cuja leitura esta em curso — a navegacao propria nao dispara uma segunda. */
  private loadingId: string | null = null;

  private load(id: string): void {
    this.resetCapture();
    this.loading.set(true);
    this.error.set(null);
    this.loadingId = id;
    this.service.getOne(id).subscribe({
      next: (found) => {
        this.loadingId = null;
        this.inspection.set(found);
        this.loading.set(false);
        // Quem CONTINUA uma vistoria precisa ver o que ja fotografou: sem isto, reabrir a
        // tela mostrava quadros vazios para angulos que estao no servidor.
        this.loadPhotos(id);
      },
      error: (err: unknown) => {
        this.loadingId = null;
        this.fail(err, 'Não foi possível abrir esta vistoria.');
      },
    });
  }

  /** Zera o que pertence a UMA vistoria — trocar de vistoria nao herda foto nem erro da outra. */
  private resetCapture(): void {
    for (const url of Object.values(this.previewByAngle())) URL.revokeObjectURL(url);
    this.previewByAngle.set({});
    this.signedByAngle.set({});
    this.failures.set({});
    this.reviewStatus.set(null);
    this.sending.set(null);
    this.uploading.set(false);
    this.activeAngle.set(null);
    this.uploadError.set(null);
    this.submitError.set(null);
    this.recaptureError.set(null);
  }

  protected openCamera(angle: string): void {
    if (!this.canCapture()) return;
    this.uploadError.set(null);
    this.dropFailure(angle);
    this.activeAngle.set(angle);
  }

  /**
   * REENVIA o arquivo que falhou naquele angulo — nao abre a camera.
   *
   * Fotografar de novo continua possivel pelo quadro; o que muda e que deixou de ser
   * a UNICA saida depois de um erro de rede.
   */
  protected retryUpload(angle: string): void {
    if (this.uploading()) return;
    const failed = this.failures()[angle];
    if (!failed?.retryable) return;
    this.upload(angle, failed.file);
  }

  protected closeCamera(): void {
    this.activeAngle.set(null);
  }

  /**
   * Le a lista de fotos e guarda a URL assinada por angulo.
   *
   * Falha em SILENCIO de proposito: o preview local ja mostra o que foi fotografado nesta
   * sessao, e a tela existe para FOTOGRAFAR. Transformar uma falha de reassinatura em faixa
   * de erro pararia a captura por causa da miniatura — o contrario da prioridade.
   */
  private loadPhotos(id: string): void {
    this.service.photos(id).subscribe({
      next: (photos) => {
        const map: Record<string, string | null> = {};
        for (const photo of photos ?? []) {
          map[photo.angle] = photo.signedUrl;
        }
        this.signedByAngle.set(map);
      },
      error: () => undefined,
    });
  }

  /** Troca o preview local do angulo, revogando o anterior para nao vazar blob. */
  private setPreview(angle: string, file: File): void {
    const anterior = this.previewByAngle()[angle];
    if (anterior) URL.revokeObjectURL(anterior);
    this.previewByAngle.update((map) => ({ ...map, [angle]: URL.createObjectURL(file) }));
  }

  /**
   * Revoga TODOS os previews na saida.
   *
   * Cada foto tirada cria um `objectURL`, e eles nao sao coletados sozinhos: numa vistoria de
   * 14 angulos, refotografar algumas vezes deixaria dezenas de blobs presos pelo resto da
   * sessao. O card de aluguel faz o mesmo.
   */
  ngOnDestroy(): void {
    for (const url of Object.values(this.previewByAngle())) {
      URL.revokeObjectURL(url);
    }
  }

  /** Foto da galeria — só chega aqui para OWNER/MANAGER; o template esconde do motorista. */
  protected onFilePicked(event: Event, angle: string): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (file) void this.send(angle, file);
  }

  protected onCaptured(file: File): void {
    const angle = this.activeAngle();
    this.activeAngle.set(null);
    if (angle) void this.send(angle, file);
  }

  private dropFailure(angle: string): void {
    if (!this.failures()[angle]) return;
    this.failures.update((map) => {
      const next = { ...map };
      delete next[angle];
      return next;
    });
  }

  private recordFailure(angle: string, file: File, message: string, retryable: boolean): void {
    this.failures.update((map) => ({ ...map, [angle]: { file, message, retryable } }));
    this.uploadError.set(message);
  }

  /**
   * Prepara e sobe UMA foto.
   *
   * O preview local entra no quadro no instante da captura, ANTES da compressao e da
   * rede — na rua, em 3G, esperar o servidor para ver a foto e muito tempo. Depois a
   * foto e REDUZIDA no cliente: o celular produz arquivos de 10-20 MB e o backend
   * recusa acima de 8 MB, entao subir o original era perder a foto na rede para ouvir
   * um 413. O servico de compressao nunca lanca; sem decodificar, devolve o original.
   */
  private async send(angle: string, raw: File): Promise<void> {
    const current = this.inspection();
    if (!current || this.uploading() || !this.canCapture()) return;

    this.setPreview(angle, raw);
    this.uploading.set(true);
    this.uploadError.set(null);
    this.dropFailure(angle);
    this.sending.set({ angle, phase: 'compressing' });

    const file = await this.compression.compress(raw);

    if (file.size > MAX_PHOTO_BYTES) {
      // Reenviar o MESMO arquivo falharia de novo: so uma foto nova resolve. Por isso
      // a falha nao e reenviavel, e a mensagem manda fotografar.
      this.uploading.set(false);
      this.sending.set(null);
      this.recordFailure(
        angle,
        file,
        'Esta foto é grande demais para enviar (limite de 8 MB). Fotografe de novo.',
        false,
      );
      return;
    }

    this.upload(angle, file);
  }

  /**
   * Sobe o arquivo ja pronto e adota a vistoria que volta.
   *
   * A resposta traz `capturedAngles` atualizado, então o progresso vem do SERVIDOR e
   * não de um contador local que poderia divergir depois de um erro.
   */
  private upload(angle: string, file: File): void {
    const current = this.inspection();
    if (!current) return;

    this.uploading.set(true);
    this.uploadError.set(null);
    this.dropFailure(angle);
    this.sending.set({ angle, phase: 'uploading' });

    this.service.uploadPhoto(current.id, angle, file).subscribe({
      next: (updated) => {
        this.inspection.set(updated);
        this.uploading.set(false);
        this.sending.set(null);
        // A URL assinada so existe depois de a foto estar no servidor; e ela que sobrevive
        // a uma recarga, entao vale reler a lista.
        this.loadPhotos(current.id);
      },
      error: (err: unknown) => {
        this.uploading.set(false);
        this.sending.set(null);

        // 409/400 com a vistoria fora de `PENDING`: alguem a enviou ou decidiu enquanto esta
        // tela estava aberta (outra aba, o dono). Reenviar nao adianta, e a tela precisa
        // refletir o estado real — le o detalhe e deixa o `status` mandar.
        if (err instanceof HttpErrorResponse && (err.status === 409 || err.status === 400)) {
          this.recordFailure(
            angle,
            file,
            this.apiErrors.messageFor(
              err,
              'Esta vistoria não aceita mais fotos. Atualize a tela para ver o estado dela.',
            ),
            false,
          );
          this.refreshStatus(current.id);
          return;
        }

        // A foto FICA guardada: o erro nao pode custar a foto que ela acabou de
        // tirar. Falha de UMA foto tambem nao derruba a tela — as anteriores ja
        // estao no servidor. Era esse o ponto de subir uma a uma.
        this.recordFailure(
          angle,
          file,
          this.apiErrors.messageFor(
            err,
            'Não foi possível enviar esta foto. Ela não se perdeu — reenvie.',
          ),
          true,
        );
      },
    });
  }

  /** Releitura silenciosa do detalhe, so para a tela alcancar o `status` real. */
  private refreshStatus(id: string): void {
    this.service.getOne(id).subscribe({
      next: (found) => {
        this.inspection.set(found);
        this.reviewStatus.set(null);
      },
      error: () => undefined,
    });
  }

  /**
   * REFAZ uma vistoria recusada: pede uma NOVA, `PENDING`, e passa a operar nela.
   *
   * Nao existe "reabrir a mesma": a recusada fica como historico e a nova nasce com o
   * roteiro zerado. Por isso a tela troca a vistoria em memoria e o endereco, e nao
   * so o `status`. Clique unico — `recapturing` segura o toque repetido.
   */
  protected recapture(): void {
    const current = this.inspection();
    if (!current || !this.rejected() || this.recapturing()) return;

    this.recapturing.set(true);
    this.recaptureError.set(null);

    this.service.recapture(current.id).subscribe({
      next: (created) => {
        this.recapturing.set(false);
        this.resetCapture();
        if (Array.isArray(created.requiredAngles)) {
          this.inspection.set(created);
          this.goTo(created.id);
        } else {
          // Resposta sem o roteiro: a tela nao adivinha, le o detalhe da nova.
          this.load(created.id);
          this.goTo(created.id);
        }
      },
      error: (err: unknown) => {
        this.recapturing.set(false);
        this.recaptureError.set(
          this.apiErrors.messageFor(
            err,
            'Não foi possível refazer a vistoria agora. Tente de novo em instantes.',
          ),
        );
      },
    });
  }

  /**
   * ENTREGA a vistoria. Chamado SO pelo clique — nunca por `isComplete()` virar
   * verdadeiro.
   *
   * Os tres guardas da primeira linha nao sao defensividade decorativa:
   * incompleto o botao nem existe (mas um duplo-toque no limite da ultima foto
   * chegaria aqui), `submitting` evita a segunda chamada do toque repetido — que
   * no celular e a regra, nao a excecao — e `canCapture` evita reenviar o que
   * ja saiu.
   */
  protected submitInspection(): void {
    const current = this.inspection();
    if (!current || !this.isComplete() || this.submitting() || !this.canCapture()) {
      return;
    }

    this.submitting.set(true);
    this.submitError.set(null);

    this.service.submit(current.id).subscribe({
      /*
       * NAO faca `inspection.set(result)` aqui.
       *
       * `result` e um `InspectionReviewResult`: nao tem `requiredAngles` nem
       * `capturedAngles`. Sobrescrever a vistoria com ele esvazia o cartao de
       * progresso e a lista de angulos no instante do envio — era o defeito
       * desta linha, e o TypeScript nao o pegava porque a forma so diverge em
       * runtime. Da resposta sai o STATUS; os angulos ficam onde estao.
       *
       * `dueAt` vem na resposta e NAO e usado aqui de proposito: ele e a data
       * devida do ciclo, e o ciclo so FECHA na aprovacao. Mostra-lo apos o
       * envio diria que algo se resolveu quando nada se resolveu ainda.
       */
      next: (result) => {
        this.submitting.set(false);
        this.reviewStatus.set(result.status);
      },
      error: (err: unknown) => {
        this.submitting.set(false);
        this.apiErrors.claim(err);
        this.submitError.set(this.submitFailureMessage(err));
      },
    });
  }

  /**
   * A frase da FALHA DE ENVIO, e ela tem de negar as DUAS leituras erradas.
   *
   * As fotos sobem UMA A UMA e ja estao no servidor, entao falhar aqui nao
   * perdeu trabalho nenhum. Mas a pessoa acabou de tocar em "finalizar" e esta
   * em pe na rua: sem dizer isso explicitamente ela conclui que perdeu as 14
   * fotos — ou, pior, que a vistoria foi entregue quando nao foi. Por isso a
   * mensagem afirma o estado real (fotos salvas, envio nao concluido) em vez de
   * so repetir o erro do servidor.
   */
  private submitFailureMessage(err: unknown): string {
    if (err instanceof HttpErrorResponse && err.status === 403) {
      return (
        'Suas fotos estão salvas, mas você não tem permissão para finalizar esta ' +
        'vistoria. Peça ao dono ou ao gerente da empresa para finalizar.'
      );
    }

    return this.apiErrors.messageFor(
      err,
      'Não conseguimos finalizar a vistoria agora. Suas fotos estão salvas — ' +
        'nada foi perdido. Tente enviar de novo.',
    );
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
