/** Teto do backend para `installments` em `generate` (`IpvaInstallmentService.MAX_INSTALLMENTS`). */
export const MAX_IPVA_INSTALLMENTS = 12;

/**
 * Prévia da divisão do "Gerar parcelas", com a mesma regra do backend: divisão inteira em
 * centavos e o resto nas primeiras. `null` enquanto o total ou a contagem não valem.
 * Usada pela Gerência do veículo e pela folha "Adicionar IPVA" da página da frota.
 */
export function ipvaSplitPreview(
  totalCents: number | null,
  count: number,
  money: (cents: number) => string,
): string | null {
  if (!totalCents || !Number.isInteger(count) || count < 1 || count > MAX_IPVA_INSTALLMENTS) {
    return null;
  }
  const base = Math.floor(totalCents / count);
  const rest = totalCents - base * count;
  if (count === 1) return `Cota única de ${money(totalCents)}.`;
  if (rest === 0) return `${count}x de ${money(base)}.`;
  return (
    `${rest}x de ${money(base + 1)} e ${count - rest}x de ${money(base)}` +
    ' — os centavos que sobram entram nas primeiras.'
  );
}
