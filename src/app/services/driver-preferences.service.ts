import { Injectable } from '@angular/core';
import { Observable, of } from 'rxjs';

/** Antecedência do aviso de cobrança, em dias. */
export type ChargeLeadDays = 1 | 2 | 3;

/**
 * Avisos que o MOTORISTA escolhe receber no celular (tela Configurações).
 *
 * CONTRATO A CRIAR NO BACKEND — não existe endpoint hoje (medido em `origin/develop`):
 * `GET /v1/driver/notification-preferences` devolve este objeto e
 * `PUT /v1/driver/notification-preferences` recebe o objeto inteiro e o devolve gravado.
 */
export interface DriverNotificationPrefs {
  chargeDueSoon: boolean;
  chargeOverdue: boolean;
  inspectionRequested: boolean;
  inspectionResult: boolean;
  newFine: boolean;
  chargeLeadDays: ChargeLeadDays;
}

/** Os padrões do protótipo do dono: tudo ligado menos multas, aviso 1 dia antes. */
export const DEFAULT_DRIVER_PREFS: DriverNotificationPrefs = {
  chargeDueSoon: true,
  chargeOverdue: true,
  inspectionRequested: true,
  inspectionResult: true,
  newFine: false,
  chargeLeadDays: 1,
};

/**
 * Porta das preferências do motorista.
 *
 * SEM BACKEND AINDA: guarda em memória, só durante a sessão da aba — por isso a tela não está
 * ligada ao menu de produção (`DRIVER_PROD_ROUTES.configuracoes` é `null`). Quando o contrato
 * acima existir, troque o corpo dos dois métodos por `HttpClient` e nada mais muda.
 */
@Injectable({ providedIn: 'root' })
export class DriverPreferencesService {
  private current: DriverNotificationPrefs = { ...DEFAULT_DRIVER_PREFS };

  get(): Observable<DriverNotificationPrefs> {
    return of({ ...this.current });
  }

  update(prefs: DriverNotificationPrefs): Observable<DriverNotificationPrefs> {
    this.current = { ...prefs };
    return of({ ...this.current });
  }
}
