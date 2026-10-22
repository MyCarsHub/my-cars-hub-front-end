import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../../../../environments/environment';
import { ApiErrorService } from '../../../../services/api-error.service';
import { TenantResetRegistry } from '../../../../services/tenant-reset.registry';
import { ContractTemplateDto } from '../contract-template-service';
import { errorCode } from '../ai/contract-ai.messages';
import {
  CONTRACT_BASE_DISABLED,
  ContractBase,
  ContractBaseSaveRequest,
} from './contract-base.types';

const BASE = `${environment.apiUrl}/settings/contract-template/base`;

/** `off` = flag desligada (o caminho aparece com «Em breve»); `error` = falhou de outro jeito. */
export type BaseAvailability = 'unknown' | 'loading' | 'on' | 'off' | 'error';

/**
 * Texto-base do «Montar do zero». Uma leitura por empresa; nada vai para a sessão (as
 * escolhas são poucas e refazê-las custa menos que guardar contrato no navegador).
 */
@Injectable({ providedIn: 'root' })
export class ContractBaseService {
  private readonly http = inject(HttpClient);
  private readonly apiErrors = inject(ApiErrorService);

  readonly availability = signal<BaseAvailability>('unknown');
  readonly base = signal<ContractBase | null>(null);
  readonly enabled = computed(() => this.availability() === 'on');
  private generation = 0;

  constructor() {
    inject(TenantResetRegistry).register(() => this.reset());
  }

  reset(): void {
    this.generation += 1;
    this.availability.set('unknown');
    this.base.set(null);
  }

  /** Idempotente enquanto a resposta vale; `force` relê (o «Tentar novamente»). */
  load(force = false): void {
    const s = this.availability();
    if (s === 'loading') return;
    if (!force && (s === 'on' || s === 'off')) return;
    this.availability.set('loading');
    const gen = this.generation;
    this.http.get<ContractBase>(BASE).subscribe({
      next: (base) => {
        if (gen !== this.generation) return;
        this.base.set(base);
        this.availability.set('on');
      },
      error: (err: HttpErrorResponse) => {
        if (gen !== this.generation) return;
        // A tela mostra o estado; o interceptor não precisa avisar de novo.
        this.apiErrors.claim(err);
        this.base.set(null);
        const disabled = err.status === 404 && errorCode(err) === CONTRACT_BASE_DISABLED;
        this.availability.set(disabled ? 'off' : 'error');
      },
    });
  }

  save(optionalClauseIds: readonly string[]): Observable<ContractTemplateDto> {
    const base = this.base();
    const body: ContractBaseSaveRequest = {
      version: base?.version ?? '',
      optionalClauseIds: [...optionalClauseIds],
    };
    return this.http.post<ContractTemplateDto>(`${BASE}/save`, body);
  }
}
