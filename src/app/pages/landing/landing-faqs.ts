/**
 * Single source of truth for the FAQ the landing RENDERS.
 *
 * Extracted from `landing-faq.component.ts` for the same reason `landing-plans.ts`
 * exists: the `FAQPage` JSON-LD must quote the questions and answers the visitor
 * actually reads. Google's structured-data policy treats marked-up FAQ content that
 * is not visible on the page as a violation, so both consumers read this array —
 * they cannot drift apart.
 *
 * Números citados nas respostas (limites de plano, dias de trial) vêm de
 * `utils/plan-limits.ts` e `landing-plans.ts`. Se um mudar lá, atualize aqui.
 */
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
    a: 'É sim. O trial gratuito cobre até 3 veículos e 4 motoristas, então dá pra rodar seu único contrato do começo ao fim sem pagar nada. O sistema não muda quando você tem 1 carro ou 20 — muda só o tamanho da sua lista.',
  },
  {
    q: 'Preciso de cartão de crédito pra começar?',
    a: 'Não. O trial de 14 dias é completo e sem cartão. Você só paga se decidir continuar.',
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
    a: 'No trial, até 3. No plano Pro, até 20. Enterprise é sob consulta para frotas grandes ou multi-filial.',
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
