/** Contrato de `GET /v1/public/status` (público, anônimo, em cache de 60 s no servidor). */
export type StatusLevel = 'OPERATIONAL' | 'SLOW' | 'DOWN' | 'UNKNOWN';
export type OverallStatus = 'OPERATIONAL' | 'DEGRADED' | 'OUTAGE' | 'UNKNOWN';
export type StatusComponentKey =
  | 'AUTH'
  | 'RENTALS'
  | 'PAYMENTS'
  | 'EMAIL'
  | 'SIGNATURE'
  | 'DRIVER_APP';

export interface StatusDay {
  /** Dia de Brasília, `YYYY-MM-DD`. */
  date: string;
  status: StatusLevel;
  /** Porcentagem de verificações boas (0-100); `null` = sem medida nesse dia. */
  uptime: number | null;
}

export interface StatusComponent {
  key: StatusComponentKey;
  status: StatusLevel;
  since: string | null;
  /** Do mais antigo ao mais recente, até 90 dias. */
  days: StatusDay[];
}

export interface StatusIncident {
  components: StatusComponentKey[];
  kind: 'DOWN' | 'SLOW';
  startedAt: string;
  resolvedAt: string | null;
}

export interface PublicStatus {
  generatedAt: string;
  overall: OverallStatus;
  since: string | null;
  components: StatusComponent[];
  incidents: StatusIncident[];
}
