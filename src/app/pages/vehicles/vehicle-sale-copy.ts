import { VehicleSale } from '../../types/vehicle.types';

/**
 * A explicação ÚNICA de "este veículo está vendido, por isso a tela travou".
 *
 * Existe porque a mesma frase precisa aparecer em telas diferentes — o detalhe
 * (chip, banner e `title` dos botões) e o formulário de edição (FIX-0250) — e
 * duas cópias divergem no primeiro ajuste de texto: uma tela passaria a
 * explicar a regra de um jeito e a outra de outro, para o mesmo estado.
 *
 * A data é formatada aqui, junto do texto, pelo mesmo motivo: o `dd/MM/yyyy` faz
 * parte da frase.
 */
export function soldLockReason(sale: VehicleSale | null | undefined): string | null {
  if (!sale) return null;
  return `Veículo vendido em ${formatSaleDate(sale.saleDate)}. Desfaça a venda para voltar a operar.`;
}

/**
 * O efeito da venda na VAGA do plano (FIX-0262), dito nos dois lados do fluxo:
 * no corpo do diálogo de vender (antes de confirmar) e no banner de vendido
 * (depois). Uma frase só, num lugar só — pelo mesmo motivo de `soldLockReason`.
 *
 * A condicional do "assim que" é DELIBERADA e não pode ser removida: pela regra
 * `OCCUPIES_SLOT` do backend, veículo vendido que ainda tem aluguel
 * RESERVED/ACTIVE continua ocupando a vaga. Um "a venda libera uma vaga"
 * absoluto mentiria exatamente para quem vende um carro alugado. O tom espelha
 * o texto do desfazer ("volta para a frota e ocupa uma vaga do plano").
 */
export const saleReleasesSlotNote =
  'A venda libera uma vaga do plano assim que o veículo não tiver mais aluguel ativo.';

/**
 * `yyyy-MM-dd` → `dd/MM/yyyy`, com a âncora `T00:00:00` para o `Date` não
 * interpretar a string como UTC e voltar um dia (o bug clássico do
 * `new Date('2026-08-20')` no fuso do Brasil).
 */
export function formatSaleDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  if (iso.length === 10) return new Date(iso + 'T00:00:00').toLocaleDateString('pt-BR');
  return new Date(iso).toLocaleDateString('pt-BR');
}
