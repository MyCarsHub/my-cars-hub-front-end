import {
  ChangeDetectionStrategy,
  Component,
  OnDestroy,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { AlertBanner } from '../../components/alert-banner/alert-banner';
import { PageCard } from '../../components/core/page-card/page-card';
import { DefaultPageLayout } from '../../components/layout/default-page-layout/default-page-layout';
import { ApiErrorService } from '../../services/api-error.service';
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
}

@Component({
  selector: 'app-inspection-capture',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DefaultPageLayout, PageCard, AlertBanner, RouterLink, LiveCameraSheet],
  templateUrl: './inspection-capture.html',
})
export class InspectionCapture implements OnInit, OnDestroy {
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
   * A foto que FALHOU ao subir, guardada para reenviar.
   *
   * Sem isto, "tente de novo" significava reabrir a camera e refotografar o
   * mesmo angulo. Na rua, em 3G, falha de upload e o caso COMUM — e refazer a
   * foto a cada falha ensina a pessoa que o aplicativo nao funciona. O arquivo
   * ja esta na memoria; reenviar o MESMO nao custa nada.
   *
   * Limpo no sucesso e ao abrir a camera de proposito: pendente que sobrevive
   * ao proximo envio reenviaria uma foto velha.
   */
  private readonly pendingUpload = signal<{ angle: string; file: File } | null>(null);
  protected readonly canRetryUpload = computed(() => this.pendingUpload() !== null);

  /**
   * O FECHAMENTO. Tres sinais, porque "enviando", "enviada" e "falhou ao
   * enviar" sao estados distintos e a pessoa precisa distinguir os tres.
   *
   * `submitted` e local e nao vem do servidor: `Inspection` nao tem campo de
   * status, e eu nao invento um para o tipo casar — seria contrato que o
   * backend nao prometeu.
   */
  protected readonly submitting = signal(false);
  protected readonly submitError = signal<string | null>(null);

  /**
   * O status que o SERVIDOR devolveu no envio — nao um booleano local.
   *
   * `null` = ainda nao enviamos nesta sessao. A tela nao inventa o estado: ela
   * repete o que o backend respondeu.
   */
  protected readonly reviewStatus = signal<InspectionStatus | null>(null);

  protected readonly submitted = computed(
    () => this.reviewStatus() === 'SUBMITTED' || this.reviewStatus() === 'APPROVED',
  );

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
    () => this.session.getCompanyRoleFromToken() !== 'DRIVER' && !this.submitted(),
  );

  /**
   * Depois de ENVIADA a vistoria sai das maos de quem fotografou: o dono aprova
   * ou recusa, e ate isso ela nao troca mais foto nenhuma. Continuar oferecendo
   * camera e refoto seria a tela prometendo o que o servidor vai recusar — o
   * mesmo defeito da porta pintada de aberta, de novo.
   */
  protected readonly canCapture = computed(() => !this.submitted());

  /**
   * URL assinada por angulo, de `GET /inspections/{id}/photos`.
   *
   * A tela NAO buscava foto nenhuma: o `done` vinha de `capturedAngles` e o retorno visual
   * era um circulo com check. Mostrar a foto de verdade — que e o padrao do card de aluguel
   * — exige a lista de fotos, entao esta busca e parte do conserto e nao enfeite.
   *
   * `signedUrl` pode vir NULA com a foto existindo (o contrato diz isso e o review ja trata):
   * nesse caso o quadro mostra que a foto esta la e nao pode ser exibida, nunca "sem foto".
   */
  private readonly signedByAngle = signal<Record<string, string | null>>({});

  /**
   * `objectURL` local por angulo, criado no instante da captura.
   *
   * E o que faz a foto VOLTAR PARA A TELA na hora, sem esperar upload nem reassinatura — o
   * mesmo recurso do card de aluguel. Revogado ao ser substituido e na saida da tela, senao
   * cada refotografia deixa um blob preso na memoria.
   */
  private readonly previewByAngle = signal<Record<string, string>>({});

  /** O angulo cuja foto esta subindo agora. O envio e um por vez. */
  private readonly sendingAngle = signal<string | null>(null);

  /** Os ângulos vêm da VISTORIA (retrato do roteiro no dia), nunca de lista fixa. */
  protected readonly slots = computed<AngleSlot[]>(() => {
    const current = this.inspection();
    if (!current) return [];
    const done = new Set(current.capturedAngles);
    const signed = this.signedByAngle();
    const preview = this.previewByAngle();
    const sending = this.sendingAngle();
    return current.requiredAngles.map((angle) => ({
      angle,
      label: angleLabel(angle),
      done: done.has(angle),
      previewUrl: preview[angle] ?? null,
      signedUrl: signed[angle] ?? null,
      uploading: sending === angle,
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
        /*
         * LOW-2 — a promessa NAO e descartada.
         *
         * `void router.navigate(...)` engolia os dois modos de falha: `false`
         * (um guard recusou) e a rejeicao (erro no roteamento). Nos dois a
         * pessoa ficava olhando uma tela que nao mudou, sem nada a fazer — a
         * mesma familia do convite que ficou girando para sempre.
         *
         * A vistoria JA FOI CRIADA aqui: o fracasso e so do endereco, e o que
         * se perde e a retomada. Por isso a mensagem e acionavel e nomeia o
         * efeito real, em vez de dizer "erro ao navegar".
         */
        this.router
          .navigate(['/vistorias', created.id, 'captura'], { replaceUrl: true })
          .then((ok) => {
            if (!ok) this.uploadError.set(NAV_FAILED_MESSAGE);
          })
          .catch(() => this.uploadError.set(NAV_FAILED_MESSAGE));
      },
      error: (err: unknown) => this.fail(err, 'Não foi possível iniciar a vistoria.'),
    });
  }

  private load(id: string): void {
    this.service.getOne(id).subscribe({
      next: (found) => {
        this.inspection.set(found);
        this.loading.set(false);
        // Quem CONTINUA uma vistoria precisa ver o que ja fotografou: sem isto, reabrir a
        // tela mostrava quadros vazios para angulos que estao no servidor.
        this.loadPhotos(id);
      },
      error: (err: unknown) => this.fail(err, 'Não foi possível abrir esta vistoria.'),
    });
  }

  protected openCamera(angle: string): void {
    this.uploadError.set(null);
    this.pendingUpload.set(null);
    this.activeAngle.set(angle);
  }

  /**
   * REENVIA o arquivo que falhou — nao abre a camera.
   *
   * Fotografar de novo continua possivel pelo botao do angulo; o que muda e
   * que deixou de ser a UNICA saida depois de um erro de rede.
   */
  protected retryUpload(): void {
    const pending = this.pendingUpload();
    if (!pending || this.uploading()) return;
    this.send(pending.angle, pending.file);
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

    // A FOTO VOLTA PARA A TELA AGORA, antes de qualquer resposta: o preview local entra no
    // quadro no instante da captura, igual ao card de aluguel. Sem isto a pessoa fotografa e
    // nao ve nada mudar ate o upload terminar — na rua, em 3G, isso e muito tempo.
    this.setPreview(angle, file);

    this.uploading.set(true);
    this.sendingAngle.set(angle);
    this.uploadError.set(null);

    this.service.uploadPhoto(current.id, angle, file).subscribe({
      next: (updated) => {
        this.inspection.set(updated);
        this.uploading.set(false);
        this.sendingAngle.set(null);
        this.pendingUpload.set(null);
        // A URL assinada so existe depois de a foto estar no servidor; e ela que sobrevive
        // a uma recarga, entao vale reler a lista.
        this.loadPhotos(current.id);
      },
      error: (err: unknown) => {
        this.uploading.set(false);
        this.sendingAngle.set(null);
        // A foto FICA guardada: o erro nao pode custar a foto que ela acabou de
        // tirar. Falha de UMA foto tambem nao derruba a tela — as anteriores ja
        // estao no servidor. Era esse o ponto de subir uma a uma.
        this.pendingUpload.set({ angle, file });
        this.uploadError.set(
          this.apiErrors.messageFor(
            err,
            'Não foi possível enviar esta foto. Ela não se perdeu — reenvie.',
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
   * no celular e a regra, nao a excecao — e `submitted` evita reenviar o que
   * ja saiu.
   */
  protected submitInspection(): void {
    const current = this.inspection();
    if (!current || !this.isComplete() || this.submitting() || this.submitted()) {
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
   *
   * O 403 e um caso ESPERADO enquanto o recorte do motorista nao sobe no
   * backend, e tem frase propria em vez de virar "erro inesperado".
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
