import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { Observable, catchError, finalize, tap, throwError } from 'rxjs';
import { environment } from '../../environments/environment';
import { PagedResponse } from '../types/paged.types';
import { InspectionFilters, InspectionListItem } from '../types/inspection.types';
import { TenantResetRegistry } from './tenant-reset.registry';

const BASE = `${environment.apiUrl}/inspections`;

/**
 * Listagem de vistorias, com filtros combináveis.
 *
 * ## O endpoint existe; o CONTRATO dele ainda é mais estreito que este serviço
 *
 * `GET /v1/inspections` está em produção (V82). O que ainda não está é a forma
 * que esta tela consome: hoje o controlador exige `rentalId`
 * (`InspectionController.listByRental`, `@RequestParam UUID rentalId` SEM
 * `required = false`), a busca por veículo é OUTRA rota
 * (`GET /v1/inspections/by-vehicle/{vehicleId}`), e `kind`, `from` e `to` não
 * existem na listagem.
 *
 * Duas consequências, enquanto for assim:
 *  - abrir a página sem filtro manda `?page=0&size=20` e volta **400** — ou
 *    seja, o estado INICIAL da tela é o caso quebrado, não um canto raro;
 *  - com `rentalId` mais os outros, o servidor honra o `rentalId` e descarta o
 *    resto EM SILÊNCIO, que é pior: a tela mostra um resultado plausível para
 *    um filtro que não foi aplicado.
 *
 * ## Por que `toParams` não foi ajustado para a API de hoje
 *
 * O PR de backend que torna os cinco parâmetros opcionais e combináveis está em
 * curso, e é ele que fecha isto. Reescrever `toParams` para o contrato estreito
 * degradaria a tela para caber numa API que está sendo corrigida, e depois seria
 * preciso desfazer. O contrato que este serviço manda é o alvo, não um chute:
 * `inspections.service.spec.ts` prende exatamente o que viaja na query.
 *
 * ESTE SERVIÇO NÃO ESTÁ PRONTO PARA PRODUÇÃO ATÉ AQUELE PR ENTRAR. É também por
 * isso que o item "Vistorias" segue comentado em `components/sidebar/sidebar.ts`
 * — o menu não oferece uma tela cujo estado inicial responde 400.
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
    let params = new HttpParams()
      .set('page', String(filters.page ?? 0))
      .set('size', String(filters.size ?? 20));

    const optional: Array<[string, string | null | undefined]> = [
      ['vehicleId', filters.vehicleId],
      ['rentalId', filters.rentalId],
      ['kind', filters.kind],
      ['from', filters.from],
      ['to', filters.to],
    ];
    for (const [key, value] of optional) {
      if (value) params = params.set(key, value);
    }
    return params;
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
          this._error.set('Não foi possível carregar as vistorias.');
          return throwError(() => err);
        }),
        finalize(() => this._loading.set(false)),
      );
  }
}
