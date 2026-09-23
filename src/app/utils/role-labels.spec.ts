import { describe, expect, it } from 'vitest';
import { COMPANY_ROLE_LABELS, companyRoleLabel } from './role-labels';

describe('role-labels', () => {
  /**
   * FIX-0394 — a palavra de OWNER é "Dono", a da sidebar (superfície vista em
   * toda tela), e não "Proprietário", que só aparecia ao convidar e no perfil.
   * MANAGER é "Gerenciador", já em produção; não se troca palavra que o
   * usuário já viu.
   */
  it('usa as três palavras decididas para CompanyRole', () => {
    expect(companyRoleLabel('OWNER')).toBe('Dono');
    expect(companyRoleLabel('MANAGER')).toBe('Gerenciador');
    expect(companyRoleLabel('DRIVER')).toBe('Motorista');
  });

  it('não traduz OWNER como "Proprietário" em lugar nenhum', () => {
    expect(Object.values(COMPANY_ROLE_LABELS)).not.toContain('Proprietário');
    expect(Object.values(COMPANY_ROLE_LABELS)).not.toContain('Gerente');
  });

  /**
   * Cair no valor bruto é deliberado: uma divergência com o backend (papel novo
   * que o frontend ainda não conhece) tem de ficar VISÍVEL, não sumir da tela.
   */
  it('cai no valor bruto quando o papel é desconhecido', () => {
    expect(companyRoleLabel('AUDITOR')).toBe('AUDITOR');
    expect(companyRoleLabel('')).toBe('');
  });

  /**
   * SystemRole (USER | PLATFORM_ADMIN) é o OUTRO eixo de papel, do
   * `admin.guard`. Não pertence a este mapa: se alguém o acrescentar aqui,
   * `admin-users.ts` e `admin-user-detail.ts` passam a disputar a tradução.
   */
  it('não conhece SystemRole — é outro eixo', () => {
    expect(COMPANY_ROLE_LABELS['PLATFORM_ADMIN']).toBeUndefined();
    expect(COMPANY_ROLE_LABELS['USER']).toBeUndefined();
    expect(companyRoleLabel('PLATFORM_ADMIN')).toBe('PLATFORM_ADMIN');
  });

  /** Um papel novo deve exigir editar só este mapa. */
  it('expõe exatamente os três papéis de empresa', () => {
    expect(Object.keys(COMPANY_ROLE_LABELS).sort()).toEqual(['DRIVER', 'MANAGER', 'OWNER']);
  });
});
