/**
 * Single source of truth for the FAQ the landing RENDERS.
 *
 * Extracted from `landing-faq.component.ts` for the same reason `landing-plans.ts`
 * exists: the `FAQPage` JSON-LD must quote the questions and answers the visitor
 * actually reads. Google's structured-data policy treats marked-up FAQ content that
 * is not visible on the page as a violation, so both consumers read this array —
 * they cannot drift apart.
 *
 * <h4>Números são INTERPOLADOS, nunca digitados</h4>
 * Todo teto de plano sai de `PLAN_CAPACITY` e todo prazo de teste sai de
 * `PLAN_PRICES` — ver `utils/plan-limits.ts` e `landing-plans.ts`. A resposta
 * sobre quantos veículos cabem dizia "No plano Pro, até 20" enquanto a V59
 * vende 25 e o card logo acima anunciava um terceiro número: cópias manuais da
 * mesma linha do banco, nenhuma coberta por teste. Interpolando, a próxima
 * migration corrige a página e o JSON-LD de uma vez só.
 *
 * O ENTERPRISE é a exceção deliberada: ele NÃO imprime número. O teto real de
 * veículos é guarda-corpo técnico — existe para que uma entrada absurda não
 * quebre o sistema — e não limite comercial, então a UI o apresenta como
 * ilimitado, a mesma maquiagem que `planPresentsAsUnlimited()` aplica no card
 * de planos e no dashboard. Escrever o número aqui desmentiria as outras telas.
 */
import { PLAN_CAPACITY } from '../../utils/plan-limits';
import { PLAN_PRICES } from './landing-plans';

export interface LandingFaq {
  readonly q: string;
  readonly a: string;
}

export const LANDING_FAQS: readonly LandingFaq[] = [
  {
    q: 'O que é o MyCarsHub?',
    a: 'Um sistema de gestão para quem aluga carros — principalmente para motorista de aplicativo. Contratos, cobranças, multas, manutenções e financeiro num lugar só, sem planilha.',
  },
  {
    q: 'Tenho só 1 carro alugado. O MyCarsHub é pra mim?',
    a: `É sim. O trial gratuito cobre até ${PLAN_CAPACITY.TRIAL.vehicles} veículos e ${PLAN_CAPACITY.TRIAL.drivers} motoristas, então dá pra rodar seu único contrato do começo ao fim sem pagar nada. O sistema não muda quando você tem 1 carro ou ${PLAN_CAPACITY.PRO.vehicles} — muda só o tamanho da sua lista.`,
  },
  {
    q: 'Preciso de cartão de crédito pra começar?',
    a: `Não. O trial de ${PLAN_PRICES.trialDays} dias é completo e sem cartão. Você só paga se decidir continuar.`,
  },
  {
    q: 'O MyCarsHub processa pagamentos?',
    a: 'Não diretamente. A gente integra com o gateway que você já usa (Pix, boleto, cartão). Emitimos a cobrança e sincronizamos o status por webhook — o recebimento fica no seu PSP.',
  },
  {
    q: 'Consigo usar com mais de uma empresa?',
    a: 'Sim. Você pode ser dono de uma locadora, gestor de outra e motorista de uma terceira — tudo no mesmo login, trocando em 1 clique.',
  },
  {
    q: 'Quantos veículos posso cadastrar?',
    a: `No trial, até ${PLAN_CAPACITY.TRIAL.vehicles}. No Starter, até ${PLAN_CAPACITY.STARTER.vehicles}. No Pro, até ${PLAN_CAPACITY.PRO.vehicles}. O Enterprise é vendido como ilimitado, pra frotas grandes ou multi-filial.`,
  },
  {
    q: 'Tem suporte em português?',
    a: 'Sim. Somos brasileiros, o suporte é em PT-BR e o produto foi desenhado pra realidade de quem aluga carro no Brasil.',
  },
  {
    q: 'Posso cancelar a qualquer momento?',
    a: 'Sim. Sem fidelidade, sem multa. Cancele quando quiser direto na plataforma.',
  },
];
