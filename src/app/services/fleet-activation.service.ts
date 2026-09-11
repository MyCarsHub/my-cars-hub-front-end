import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, finalize, map, of, shareReplay, switchMap, tap } from 'rxjs';
import { environment } from '../../environments/environment';
import { PagedResponse } from '../types/paged.types';
import { SessionService } from './session.service';
import { SessionResetRegistry } from './session-reset.registry';

const SKIP_KEY = 'firstVehicleSkipped';

/**
 * Fonte de verdade do gate de ativação (FEAT-0080): "esta empresa já cadastrou
 * ao menos UM veículo alguma vez?".
 *
 * Serviço próprio de propósito: `VehiclesService._total` começa em 0 SEM
 * nenhum request — lê-lo no bootstrap é falso positivo garantido.
 *
 * Vendidos CONTAM (gate de primeira ativação, não de reativação), mas o
 * contrato do backend não tem "todos": o parâmetro `sold` é ternário —
 * ausente = SÓ operacionais, `sold=true` = SÓ vendidos. Por isso a consulta é
 * em DOIS passos, com o segundo só no caso raro: (1) `GET /vehicles?size=1`;
 * total > 0 já responde (caminho comum, uma chamada); (2) apenas quando a
 * operacional está vazia, `GET /vehicles?size=1&sold=true` — frota
 * inteiramente vendida também é empresa que já teve carro e nunca vê o gate.
 *
 * Cache e pulo são CHAVEADOS por `selectedCompanyId` (mesmo padrão do
 * `alert-settings.service`): trocar de empresa pelo seletor de tenant NÃO
 * passa por `SessionService.clear()` (`LayoutStore.commitTenant` só regrava as
 * chaves), então a troca é detectada comparando a empresa dona do cache com a
 * selecionada — chave mudou, cache e in-flight são descartados. O pulo vive no
 * sessionStorage sufixado pela empresa, então morre no fim da sessão da aba e
 * nunca vaza de uma empresa para outra.
 */
@Injectable({ providedIn: 'root' })
export class FleetActivationService {
  private readonly http = inject(HttpClient);
  private readonly session = inject(SessionService);

  /** `null` = ainda não perguntamos ao backend para esta empresa. */
  private cached: boolean | null = null;
  /** Empresa dona do cache; `undefined` enquanto nada foi carregado. */
  private cachedFor: string | null | undefined = undefined;
  private inFlight$: Observable<boolean> | null = null;

  constructor() {
    // Logout / queda de sessão: derruba também o caso raro em que o MESMO
    // usuário reloga na MESMA empresa sem nenhuma chamada entre os dois — a
    // chave por empresa não mudaria e o cache antigo sobreviveria.
    inject(SessionResetRegistry).register(() => {
      this.cached = null;
      this.cachedFor = undefined;
      this.inFlight$ = null;
    });
  }

  private company(): string | null {
    return this.session.getItem('selectedCompanyId');
  }

  /** Descarta cache e requisição em voo quando a empresa selecionada mudou. */
  private syncCompany(): string | null {
    const company = this.company();
    if (company !== this.cachedFor) {
      this.cached = null;
      this.inFlight$ = null;
      this.cachedFor = company;
    }
    return company;
  }

  /** Sonda uma das duas listas do contrato: operacional (sem `sold`) ou só vendidos. */
  private probe(sold: boolean): Observable<boolean> {
    let params = new HttpParams().set('size', '1');
    if (sold) params = params.set('sold', 'true');
    return this.http
      .get<PagedResponse<unknown>>(`${environment.apiUrl}/vehicles`, { params })
      .pipe(map((res) => (res.total ?? 0) > 0));
  }

  hasVehicles(): Observable<boolean> {
    this.syncCompany();
    if (this.cached !== null) return of(this.cached);
    if (this.inFlight$) return this.inFlight$;

    const pending$ = this.probe(false).pipe(
      // Segundo passo só quando a operacional está vazia (ver cabeçalho).
      switchMap((hasOperational) => (hasOperational ? of(true) : this.probe(true))),
      // Resposta velha não pode atropelar um resultado mais fresco: se um
      // `markHasVehicles()` (ou troca de empresa) aposentou ESTA requisição
      // enquanto ela voava, o resultado dela é descartado.
      tap((has) => {
        if (this.inFlight$ === pending$) this.cached = has;
      }),
      // Quem já estava inscrito numa requisição aposentada também recebe a
      // verdade mais fresca: sem isto, um guard que assinou ANTES do POST de
      // criação ainda redirecionaria com o `false` velho depois do veículo
      // existir. `cached` é a autoridade; a emissão da requisição é fallback.
      map((has) => this.cached ?? has),
      finalize(() => {
        // Erro também limpa o in-flight: a próxima navegação pergunta de novo.
        if (this.inFlight$ === pending$) this.inFlight$ = null;
      }),
      shareReplay({ bufferSize: 1, refCount: false }),
    );
    this.inFlight$ = pending$;
    return pending$;
  }

  /** Chamado após o POST de criação — o gate para de interceptar na hora. */
  markHasVehicles(): void {
    this.cachedFor = this.company();
    this.cached = true;
    // Aposenta qualquer consulta em voo: a resposta dela é anterior ao POST e
    // gravaria `false` por cima do `true` — o gate voltaria DEPOIS do cadastro.
    this.inFlight$ = null;
  }

  /**
   * "Pular por enquanto": vale a sessão da aba (sessionStorage) e só para a
   * empresa ativa. Na próxima sessão o gate volta a conduzir — o lembrete
   * persistente entre visitas.
   *
   * Sem empresa selecionada NÃO há gravação: um pulo numa chave sem sufixo
   * ficaria ilegível assim que uma empresa fosse selecionada — pulo
   * silenciosamente descartado é pior do que não registrar.
   */
  skip(): void {
    const company = this.company();
    if (company === null) return;
    this.session.setItem(`${SKIP_KEY}:${company}`, 'true');
  }

  hasSkipped(): boolean {
    const company = this.company();
    return company !== null && this.session.getItem(`${SKIP_KEY}:${company}`) === 'true';
  }
}
