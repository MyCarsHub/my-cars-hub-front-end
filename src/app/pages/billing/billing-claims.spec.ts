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
  it('não anuncia nenhuma FUNÇÃO exclusiva de tier na tabela comparativa', () => {
    const html = renderedTemplate();

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
   * `isRecommended()` responde "qual card leva a fita 'Mais popular'?" — e a
   * resposta é só o PRO. Usá-lo para decidir ✓/— numa linha de entrega foi como
   * o ENTERPRISE, que paga por prioridade, levou travessão. Ele pode continuar
   * pintando fita e destaque; não pode voltar a conceder nada.
   */
  it('não deriva nenhuma entrega de isRecommended() — aquilo é destaque, não gate', () => {
    const html = renderedTemplate();
    const uses = html.match(/isRecommended\(/g) ?? [];

    // As duas únicas sobreviventes são as fitas "Recomendado" (desktop) e
    // "Popular" (mobile). Uma terceira significa que a fita virou gate de novo.
    expect(uses).toHaveLength(2);
    expect(html).toContain('Recomendado');
    expect(html).toContain('Popular');
  });

  /**
   * A prioridade de atendimento é a ÚNICA promessa que pode variar por tier
   * (compromisso operacional, não software). Ela aparece nos cards e na tabela,
   * e as duas superfícies têm de ler a MESMA fonte — foi haver duas regras que
   * produziu a contradição.
   */
  it('lê a prioridade de atendimento da fonte compartilhada, não de uma regra local', () => {
    const html = renderedTemplate();

    expect(html).toContain('hasPrioritySupport(plan)');
    // Desktop (tabela) e mobile (accordion): as duas superfícies, o mesmo gate.
    expect(html.match(/hasPrioritySupport\(plan\)/g) ?? []).toHaveLength(2);
  });

  /**
   * E o RÓTULO também sai de lá. A tabela dizia "Suporte prioritário" enquanto o
   * card, a um scroll de distância, prometia "Atendimento prioritário no
   * WhatsApp": duas grafias da mesma promessa, uma delas sem nomear o canal.
   * Digitar a frase no HTML é o primeiro passo para elas divergirem de novo.
   */
  it('imprime o rótulo da prioridade interpolado, nunca digitado no HTML', () => {
    const html = renderedTemplate();

    expect(html).toContain('{{ prioritySupportLabel }}');
    expect(html.match(/\{\{ prioritySupportLabel \}\}/g) ?? []).toHaveLength(2);
    expect(html).not.toContain('Suporte prioritário');
    expect(html).not.toContain(PRIORITY_SUPPORT_FEATURE);
  });
});
