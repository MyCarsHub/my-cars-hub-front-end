import { HttpClient } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { Observable, catchError, map, of, shareReplay, tap } from 'rxjs';
import { environment } from '../../environments/environment';
import { AdminCapabilityCode, AdminSelf } from '../types/admin-roles.types';

/**
 * Papel e capacidades do admin logado (`GET /v1/admin/me`), para ESCONDER o
 * que ele não pode fazer. Não é controle de acesso: toda rota de admin confere
 * de novo no servidor e responde 403.
 *
 * Falha fechada: sem resposta, nenhuma capacidade.
 */
@Injectable({ providedIn: 'root' })
export class AdminCapabilitiesService {
  private readonly http = inject(HttpClient);

  private readonly _self = signal<AdminSelf | null>(null);
  private inflight: Observable<AdminSelf | null> | null = null;

  readonly self = this._self.asReadonly();
  readonly capabilities = computed(() => new Set<AdminCapabilityCode>(this._self()?.capabilities ?? []));

  can(code: AdminCapabilityCode): boolean {
    return this.capabilities().has(code);
  }

  /** Carrega uma vez por sessão; chamadas concorrentes compartilham a mesma requisição. */
  ensureLoaded(): Observable<AdminSelf | null> {
    const current = this._self();
    if (current) return of(current);
    if (!this.inflight) {
      this.inflight = this.http.get<AdminSelf>(`${environment.apiUrl}/admin/me`).pipe(
        tap((me) => this._self.set(me)),
        map((me) => me as AdminSelf | null),
        catchError(() => of(null)),
        tap(() => (this.inflight = null)),
        shareReplay(1),
      );
    }
    return this.inflight;
  }

  /** Depois de trocar de conta ou de papel. */
  reset(): void {
    this._self.set(null);
    this.inflight = null;
  }
}
