/**
 * Strip everything that isn't a digit from a string.
 * Used to normalize masked CPF / CNPJ / phone before POST'ing to the API.
 * Pure — safe for use in signals/computed.
 */
export function stripDigits(value: string | null | undefined): string {
  if (!value) return '';
  return value.replace(/\D/g, '');
}
