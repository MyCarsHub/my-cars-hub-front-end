import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map, throwError } from 'rxjs';
import { environment } from '../../environments/environment';
import { SessionService } from './session.service';
import {
  CompanyContact,
  CompanyContactPayload,
  CompanyContactSnapshot,
  EMPTY_COMPANY_CONTACT,
} from '../types/company-contact.types';

/** O recorte da resposta de `/v1/companies/{id}` e `/v1/companies/me` que interessa aqui. */
interface CompanyContactResponse {
  name: string;
  contact?: CompanyContact | null;
}

/**
 * Dados de contato da empresa (`/configuracoes/contato`).
 *
 * **Por que não usa `CompanyService`.** Aquele serviço lê de
 * `GET /companies/{sessionStorage.selectedCompanyId}` e grava em
 * `PUT /companies/me` (tenant do token) — dois tenants que podem divergir na mesma
 * sessão, defeito já registrado na fila. Numa tela de nome e documento a divergência
 * é ruim; numa tela cujo `PUT` **substitui o bloco inteiro de contato** ela é
 * destrutiva: leríamos o contato da empresa A e o gravaríamos por cima do da B.
 * Por isso a leitura aqui é chaveada pelo claim `companyId` do JWT, que é
 * exatamente de onde o backend tira o tenant do `PUT`. Leitura e escrita não têm
 * como apontar para empresas diferentes.
 *
 * Sem cache e sem estado compartilhado, também de propósito: a tela é a única
 * consumidora e precisa ver o servidor, não o que sobrou de outra visita.
 */
@Injectable({ providedIn: 'root' })
export class CompanyContactService {
  private readonly http = inject(HttpClient);
  private readonly session = inject(SessionService);

  /**
   * Lê nome + bloco de contato da empresa DO TOKEN.
   *
   * Sem claim utilizável não há requisição: adivinhar a empresa aqui seria
   * arriscar mostrar (e depois sobrescrever) o tenant errado.
   */
  load(): Observable<CompanyContactSnapshot> {
    const companyId = this.session.getCompanyIdFromToken();
    if (!companyId) {
      return throwError(() => new Error('Sessão sem empresa no token.'));
    }

    return this.http
      .get<CompanyContactResponse>(`${environment.apiUrl}/companies/${companyId}`)
      .pipe(map(toSnapshot));
  }

  /**
   * Grava o bloco de contato INTEIRO.
   *
   * Dois pontos que não são óbvios no contrato do `PUT /v1/companies/me`:
   *
   * 1. `name` é `@NotBlank` no backend, então um salvamento "só de contato" não
   *    existe — o nome carregado no `load()` precisa voltar junto. É por isso que
   *    a tela só habilita salvar depois que o `load()` respondeu: sem o nome real
   *    em mãos, qualquer envio renomearia a empresa.
   * 2. `documentValue: null` é lido como "mantenha o documento atual". Nunca
   *    ecoar o valor vindo do GET: ele chega mascarado (LGPD).
   *
   * O `contact` vai sempre completo — ver `CompanyContactPayload`.
   */
  save(name: string, contact: CompanyContactPayload): Observable<CompanyContactSnapshot> {
    return this.http
      .put<CompanyContactResponse>(`${environment.apiUrl}/companies/me`, {
        name,
        documentValue: null,
        contact,
      })
      .pipe(map(toSnapshot));
  }
}

/**
 * O backend devolve `contact` sempre preenchido (bloco de nulos quando vazio).
 * O `??` cobre a janela de deploy em que o frontend novo fala com um backend
 * anterior à V52 — ali o campo simplesmente não vem.
 */
function toSnapshot(response: CompanyContactResponse): CompanyContactSnapshot {
  return {
    name: response.name ?? '',
    contact: response.contact ?? EMPTY_COMPANY_CONTACT,
  };
}
