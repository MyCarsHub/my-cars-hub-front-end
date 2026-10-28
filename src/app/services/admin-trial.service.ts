import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

/** Motivo FECHADO (lista) — o backend grava o código na auditoria; a nota livre nunca vai para lá. */
export type TrialExtensionReason =
  | 'NEGOTIATION'
  | 'ONBOARDING'
  | 'TECHNICAL_ISSUE'
  | 'GOODWILL'
  | 'OTHER';

export const TRIAL_EXTENSION_REASONS: ReadonlyArray<{ value: TrialExtensionReason; label: string }> = [
  { value: 'NEGOTIATION', label: 'Negociando a assinatura' },
  { value: 'ONBOARDING', label: 'Ainda configurando a conta' },
  { value: 'TECHNICAL_ISSUE', label: 'Problema técnico atrapalhou o teste' },
  { value: 'GOODWILL', label: 'Cortesia' },
  { value: 'OTHER', label: 'Outro' },
];

export const TRIAL_EXTENSION_MIN_DAYS = 1;
export const TRIAL_EXTENSION_MAX_DAYS = 60;

export interface TrialExtensionRequest {
  days: number;
  reason: TrialExtensionReason;
  note: string | null;
}

export interface TrialExtensionResponse {
  companyId: string;
  days: number;
  previousStatus: string;
  status: string;
  /** Novo fim do teste (UTC, como a coluna). */
  trialEndsAt: string;
  /** Quantos destinatários o aviso por e-mail terá (dono + e-mail da empresa, sem repetir). */
  emailRecipients: number;
}

/**
 * "Estender teste" (admin v2 P0). Arquivo próprio, fora de `AdminCompaniesService`,
 * para não colidir com a trilha B que edita aquele serviço.
 */
@Injectable({ providedIn: 'root' })
export class AdminTrialService {
  private readonly http = inject(HttpClient);

  extend(companyId: string, request: TrialExtensionRequest): Observable<TrialExtensionResponse> {
    return this.http.post<TrialExtensionResponse>(
      `${environment.apiUrl}/admin/companies/${companyId}/trial-extension`,
      request,
    );
  }
}
