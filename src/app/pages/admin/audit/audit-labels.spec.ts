import { describe, expect, it } from 'vitest';

import {
  AUDIT_ACTIONS,
  auditActionLabel,
  auditActionTone,
  auditTargetLabel,
  fallbackActionLabel,
} from './audit-labels';

describe('audit-labels', () => {
  it('todo rótulo do mapa é português legível, sem código cru', () => {
    for (const [code, meta] of Object.entries(AUDIT_ACTIONS)) {
      expect(meta.label, code).not.toMatch(/_/);
      expect(meta.label.trim().length, code).toBeGreaterThan(0);
    }
  });

  it('usa só os quatro tons da Auditoria', () => {
    const tones = new Set(Object.values(AUDIT_ACTIONS).map((m) => m.tone));
    for (const tone of tones) expect(['green', 'red', 'amber', 'neutral']).toContain(tone);
  });

  it.each([
    ['USER_REMOVED', 'Usuário excluído', 'red'],
    ['BLOG_POST_CREATED', 'Post criado', 'green'],
    ['COMPANY_STATUS_CHANGED', 'Situação da empresa alterada', 'amber'],
    ['CHARGE_ASAAS_COMPARED', 'Cobrança comparada com o Asaas', 'neutral'],
  ])('%s → "%s" (%s)', (code, label, tone) => {
    expect(auditActionLabel(code)).toBe(label);
    expect(auditActionTone(code)).toBe(tone);
  });

  it('código desconhecido vira frase pelo verbo, com o tom do verbo', () => {
    expect(fallbackActionLabel('COMPANY_PLAN_CHANGED')).toBe('Alteração de empresa plano');
    expect(auditActionLabel('VEHICLE_DELETED')).toBe('Exclusão de veículo');
    expect(auditActionTone('VEHICLE_DELETED')).toBe('red');
    expect(auditActionTone('VEHICLE_CREATED')).toBe('green');
  });

  it('sem verbo conhecido ainda é legível e nunca vazio', () => {
    expect(auditActionLabel('FOO_BAR_ZAPPED')).toBe('Foo bar zapped');
    expect(auditActionTone('FOO_BAR_ZAPPED')).toBe('neutral');
    expect(auditActionLabel('')).toBe('Ação sem nome');
    expect(auditActionLabel(null)).toBe('Ação sem nome');
  });

  it('traduz o tipo do alvo; desconhecido sai legível', () => {
    expect(auditTargetLabel('SUPPORT_TICKET')).toBe('Ticket de suporte');
    expect(auditTargetLabel('ANNOUNCEMENT')).toBe('Novidade');
    expect(auditTargetLabel('VEHICLE')).toBe('Veículo');
    expect(auditTargetLabel(null)).toBe('Sem alvo');
  });
});
