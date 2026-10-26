import { HttpClient, HttpContext } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import { SILENT_HTTP_ERRORS } from '../../services/http-errors.context';
import { PublicStatus } from '../../types/status.types';

/**
 * Leitura da página pública de status. `SILENT_HTTP_ERRORS`: a tela é dona do erro
 * («Não conseguimos verificar agora») e uma página pública nunca pode jogar o visitante
 * para o login nem mostrar toast por cima.
 */
@Injectable({ providedIn: 'root' })
export class StatusService {
  private readonly http = inject(HttpClient);

  get(): Observable<PublicStatus> {
    return this.http.get<PublicStatus>(`${environment.apiUrl}/public/status`, {
      context: new HttpContext().set(SILENT_HTTP_ERRORS, true),
    });
  }
}
