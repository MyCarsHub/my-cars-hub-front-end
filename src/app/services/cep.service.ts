import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map, of, catchError } from 'rxjs';

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
    return this.http.get<ViaCepResponse>(`https://viacep.com.br/ws/${digits}/json/`).pipe(
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
