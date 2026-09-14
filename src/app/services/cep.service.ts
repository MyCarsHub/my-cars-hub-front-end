import { HttpClient, HttpContext } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map, of, catchError } from 'rxjs';
import { SILENT_HTTP_ERRORS } from './http-errors.context';

export interface CepLookupResult {
  street: string;
  district: string;
  city: string;
  uf: string;
}

interface ViaCepResponse {
  logradouro?: string;
  bairro?: string;
  localidade?: string;
  uf?: string;
  erro?: boolean;
}

@Injectable({ providedIn: 'root' })
export class CepService {
  private readonly http = inject(HttpClient);

  lookup(cep: string): Observable<CepLookupResult | null> {
    const digits = cep.replace(/\D/g, '');
    if (digits.length !== 8) return of(null);
    // O ViaCEP é de OUTRO host, e o `errorInterceptor` não pode falar por ele: sem a
    // marca, status 0 virava "Sem conexão com o servidor." e 4xx caía na rede de
    // segurança, culpando a API do MyCarsHub — que está no ar — por uma indisponibilidade
    // de terceiro. Pior: um 401 do ViaCEP limpava a sessão e mandava para o /login. A
    // tela já mostra o aviso inline e o formulário segue salvável à mão (FIX-0107).
    return this.http
      .get<ViaCepResponse>(`https://viacep.com.br/ws/${digits}/json/`, {
        context: new HttpContext().set(SILENT_HTTP_ERRORS, true),
      })
      .pipe(
      map((res) => {
        if (res.erro) return null;
        return {
          street: res.logradouro ?? '',
          district: res.bairro ?? '',
          city: res.localidade ?? '',
          uf: (res.uf ?? '').toUpperCase(),
        };
      }),
      catchError(() => of(null)),
    );
  }
}
