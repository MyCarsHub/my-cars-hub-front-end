import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { AlertBanner } from '../../components/alert-banner/alert-banner';
import { InspectionsService } from '../../services/inspections.service';
import { SessionService } from '../../services/session.service';
import { ApiErrorService } from '../../services/api-error.service';
import type { InspectionPhoto, InspectionReviewResult } from '../../types/inspection.types';
import { angleLabel, angleOrder } from './angle-label';

interface PhotoView {
  /** Chave ESTAVEL do `@for` — nunca a `signedUrl`, que e reassinada. */
  readonly id: string;
  /** `null` = a foto existe, mas a assinatura dela falhou. */
  readonly signedUrl: string | null;
  readonly label: string;
}

/**
 * A DECISÃO sobre uma vistoria enviada: ver as fotos, aprovar ou recusar.
 *
 * É a APROVAÇÃO, não o envio, que fecha a ocorrência do ciclo — só uma vistoria
 * `APPROVED` encerra a cobrança. Enquanto esta tela não existia, nenhuma
 * vistoria chegava a esse ponto e o lembrete do motor não parava para ninguém,
 * nem com o dono operando.
 *
 * ## Por que é um componente e não uma rota
 *
 * Vive DENTRO da listagem que já existe. `app.routes.ts` é superfície de
 * concentração — há nós retidos esperando que ela pare de mudar —, e esta
 * decisão não precisa de endereço próprio: ela é sobre a linha que o dono
 * acabou de abrir.
 *
 * ## O que o servidor já garante, e por que a tela repete
 *
 * `approve` e `reject` são OWNER/MANAGER, travado no backend. O recorte aqui é
 * defesa em profundidade: a tela não OFERECE o que o servidor vai recusar. O
 * motorista continua VENDO as fotos — o que ele não tem é a decisão.
 */
@Component({
  selector: 'app-inspection-review',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [AlertBanner],
  templateUrl: './inspection-review.html',
})
export class InspectionReview {
  private readonly service = inject(InspectionsService);
  private readonly session = inject(SessionService);
  private readonly apiErrors = inject(ApiErrorService);

  readonly inspectionId = input.required<string>();

  /** A decisão tomada, para a lista hospedeira recarregar a linha. */
  readonly decided = output<InspectionReviewResult>();

  protected readonly photos = signal<PhotoView[] | null>(null);
  protected readonly photosError = signal<string | null>(null);
  protected readonly loadingPhotos = signal(false);

  protected readonly reason = signal('');
  protected readonly reasonTouched = signal(false);

  protected readonly deciding = signal(false);
  protected readonly decision = signal<InspectionReviewResult | null>(null);
  protected readonly decisionError = signal<string | null>(null);

  /**
   * Uma URL assinada expira. Quando a imagem falha, recarregamos a lista UMA
   * vez — o caso comum é a tela ficar aberta além da validade. Mais de uma vez
   * seria laço: se o link novo também falha, a causa não é expiração, e insistir
   * só faz a tela piscar.
   */
  private readonly refreshedForExpiry = signal(false);
  protected readonly expired = signal(false);

  protected readonly canDecide = computed(() => {
    const role = this.session.getCompanyRoleFromToken();
    return role === 'OWNER' || role === 'MANAGER';
  });

  /**
   * APROVAR SEM VER É ASSINAR EM BRANCO. Sem foto na tela não há decisão a
   * oferecer — nem enquanto carrega, nem se a lista voltar vazia, nem se
   * falhar. Nos dois últimos casos a saída é tentar de novo, não decidir.
   */
  protected readonly hasPhotos = computed(() => (this.photos()?.length ?? 0) > 0);

  /**
   * Angulos cuja foto EXISTE mas nao pode ser exibida (assinatura falhou).
   *
   * E a falha PARCIAL, e e ela que acontece de verdade: o backend isola por
   * item, entao o caso comum nao e a lista inteira cair, e sim uma foto de
   * catorze faltar.
   */
  protected readonly unavailable = computed(
    () => (this.photos() ?? []).filter((photo) => photo.signedUrl === null),
  );

  protected readonly allVisible = computed(
    () => this.hasPhotos() && this.unavailable().length === 0,
  );

  /** Recarregar serve tanto para lista vazia quanto para foto que nao assinou. */
  protected readonly canRetryPhotos = computed(
    () => !this.loadingPhotos() && (!this.hasPhotos() || this.unavailable().length > 0),
  );

  /**
   * APROVAR exige ver TUDO. "Nao se aprova sem ver" vale igual para a falha
   * parcial: ver 13 de 14 nao e ver, e o angulo que faltou e justamente o que
   * ninguem conferiu.
   */
  protected readonly canApprove = computed(
    () => this.canDecide() && this.allVisible() && this.decision() === null,
  );

  /**
   * RECUSAR continua disponivel com foto indisponivel, e a razao e assimetrica:
   * aprovar afirma que esta tudo certo — afirmacao que exige ter visto tudo —,
   * enquanto recusar aponta um problema que a pessoa JA identificou no que viu.
   *
   * O risco desta assimetria e recusar pelo motivo errado: o rotulo diz que a
   * foto nao CARREGOU, nao que ela falta, para ninguem mandar o motorista
   * refotografar o que ja esta no servidor. A copia do lugar vazio carrega essa
   * distincao — se ela se perder, a assimetria vira defeito.
   */
  protected readonly canReject = computed(
    () => this.canDecide() && this.hasPhotos() && this.decision() === null,
  );

  protected readonly reasonMissing = computed(
    () => this.reasonTouched() && this.reason().trim() === '',
  );

  protected readonly decisionLabel = computed(() => {
    const status = this.decision()?.status;
    if (status === 'APPROVED') return 'Vistoria aprovada.';
    if (status === 'REJECTED') return 'Vistoria recusada. O motorista pode fotografar de novo.';
    return null;
  });

  constructor() {
    effect(() => {
      const id = this.inspectionId();
      if (id) this.loadPhotos(id);
    });
  }

  protected loadPhotos(id = this.inspectionId()): void {
    this.loadingPhotos.set(true);
    this.photosError.set(null);

    this.service.photos(id).subscribe({
      next: (list) => {
        this.loadingPhotos.set(false);
        /*
         * ORDEM CANONICA DO ROTEIRO — frente, traseira, laterais, pneus, painel.
         *
         * Quem aprova ve 14 fotos em sequencia, e ordem previsivel e o que
         * deixa perceber o que falta sem ler rotulo por rotulo. Ordenar por
         * data nao serviria: ha uma foto por angulo (indice unico no backend),
         * entao refoto SUBSTITUI e nao existe par velha/nova para a data
         * desempatar — so embaralharia o roteiro, diferente a cada vistoria.
         *
         * Ordenamos NOS, em vez de confiar na ordem que o servidor mandou:
         * ordem de resposta nao e contrato, e o dia em que ela mudar ninguem
         * vai ligar os pontos. `createdDate` fica como desempate estavel para
         * angulos fora do roteiro conhecido.
         */
        const ordered = [...list].sort(
          (a, b) =>
            angleOrder(a.angle) - angleOrder(b.angle) ||
            a.createdDate.localeCompare(b.createdDate),
        );
        this.photos.set(
          ordered.map((photo: InspectionPhoto) => ({
            id: photo.id,
            signedUrl: photo.signedUrl,
            label: angleLabel(photo.angle),
          })),
        );
      },
      error: (err: unknown) => {
        this.loadingPhotos.set(false);
        this.photos.set([]);
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
    if (this.refreshedForExpiry()) {
      this.expired.set(true);
      return;
    }
    this.refreshedForExpiry.set(true);
    this.loadPhotos();
  }

  protected onReasonInput(event: Event): void {
    this.reason.set((event.target as HTMLTextAreaElement).value);
  }

  protected approve(): void {
    if (!this.canApprove() || this.deciding()) return;
    this.run(this.service.approve(this.inspectionId()));
  }

  /**
   * RECUSA EXIGE MOTIVO na tela, não só no servidor. O backend rejeita vazio
   * com 400, mas essa recusa chegaria depois do envio e sem apontar o campo —
   * e quem vai refotografar precisa saber o que estava errado.
   */
  protected reject(): void {
    if (!this.canReject() || this.deciding()) return;

    this.reasonTouched.set(true);
    const reason = this.reason().trim();
    if (reason === '') return;

    this.run(this.service.reject(this.inspectionId(), reason));
  }

  /**
   * FALHAR NÃO É DECIDIR. Em erro, `decision` continua nulo — a tela não
   * afirma um desfecho que o servidor não deu — e o motivo digitado FICA, para
   * a pessoa não ter de redigitar o que já escreveu.
   */
  private run(call: ReturnType<InspectionsService['approve']>): void {
    this.deciding.set(true);
    this.decisionError.set(null);

    call.subscribe({
      next: (result) => {
        this.deciding.set(false);
        this.decision.set(result);
        this.decided.emit(result);
      },
      error: (err: unknown) => {
        this.deciding.set(false);
        this.apiErrors.claim(err);
        this.decisionError.set(this.decisionFailureMessage(err));
      },
    });
  }

  private decisionFailureMessage(err: unknown): string {
    if (err instanceof HttpErrorResponse && err.status === 403) {
      return 'Só o dono ou o gerente da empresa pode aprovar ou recusar uma vistoria.';
    }
    return this.apiErrors.messageFor(
      err,
      'Não conseguimos registrar sua decisão agora. Nada foi alterado — tente de novo.',
    );
  }
}
