import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { PRIORITY_SUPPORT_FEATURE } from '../../utils/plan-features';

/**
 * Guarda as PROMESSAS POR TIER da tela de planos autenticada.
 *
 * `plan-features.spec.ts` já proíbe que uma função exclusiva de tier entre nos
 * CARDS, mas os cards não eram o único lugar da tela que prometia coisas: a
 * tabela comparativa, um scroll abaixo deles, mantinha as suas próprias linhas
 * escritas à mão e gastava `isRecommended()` como se fosse um gate de produto.
 * O resultado foi uma tela só fazendo duas afirmações diferentes — o card do
 * ENTERPRISE anunciava atendimento prioritário enquanto a coluna do ENTERPRISE,
 * na mesma tela, marcava travessão na linha de suporte; e o PRO ganhava
 * "Relatórios avançados", que não existe em linha de código nenhuma.
 *
 * Enquanto a tabela puder escrever uma linha nova em HTML puro, ela é a porta
 * dos fundos do spec dos cards. Este arquivo fecha a porta: qualquer promessa
 * por tier na tabela tem de sair de `utils/plan-features.ts`.
 *
 * Por que ler o ARQUIVO e não o DOM: o que reabre o buraco é alguém digitar uma
 * linha nova no template. Um teste de DOM só pegaria a regressão se o caso do
 * tier certo estivesse montado; o texto pega a digitação, que é o gesto real.
 */

const TEMPLATE = 'src/app/pages/billing/billing.html';

function workspaceRoot(): string {
  let dir = process.cwd();
  for (let depth = 0; depth < 8; depth++) {
    if (existsSync(join(dir, 'angular.json'))) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(`Could not find angular.json walking up from ${process.cwd()}`);
}

/**
 * O template SEM comentários. As asserções falam do que a tela RENDERIZA; um
 * comentário que explique por que uma linha saiu cita a linha pelo nome, e
 * bater nele transformaria a documentação da correção em falha de teste.
 */
function renderedTemplate(): string {
  const full = resolve(workspaceRoot(), TEMPLATE);
  expect(existsSync(full), `${TEMPLATE} is missing`).toBe(true);
  return readFileSync(full, 'utf8').replace(/<!--[\s\S]*?-->/g, '');
}

describe('billing — promessas por tier fora dos cards', () => {
  /**
   * A categoria PROIBIDA é a mesma de `plan-features.spec.ts`: capacidade de
   * SOFTWARE. O backend aplica exatamente dois limites (`vehicle_limit`,
   * `driver_limit`) e nenhum gate de funcionalidade, então uma função anunciada
   * como exclusiva de um plano é mentira no ar — venha ela do card ou da tabela.
   */
  it('não anuncia nenhuma FUNÇÃO exclusiva de tier na tela de planos', () => {
    const html = renderedTemplate() + readFileSync(resolve(workspaceRoot(), 'src/app/pages/billing/billing.ts'), 'utf8');

    for (const claim of [
      'Relatórios avançados',
      'Relatórios avançados exportáveis',
      'Integrações premium',
      'Gerente de conta',
      'Suporte dedicado',
      'Onboarding assistido dedicado',
    ]) {
      expect(html, `${TEMPLATE} voltou a prometer "${claim}"`).not.toContain(claim);
    }
  });

  /**
   * A grade nova (2026-10-29) monta as linhas em `billing.ts`, não no HTML. A
   * mesma porta dos fundos vale lá: capacidade e atendimento prioritário saem
   * das fontes compartilhadas, nunca de um literal por tier.
   */
  it('a grade deriva capacidade e prioridade das fontes compartilhadas', () => {
    const ts = readFileSync(resolve(workspaceRoot(), 'src/app/pages/billing/billing.ts'), 'utf8');
    expect(ts).toContain('hasPrioritySupport(tier)');
    expect(ts).toContain('planCapacityLines(tier)');
    expect(ts).not.toContain(PRIORITY_SUPPORT_FEATURE);
    expect(ts).not.toMatch(/Até \d+ veículos/);
  });

  it('o template não digita nenhuma linha de plano', () => {
    const html = renderedTemplate();
    expect(html).not.toContain('Suporte prioritário');
    expect(html).not.toMatch(/Até \d+ veículos/);
  });
});
