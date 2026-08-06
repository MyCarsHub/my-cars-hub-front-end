/**
 * Trilha de auditoria administrativa — `GET /v1/admin/audit`.
 *
 * `action` e `targetType` chegam como o `name()` cru do enum do backend
 * (`AdminAuditAction` / `AdminAuditTargetType`). São `string`, e não uniões
 * fechadas, de propósito: o vocabulário cresce a cada ação nova auditada e o
 * filtro é populado por `GET /v1/admin/audit/actions`. Fechar o tipo aqui
 * obrigaria a editar o frontend a cada valor novo — e quebraria a leitura da
 * trilha histórica, que é append-only.
 */
export interface AdminAuditLogItem {
  id: string;
  /** `LocalDateTime` serializado sem offset (ex.: `2026-08-04T13:45:12.12`). */
  createdDate: string;
  /** `null` quando o ator já não existe mais na base. */
  actorUserId: string | null;
  actorName: string | null;
  actorEmail: string | null;
  action: string;
  targetType: string;
  /** `null` para ações sem alvo individual (ex.: disparo de teste). */
  targetId: string | null;
  /** Resumo textual truncado em 500 chars pelo backend. */
  payload: string | null;
}

export interface AdminAuditQuery {
  actorUserId?: string | null;
  action?: string | null;
  /** `yyyy-MM-dd`. O dia de `to` entra inteiro no filtro do backend. */
  from?: string | null;
  to?: string | null;
  page?: number;
  size?: number;
}

/** Ator disponível no filtro — subconjunto de `AdminUserListItem`. */
export interface AdminAuditActor {
  id: string;
  name: string | null;
  email: string;
}
