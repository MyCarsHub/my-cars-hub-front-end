import { HttpClient, HttpContext } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map, tap } from 'rxjs';

import { environment } from '../../environments/environment';
import { SessionService } from './session.service';
import { InviteOnboardingTokenStore } from './invite-onboarding-token.store';
import { MeResponse } from '../types/me-response.type';
import { UserCompanies } from '../types/user-companies';

export interface SelectCompanyResponse {
  token?: string;
  /** Absent on a backend that predates multi-profile: treated as ACCESS. */
  kind?: 'ACCESS' | 'INVITE_ONBOARDING';
  companyId?: string;
  companyName?: string;
  role?: string;
  roleLabel?: string;
  next?: 'MANAGER_ONBOARDING' | 'DRIVER_ONBOARDING' | null;
}

/** What `selectDetailed` did with the token it received. */
export type SelectCompanyOutcome =
  | { kind: 'ACCESS'; token: string }
  | { kind: 'INVITE_ONBOARDING'; token: string; next: 'MANAGER_ONBOARDING' | 'DRIVER_ONBOARDING' };

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
  private readonly onboardingToken = inject(InviteOnboardingTokenStore);

  /**
   * Emite o token já persistido; erra se o servidor recusar ou não devolver token.
   *
   * `context` é opcional e existe para quem chama de DENTRO do tratamento de erro
   * (a reemissão do token do motorista, em `DriverIdentityRecoveryService`): ali a
   * falha já tem tratamento próprio, e deixá-la passar pelo `errorInterceptor`
   * produziria um segundo aviso por cima do primeiro. Sem o argumento o
   * comportamento é exatamente o de antes — é o que o switcher de empresa usa.
   */
  select(companyId: string, context?: HttpContext): Observable<string> {
    return this.selectDetailed(companyId, context).pipe(
      map((outcome) => {
        // `select()` means "become this company": an onboarding token is not a session, and
        // `selectDetailed` has already parked it in its own slot — report it as a failure.
        if (outcome.kind !== 'ACCESS') {
          throw new Error('A empresa selecionada ainda está em cadastro.');
        }
        return outcome.token;
      }),
    );
  }

  /**
   * Same call, but aware of `kind`. ACCESS: the token becomes the session token (as always).
   * INVITE_ONBOARDING: the token goes ONLY to `InviteOnboardingTokenStore` — never to the
   * session slot every guard reads — and the caller is told where to send the person.
   */
  selectDetailed(companyId: string, context?: HttpContext): Observable<SelectCompanyOutcome> {
    const url = `${environment.apiUrl}/auth/select-company/${companyId}`;
    // Sem `context`, a chamada sai EXATAMENTE como antes — sem terceiro
    // argumento. Passar `{ context: undefined }` mudaria a forma da chamada para
    // todo mundo por causa de um parametro que so a recuperacao usa.
    const request$ = context
      ? this.http.post<SelectCompanyResponse>(url, {}, { context })
      : this.http.post<SelectCompanyResponse>(url, {});

    return request$.pipe(
      map((response): SelectCompanyOutcome => {
        const token = response?.token;
        if (!token) {
          throw new Error('Resposta de /auth/select-company sem token.');
        }
        if (response.kind === 'INVITE_ONBOARDING') {
          this.onboardingToken.set(token);
          return {
            kind: 'INVITE_ONBOARDING',
            token,
            next: response.next === 'DRIVER_ONBOARDING' ? 'DRIVER_ONBOARDING' : 'MANAGER_ONBOARDING',
          };
        }
        this.session.setToken(token);
        return { kind: 'ACCESS', token };
      }),
    );
  }

  /**
   * Relê as empresas do usuário em `GET /auth/me` e regrava `userCompanies`.
   *
   * FIX-0363 — a lista que o seletor mostra era um SNAPSHOT escrito no login.
   * Uma empresa em que o usuário entrou DEPOIS (aceitar um convite, que é o
   * caminho normal desde que convites foram para produção) ficava invisível até
   * ele deslogar e logar de novo. `/auth/me` é a fonte; o armazenamento é só o
   * cache que alimenta o `LayoutStore`.
   *
   * Método SEPARADO de `select()` de propósito: `select()` também é o caminho da
   * reemissão silenciosa do FEAT-0106, e pendurar um `/auth/me` ali faria toda
   * recuperação de identidade disparar uma requisição a mais no meio de um erro.
   * Quem quer a lista nova pede a lista nova.
   */
  refreshCompaniesFromMe(): Observable<UserCompanies[]> {
    return this.http.get<MeResponse>(`${environment.apiUrl}/auth/me`).pipe(
      // `Array.isArray` e nao um `?? []` solto: uma resposta com `companies`
      // em outra forma (uma string, por exemplo) passaria pelo `.length` abaixo
      // medindo CARACTERES, e o valor sujo entraria no armazenamento como se
      // fosse a lista de empresas.
      map((me) => (Array.isArray(me?.companies) ? me.companies : [])),
      tap((companies) => {
        // Lista VAZIA nao sobrescreve o snapshot. Um `/auth/me` que responde sem
        // `companies` (forma inesperada, backend em deploy, corpo truncado) nao
        // pode apagar a empresa que o usuario ACABOU de selecionar com sucesso —
        // o seletor voltaria para "Sem Empresa" logo depois de uma troca que deu
        // certo. Na duvida, o cache anterior e melhor que o vazio.
        if (companies.length === 0) {
          return;
        }
        this.session.setItem('userCompanies', JSON.stringify(companies));
      }),
    );
  }
}
