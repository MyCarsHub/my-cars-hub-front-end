import { RentalChargeDto } from '../types/rental.types';

/**
 * Criterios de COBRANCA NO GATEWAY, compartilhados pelos dois caminhos que
 * avisam sobre o Asaas: CONCLUIR/CANCELAR (`end-rental-dialog`) e EXCLUIR
 * (o dialogo de confirmacao em `rental-detail`).
 *
 * POR QUE COMPARTILHADO: o aviso indevido foi relatado nos DOIS. Corrigir so um
 * deixaria o defeito vivo no outro, e a proxima pessoa acharia que ja estava
 * resolvido porque viu a tela certa.
 *
 * >>> O SINAL E O `externalId`, NAO O `provider` E NAO O `automaticCharge` <<<
 * `RentalChargeDto.provider` e tipado como o literal 'ASAAS' (rental.types.ts:112):
 * ele vale 'ASAAS' em TODA cobranca, inclusive nas que nunca foram ao gateway.
 * Um criterio baseado nele seria sempre verdadeiro — exatamente o defeito que
 * estamos consertando, so que escrito de outro jeito.
 * `automaticCharge` tambem nao serve: e a flag do ALUGUEL, diz o que foi pedido
 * na criacao, nao o que existe hoje no gateway (a mesma armadilha ja documentada
 * para a caucao em `end-rental-dialog.ts`).
 * O que prova que a cobranca EXISTE la e o `externalId`: e o id dela no Asaas.
 */

/** Status de cobranca que ainda pode ser cobrada — nao foi paga nem encerrada. */
const OPEN_STATUSES = new Set(['PENDING', 'PAST_DUE']);

/** Ha ALGUMA cobranca deste aluguel registrada no gateway? */
export function hasGatewayCharges(charges: readonly RentalChargeDto[]): boolean {
  return charges.some((c) => !!c.externalId);
}

/**
 * Cobrancas em aberto que AINDA NAO VENCERAM e existem no gateway — as que o
 * encerramento apaga no Asaas sem perguntar.
 *
 * Sem `dueDate` (RENTAL_TOTAL/CAUCAO legados, ver rental.types.ts:117) conta
 * como nao vencida: o encerramento as apaga, e omitir do aviso esconderia o que
 * vai acontecer.
 */
export function openNotOverdueGatewayCharges(
  charges: readonly RentalChargeDto[],
  todayIso: string,
): RentalChargeDto[] {
  return charges.filter(
    (c) => !!c.externalId && OPEN_STATUSES.has(c.status) && (c.dueDate === null || c.dueDate >= todayIso),
  );
}

/**
 * Cobrancas VENCIDAS e nao pagas no gateway — as que so somem se o dono marcar
 * o opt-in destrutivo. Sem nenhuma delas, a opcao nao tem sobre o que agir e
 * nao deve ocupar espaco no dialogo.
 */
export function overdueUnpaidGatewayCharges(
  charges: readonly RentalChargeDto[],
  todayIso: string,
): RentalChargeDto[] {
  return charges.filter(
    (c) => !!c.externalId && OPEN_STATUSES.has(c.status) && c.dueDate !== null && c.dueDate < todayIso,
  );
}

/**
 * O aviso sobre o destino das cobrancas so faz sentido quando existe cobranca no
 * gateway que a acao vai tocar. Aluguel quitado, ou criado sem cobranca
 * automatica, nao recebe aviso nenhum — era o caso do aluguel real em que o
 * defeito foi visto: 7 parcelas PAGAS, Asaas desligado, e o dialogo falava de um
 * gateway que nao estava envolvido.
 */
export function shouldWarnAboutGatewayCharges(
  charges: readonly RentalChargeDto[],
  todayIso: string,
): boolean {
  return (
    openNotOverdueGatewayCharges(charges, todayIso).length > 0 ||
    overdueUnpaidGatewayCharges(charges, todayIso).length > 0
  );
}
