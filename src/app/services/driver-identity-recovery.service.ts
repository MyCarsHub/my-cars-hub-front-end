import { HttpContext } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, finalize, shareReplay, throwError } from 'rxjs';

import { CompanySelectionService } from './company-selection.service';
import { SILENT_HTTP_ERRORS } from './http-errors.context';
import { SessionService } from './session.service';

/**
 * Reemite o access token do motorista quando o backend recusa a requisição com
 * `DRIVER_IDENTITY_NOT_RESOLVED` (403).
 *
 * POR QUE `select-company` E NÃO UM ENDPOINT DE REFRESH: `POST
 * /v1/auth/select-company/{id}` é o caminho que o backend já usa para reemitir o
 * token da sessão, e o token novo sai com os claims completos — inclusive o
 * `driverId` que faltava. O motorista refaz esse passo sem perceber, em vez de
 * ser jogado na tela de login no meio do que estava fazendo.
 *
 * A empresa vem do claim `companyId` do TOKEN, não do `sessionStorage`: é a
 * mesma fonte que o backend usa para resolver o tenant, e o token recusado só
 * está incompleto no `driverId` — o `companyId` continua lá e continua correto.
 *
 * UMA chamada por vez: um motorista com três requisições em voo recebe três 403
 * e pediria três tokens, sendo que o segundo e o terceiro invalidariam o
 * primeiro. A reemissão em voo é compartilhada, então as três esperam a MESMA
 * resposta.
 */
@Injectable({ providedIn: 'root' })
export class DriverIdentityRecoveryService {
  private readonly session = inject(SessionService);
  private readonly companySelection = inject(CompanySelectionService);

  /** Reemissão em voo, compartilhada por todas as requisições que falharam juntas. */
  private inFlight: Observable<string> | null = null;

  /**
   * Emite o token novo (já persistido pelo `CompanySelectionService`), ou erra
   * quando não há empresa para pedir — aí só resta o caminho duro do `/login`.
   */
  reissueToken(): Observable<string> {
    if (this.inFlight) {
      return this.inFlight;
    }

    const companyId = this.session.getCompanyIdFromToken();
    if (!companyId) {
      return throwError(
        () => new Error('Sem companyId no token: reemissão de identidade impossível.'),
      );
    }

    // `SILENT_HTTP_ERRORS`: a falha desta chamada JÁ tem dono (o `errorInterceptor`
    // cai no caminho duro). Sem a marca, um 403 aqui dispararia o toast genérico
    // "Acesso negado" por cima do aviso de sessão renovada.
    const context = new HttpContext().set(SILENT_HTTP_ERRORS, true);

    this.inFlight = this.companySelection.select(companyId, context).pipe(
      finalize(() => {
        this.inFlight = null;
      }),
      shareReplay({ bufferSize: 1, refCount: false }),
    );

    return this.inFlight;
  }
}
