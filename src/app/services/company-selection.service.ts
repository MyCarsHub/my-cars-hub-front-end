import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';

import { environment } from '../../environments/environment';
import { SessionService } from './session.service';

interface SelectCompanyResponse {
  token?: string;
}

/**
 * Troca a empresa ativa da sessão em `POST /auth/select-company/{id}`.
 *
 * Existe como serviço-folha (só `HttpClient` + `SessionService`) porque quem precisa
 * dele é o `LayoutStore`, e o caminho óbvio — reaproveitar o `AuthService` — fecharia
 * um ciclo de import: `layout.store` → `auth.service` → `impersonation.service` →
 * `layout.store`.
 *
 * O contrato que importa: o backend resolve o tenant pelo claim `companyId` do TOKEN,
 * nunca pelo `selectedCompanyId` do armazenamento. Enquanto o token novo não estiver
 * gravado, a empresa ativa continua sendo a anterior — por isso a persistência acontece
 * aqui, antes de o assinante saber do sucesso, e uma resposta sem token é tratada como
 * FALHA em vez de sucesso silencioso.
 */
@Injectable({ providedIn: 'root' })
export class CompanySelectionService {
  private readonly http = inject(HttpClient);
  private readonly session = inject(SessionService);

  /** Emite o token já persistido; erra se o servidor recusar ou não devolver token. */
  select(companyId: string): Observable<string> {
    return this.http
      .post<SelectCompanyResponse>(`${environment.apiUrl}/auth/select-company/${companyId}`, {})
      .pipe(
        map((response) => {
          const token = response?.token;
          if (!token) {
            throw new Error('Resposta de /auth/select-company sem token.');
          }
          this.session.setToken(token);
          return token;
        }),
      );
  }
}
