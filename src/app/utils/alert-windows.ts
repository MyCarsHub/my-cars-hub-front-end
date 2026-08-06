/**
 * Formatação compartilhada das janelas de aviso entre `/alertas` (chips) e
 * Configurações → Avisos de vencimento (lista editável). Uma cópia só para as
 * duas telas não divergirem no plural.
 */

/** "1 dia" / "N dias" — a janela de 1 dia não pode sair no plural. */
export function alertWindowLabel(days: number): string {
  return days === 1 ? '1 dia' : `${days} dias`;
}

/** Ordem decrescente, como o backend armazena. Não muta a entrada. */
export function sortWindowsDesc(windows: readonly number[]): number[] {
  return [...windows].sort((a, b) => b - a);
}

/** Ordem crescente — a ordem em que os chips aparecem em `/alertas`. */
export function sortWindowsAsc(windows: readonly number[]): number[] {
  return [...windows].sort((a, b) => a - b);
}

/**
 * "30, 15, 7 e 1 dia" — a unidade acompanha o ÚLTIMO número da frase, então
 * uma lista terminada em 1 fecha no singular.
 */
export function formatAlertWindows(windows: readonly number[]): string {
  const sorted = sortWindowsDesc(windows);
  if (sorted.length === 0) return 'nenhuma janela';

  const last = sorted[sorted.length - 1];
  const unit = last === 1 ? 'dia' : 'dias';
  if (sorted.length === 1) return `${last} ${unit}`;

  const head = sorted.slice(0, -1).join(', ');
  return `${head} e ${last} ${unit}`;
}

/** Mesma lista, independente da ordem. Usado para detectar alteração pendente. */
export function sameWindows(a: readonly number[], b: readonly number[]): boolean {
  if (a.length !== b.length) return false;
  const left = sortWindowsDesc(a);
  const right = sortWindowsDesc(b);
  return left.every((value, index) => value === right[index]);
}
