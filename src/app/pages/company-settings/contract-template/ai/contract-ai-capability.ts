import { HttpClient } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { environment } from '../../../../../environments/environment';
import { TenantResetRegistry } from '../../../../services/tenant-reset.registry';

export type AiCapabilityState = 'unknown' | 'loading' | 'on' | 'off' | 'unavailable';

/**
 * Capacidade de IA, em memória por sessão/empresa. Fica FORA do chunk lazy de propósito:
 * a página só baixa o fluxo quando `enabled()` é true. Erro (403/5xx/rede) vira
 * `unavailable` e NÃO é repetido até a troca de empresa ou fim de sessão.
 */
@Injectable({ providedIn: 'root' })
export class ContractAiCapability {
  private readonly http = inject(HttpClient);
  readonly state = signal<AiCapabilityState>('unknown');
  readonly enabled = computed(() => this.state() === 'on');
  private waiting: Array<(on: boolean) => void> = [];
  private generation = 0;

  constructor() {
    inject(TenantResetRegistry).register(() => {
      this.generation += 1;
      this.state.set('unknown');
      this.waiting = [];
    });
  }

  /** Idempotente: uma chamada por sessão/empresa. `done` roda quando o estado é conhecido. */
  load(done?: (on: boolean) => void): void {
    const s = this.state();
    if (s === 'on' || s === 'off' || s === 'unavailable') {
      done?.(s === 'on');
      return;
    }
    if (done) this.waiting.push(done);
    if (s === 'loading') return;
    this.state.set('loading');
    const gen = this.generation;
    this.http
      .get<{ enabled: boolean }>(`${environment.apiUrl}/settings/contract-template/ai-capability`)
      .subscribe({
        next: (res) => this.settle(gen, res?.enabled === true ? 'on' : 'off'),
        error: () => this.settle(gen, 'unavailable'),
      });
  }

  private settle(gen: number, state: AiCapabilityState): void {
    if (gen !== this.generation) return; // resposta de outra empresa
    this.state.set(state);
    const cbs = this.waiting;
    this.waiting = [];
    for (const cb of cbs) cb(state === 'on');
  }
}
