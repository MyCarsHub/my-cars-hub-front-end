import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { Observable, catchError, finalize, tap, throwError } from 'rxjs';
import { environment } from '../../environments/environment';
import { PagedResponse } from '../types/paged.types';
import {
  CreateInspectionRequest,
  INSPECTION_SEARCH_MAX_LENGTH,
  Inspection,
  InspectionFilters,
  InspectionListItem,
  InspectionPhoto,
  InspectionReviewResult,
  InspectionSummary,
  SubmitInspectionRequest,
} from '../types/inspection.types';
import { TenantResetRegistry } from './tenant-reset.registry';

const BASE = `${environment.apiUrl}/inspections`;

/**
 * Listagem de vistorias, com filtros combináveis.
 *
 * `GET /v1/inspections` aceita `vehicleId`, `rentalId`, `kind`, `status`, `from` e
 * `to`, todos opcionais e combináveis. Para OWNER/MANAGER devolve as da empresa;
 * para o MOTORISTA o servidor escopa para as dele — a tela nao filtra por papel.
 *
 * O resto segue as convenções de toda lista da casa (envelope
 * `content/page/size/total`, cache por empresa zerado no `TenantResetRegistry`,
 * erro guardado em signal para a tela mostrar inline).
 */
@Injectable({ providedIn: 'root' })
export class InspectionsService {
  private readonly http = inject(HttpClient);

  private readonly _items = signal<InspectionListItem[]>([]);
  private readonly _page = signal(0);
  private readonly _size = signal(20);
  private readonly _total = signal(0);
  private readonly _loading = signal(false);
  private readonly _error = signal<string | null>(null);

  readonly items = this._items.asReadonly();
  readonly page = this._page.asReadonly();
  readonly size = this._size.asReadonly();
  readonly total = this._total.asReadonly();
  readonly loading = this._loading.asReadonly();
  readonly error = this._error.asReadonly();

  constructor() {
    // Troca de empresa e fim de sessão zeram este cache, como nas demais
    // listas — sem isto a empresa nova abre com as vistorias da anterior.
    inject(TenantResetRegistry).register(() => this.reset());
  }

  reset(): void {
    this._items.set([]);
    this._page.set(0);
    this._size.set(20);
    this._total.set(0);
    this._loading.set(false);
    this._error.set(null);
  }

  /**
   * Monta os parâmetros SÓ com o que foi de fato escolhido.
   *
   * Filtro vazio não vira `?vehicleId=` — string vazia na query é ambígua no
   * backend (pode ser lida como "vazio" em vez de "ausente") e polui a URL que
   * o usuário eventualmente compartilha.
   */
  private toParams(filters: InspectionFilters): HttpParams {
    const params = new HttpParams()
      .set('page', String(filters.page ?? 0))
      .set('size', String(filters.size ?? 20));

    return this.withOptional(params, filters, true);
  }

  /**
   * Os filtros opcionais, so os escolhidos. Compartilhado entre a lista e o `summary` — o
   * resumo aceita os filtros de recorte (veiculo, locacao, tipo, periodo) e NAO `status`,
   * busca, ordem nem pagina, e duas copias desta lista divergiriam no primeiro filtro novo.
   */
  private withOptional(
    params: HttpParams,
    filters: InspectionFilters,
    includeListOnly: boolean,
  ): HttpParams {
    const optional: Array<[string, string | null | undefined]> = [
      ['vehicleId', filters.vehicleId],
      ['rentalId', filters.rentalId],
      ['kind', filters.kind],
      ['status', includeListOnly ? filters.status : null],
      ['from', filters.from],
      ['to', filters.to],
      // Busca: aparada e cortada no limite do servidor. Branco nao vai para a query.
      ['q', includeListOnly ? filters.q?.trim().slice(0, INSPECTION_SEARCH_MAX_LENGTH) : null],
      ['sort', includeListOnly ? filters.sort : null],
    ];
    for (const [key, value] of optional) {
      if (value) params = params.set(key, value);
    }
    return params;
  }

  /**
   * `GET /v1/inspections/summary` — contagem por situacao, para os tiles do topo.
   *
   * Sem cache e sem signal de proposito: e uma leitura pontual que a tela refaz depois de
   * uma decisao. Falha NAO e engolida aqui — quem chama decide mostrar "—", porque inventar
   * zero afirmaria que nao ha vistoria a decidir.
   */
  summary(filters: InspectionFilters = {}): Observable<InspectionSummary> {
    return this.http.get<InspectionSummary>(`${BASE}/summary`, {
      params: this.withOptional(new HttpParams(), filters, false),
    });
  }

  /**
   * `POST /v1/inspections` — abre a vistoria `PENDING` e devolve o RETRATO do roteiro.
   *
   * OWNER/MANAGER abrem para qualquer veiculo da empresa; o MOTORISTA, so para o
   * veiculo de um aluguel ATIVO dele (o servidor decide, e um 403 aqui e essa regra).
   */
  create(payload: CreateInspectionRequest): Observable<Inspection> {
    return this.http.post<Inspection>(BASE, payload);
  }

  /**
   * `GET /v1/inspections/{id}` — `requiredAngles` + `capturedAngles` (base da retomada),
   * `status` e, quando recusada, `rejectionReason` e `reviewedAt`.
   */
  getOne(id: string): Observable<Inspection> {
    return this.http.get<Inspection>(`${BASE}/${id}`);
  }

  /**
   * `POST /v1/inspections/{id}/photos/{angle}` — UMA foto por vez, de propósito.
   *
   * Subir tudo no fim significaria que uma queda de conexão com 13 fotos na memória
   * custa as 13. Subindo uma a uma, custa uma — e a resposta traz `capturedAngles`
   * atualizado, então a tela não precisa adivinhar o que já foi.
   */
  uploadPhoto(id: string, angle: string, file: File): Observable<Inspection> {
    const body = new FormData();
    body.append('file', file);
    return this.http.post<Inspection>(
      `${BASE}/${id}/photos/${encodeURIComponent(angle)}`,
      body,
    );
  }

  /**
   * `POST /v1/inspections/{id}/submit` — ENTREGA a vistoria para aprovacao.
   *
   * Medido com o backend: `COMPLETED` so e alcancavel por `submit` seguido de
   * `approve`, e nenhuma tela chamava `submit`. Consequencia real — nenhuma
   * vistoria fechava, para NENHUM papel, nem com o dono operando. A chamada
   * faltava do lado do frontend; e esta.
   *
   * Nao e idempotente do ponto de vista do produto: depois dela quem fotografou
   * nao fotografa mais nesta vistoria, a menos que seja recusada. Por isso a
   * tela exige clique explicito e nunca dispara isto como efeito de ter
   * completado o roteiro.
   *
   * `odometerKm` (km atual do veiculo, informado pelo motorista) vai no corpo. O servidor
   * recusa abaixo do ultimo registro (`INSPECTION_ODOMETER_BELOW_PREVIOUS`) e a mensagem
   * em portugues vem no erro — a tela a mostra.
   *
   * O retorno e `InspectionReviewResult`, NAO `Inspection` — ele nao traz
   * `requiredAngles` nem `capturedAngles`. Quem chamar NAO pode usar esta
   * resposta para substituir a vistoria em memoria; serve para ler o `status`
   * novo. Ver o cabecalho de `InspectionReviewResult`.
   */
  submit(id: string, body: SubmitInspectionRequest | null = null): Observable<InspectionReviewResult> {
    // Corpo `{ odometerKm }` quando a tela o informa. Sem ele o corpo continua `{}`, que e o
    // que um servidor anterior ao hodometro espera.
    return this.http.post<InspectionReviewResult>(`${BASE}/${id}/submit`, body ?? {});
  }

  /**
   * `POST /v1/inspections/{id}/recapture` — refaz uma vistoria RECUSADA.
   *
   * Devolve a NOVA vistoria, `PENDING`, com o roteiro de volta a zero: e outra linha
   * (a recusada fica como historico), nao a mesma reaberta. Por isso o retorno e uma
   * `Inspection` completa e a tela passa a operar sobre o `id` novo.
   *
   * OWNER/MANAGER e o MOTORISTA do veiculo. Em qualquer outro estado que nao
   * `REJECTED` o servidor recusa — a tela so oferece o botao na recusada.
   */
  recapture(id: string): Observable<Inspection> {
    return this.http.post<Inspection>(`${BASE}/${id}/recapture`, {});
  }

  /**
   * `GET /v1/inspections/{id}/photos` — as fotos enviadas, com o angulo de cada.
   *
   * Quem aprova TEM de ver antes de decidir; aprovar sem ver e assinar em
   * branco. Por isso a tela nao oferece aprovacao enquanto esta lista nao
   * chegou — lista vazia ou falha viram "tentar de novo", nunca um botao de
   * aprovar habilitado.
   *
   * As URLs sao assinadas e EXPIRAM. Nao ha cache aqui de proposito: guardar
   * uma lista dessas e guardar links que morrem sozinhos.
   */
  photos(id: string): Observable<InspectionPhoto[]> {
    return this.http.get<InspectionPhoto[]>(`${BASE}/${id}/photos`);
  }

  /**
   * `GET /v1/inspections/{id}/pdf` — o laudo da vistoria APROVADA, como URL assinada.
   *
   * Devolve a URL e nao os bytes: o PDF carrega as 14 fotos. A URL EXPIRA, entao ela e
   * pedida no clique de "Baixar PDF" e nunca guardada. Vistoria nao aprovada responde erro.
   */
  reportUrl(id: string): Observable<{ url: string }> {
    return this.http.get<{ url: string }>(`${BASE}/${id}/pdf`);
  }

  /**
   * `POST /v1/inspections/{id}/approve` — fecha a ocorrencia do ciclo.
   *
   * E a APROVACAO, nao o envio, que faz a cobranca parar: so uma vistoria
   * `APPROVED` fecha a ocorrencia. OWNER/MANAGER, travado no servidor.
   */
  approve(id: string): Observable<InspectionReviewResult> {
    return this.http.post<InspectionReviewResult>(`${BASE}/${id}/approve`, {});
  }

  /**
   * `POST /v1/inspections/{id}/reject` — recusa COM MOTIVO.
   *
   * O motivo e obrigatorio no servidor (nao vazio, ate 1000 caracteres) e a
   * tela tambem o exige: quem refotografa precisa saber o que estava errado.
   * Recusar nao fecha o ciclo — o periodo segue devido.
   */
  reject(id: string, reason: string): Observable<InspectionReviewResult> {
    return this.http.post<InspectionReviewResult>(`${BASE}/${id}/reject`, { reason });
  }

  /**
   * The SAME `GET /v1/inspections`, as a plain read: no `items`/`loading`/`error` written.
   * For a screen that needs one answer from the list (e.g. "is this the vehicle's latest?")
   * without overwriting the list state another screen owns.
   */
  peek(filters: InspectionFilters = {}): Observable<PagedResponse<InspectionListItem>> {
    return this.http.get<PagedResponse<InspectionListItem>>(BASE, {
      params: this.toParams(filters),
    });
  }

  list(filters: InspectionFilters = {}): Observable<PagedResponse<InspectionListItem>> {
    this._loading.set(true);
    this._error.set(null);

    return this.http
      .get<PagedResponse<InspectionListItem>>(BASE, { params: this.toParams(filters) })
      .pipe(
        tap((res) => {
          this._items.set(res?.content ?? []);
          this._page.set(res?.page ?? 0);
          this._size.set(res?.size ?? 20);
          this._total.set(res?.total ?? 0);
        }),
        catchError((err: HttpErrorResponse) => {
          // RECUSA e FALHA nao sao a mesma coisa para quem le. O 403 aqui e uma
          // decisao de permissao (o servidor escopa a listagem por papel), e a
          // frase generica culparia a rede — e o usuario ficaria recarregando.
          this._error.set(
            err.status === 403
              ? 'Você não tem permissão para ver as vistorias desta empresa.'
              : 'Não foi possível carregar as vistorias.',
          );
          return throwError(() => err);
        }),
        finalize(() => this._loading.set(false)),
      );
  }
}
