import { HttpClient, HttpContext, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, catchError, map, of, switchMap } from 'rxjs';
import { environment } from '../../environments/environment';
import { Notice, NoticesService } from '../components/notices/notices.service';
import { SILENT_HTTP_ERRORS } from './http-errors.context';
import { SessionService } from './session.service';

/** Código estável do 400 de `POST /v1/rentals` com a locadora sem contato completo. */
export const COMPANY_CONTACT_INCOMPLETE_CODE = 'COMPANY_CONTACT_INCOMPLETE';

/** Resposta de `GET /v1/companies/me/contact-readiness`. */
export interface ContactReadiness {
  complete: boolean;
  missing: readonly { field: string; label: string }[];
  fillPath: string;
}

export const CONTACT_NOTICE_ID = 'company-contact-incomplete';

const FILL_PATH = '/configuracoes/contato';

/** O 400 do create de aluguel que manda abrir o aviso de contato. */
export function isCompanyContactIncomplete(error: unknown): boolean {
  if (!(error instanceof HttpErrorResponse) || error.status !== 400) return false;
  let body: unknown = error.error;
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch {
      return false;
    }
  }
  return (
    typeof body === 'object' &&
    body !== null &&
    (body as { code?: unknown }).code === COMPANY_CONTACT_INCOMPLETE_CODE
  );
}

/**
 * FEAT-0563 — porta do "contato da locadora está completo?" antes de criar aluguel.
 *
 * A regra de completude mora no backend (uma só); aqui só se pergunta e se mostra o aviso.
 * Falha da pré-checagem (rede, 5xx) NÃO bloqueia: o servidor recusa o create com o código acima
 * e o fallback abre o mesmo aviso.
 */
@Injectable({ providedIn: 'root' })
export class CompanyContactGate {
  private readonly http = inject(HttpClient);
  private readonly session = inject(SessionService);
  private readonly notices = inject(NoticesService);

  /**
   * UMA verificação de capacidade: quem pode salvar o contato da locadora.
   * Hoje só o dono (o `PUT /companies/me` responde 403 ao gerente). Quando a regra de permissão
   * mudar no backend, é este o único ponto a virar.
   */
  canFillContact(): boolean {
    return this.session.getCompanyRoleFromToken() === 'OWNER';
  }

  readiness(): Observable<ContactReadiness> {
    return this.http
      .get<ContactReadiness>(`${environment.apiUrl}/companies/me/contact-readiness`, {
        context: new HttpContext().set(SILENT_HTTP_ERRORS, true),
      })
      .pipe(catchError(() => of({ complete: true, missing: [], fillPath: FILL_PATH })));
  }

  /**
   * `true` quando o aluguel pode seguir: contato completo, ou o usuário completou no aviso.
   * `false` quando ele saiu do aviso sem preencher.
   */
  ensureComplete(): Observable<boolean> {
    return this.readiness().pipe(
      switchMap((r) =>
        r.complete
          ? of(true)
          : this.notices.enqueue(this.noticeFor(r)).pipe(map((outcome) => outcome === 'resolved')),
      ),
    );
  }

  noticeFor(readiness: ContactReadiness): Notice {
    const items = readiness.missing.map((m) => m.label);
    if (this.canFillContact()) {
      return {
        id: CONTACT_NOTICE_ID,
        type: 'REMINDER',
        title: 'Complete os dados da sua locadora',
        message:
          'O contrato do aluguel leva o contato da locadora. Preencha o que falta abaixo e seguimos com o aluguel que você estava criando.',
        items,
        form: 'company-contact',
        link: { label: 'Abrir em Configurações', route: FILL_PATH },
        dismissLabel: 'Voltar ao aluguel',
      };
    }
    return {
      id: CONTACT_NOTICE_ID,
      type: 'REMINDER',
      title: 'Faltam dados da locadora',
      message:
        'Para criar o aluguel, o proprietário precisa preencher os dados de contato da locadora em Configurações > Dados de contato. Peça a ele.',
      items,
      dismissLabel: 'Entendi',
    };
  }
}
