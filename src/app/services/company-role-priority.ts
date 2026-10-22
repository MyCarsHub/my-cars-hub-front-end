/**
 * Prioridade do papel numa empresa: OWNER > MANAGER > DRIVER; papel desconhecido por último.
 *
 * É a regra do login (quem é dono de alguma empresa entra como dono; gerente que não é dono
 * entra como gerente; só motorista entra como motorista) e a ordem da lista de empresas. O
 * backend aplica a mesma regra (`MembershipViews.roleRank`); repetida aqui para que um backend
 * atrasado no deploy, que ainda mande a "última empresa usada" como padrão, não devolva um
 * dono para o perfil de motorista.
 */
export function companyRoleRank(role: string | null | undefined): number {
  switch (role) {
    case 'OWNER':
      return 0;
    case 'MANAGER':
      return 1;
    case 'DRIVER':
      return 2;
    default:
      return 3;
  }
}

/**
 * Cópia ordenada pelo papel. `Array.prototype.sort` é estável: dentro do mesmo papel fica a
 * ordem recebida do backend (vínculo mais antigo primeiro).
 */
export function sortByRolePriority<T>(items: readonly T[], roleOf: (item: T) => string | null | undefined): T[] {
  return [...items].sort((a, b) => companyRoleRank(roleOf(a)) - companyRoleRank(roleOf(b)));
}

/**
 * A empresa em que a sessão NOVA entra: só as do papel mais alto concorrem; dentro dele vence
 * a `preferredId` do backend (a usada por último nesse papel) e, sem ela, a primeira da lista.
 */
export function pickLoginCompany<T extends { companyId: string; role: string }>(
  companies: readonly T[],
  preferredId?: string | null,
): T | undefined {
  if (companies.length === 0) return undefined;
  const topRank = Math.min(...companies.map((c) => companyRoleRank(c.role)));
  const topRole = companies.filter((c) => companyRoleRank(c.role) === topRank);
  return (preferredId ? topRole.find((c) => c.companyId === preferredId) : undefined) ?? topRole[0];
}
