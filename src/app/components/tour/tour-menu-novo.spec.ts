import { describe, expect, it } from 'vitest';
import { TOUR_ANCHORS, TOUR_STEPS } from './tour.types';
import { NAV_ITEMS } from '../sidebar/sidebar';

/**
 * Menu novo (13/11): três passos do tour mudaram de lugar. Relatórios mora no grupo
 * Financeiro (o tour abre o grupo antes), o Roadmap é a aba de Novidades (a âncora é a linha
 * Novidades do pé) e os vencimentos moram no sino (fora da barra lateral, último passo).
 */
describe('tour guiado × menu novo', () => {
  const step = (key: string) => TOUR_STEPS.find((s) => s.key === key)!;

  it('Relatórios abre o grupo Financeiro, que carrega a âncora', () => {
    expect(step(TOUR_ANCHORS.reports).expandGroup).toBe(TOUR_ANCHORS.financeGroup);
    const financeiro = NAV_ITEMS.find((i) => i.tourKey === TOUR_ANCHORS.financeGroup)!;
    expect(financeiro.label).toBe('Financeiro');
    expect(financeiro.children?.some((c) => c.tourKey === TOUR_ANCHORS.reports)).toBe(true);
  });

  it('Roadmap aponta para a linha Novidades do pé', () => {
    const novidades = NAV_ITEMS.find((i) => i.route === '/novidades')!;
    expect(novidades.tourKey).toBe(TOUR_ANCHORS.roadmap);
    expect(novidades.pinBottom).toBe(true);
    expect(step(TOUR_ANCHORS.roadmap).inSidebar).toBe(true);
  });

  it('Alertas é o sino: fora da barra lateral, último passo, só dono e gerente', () => {
    const alerts = step(TOUR_ANCHORS.alerts);
    expect(alerts.inSidebar).toBe(false);
    expect(TOUR_STEPS[TOUR_STEPS.length - 1]).toBe(alerts);
    expect(alerts.roles).toEqual(['OWNER', 'MANAGER']);
    expect(NAV_ITEMS.some((i) => i.tourKey === TOUR_ANCHORS.alerts)).toBe(false);
  });
});
