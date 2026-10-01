import { RENTAL_PHOTO_ANGLES } from '../../types/rental.types';

/**
 * Rótulo do ângulo EM PORTUGUÊS — o backend manda a chave, a pessoa lê o nome.
 *
 * ## Por que em português, e por que isto não é preferência de estilo
 *
 * Quem usa esta tela tem 35+ e quer facilidade; quem fotografa está de pé na
 * rua, com o celular na mão. "Front" e "Rear" numa tela brasileira obrigam a
 * pessoa a traduzir antes de saber qual lado do carro fotografar — e quem
 * aprova precisa reconhecer a foto sem decifrar o rótulo.
 *
 * ## A fonte é a lista que já existia
 *
 * Os nomes NÃO foram inventados aqui: vêm de `RENTAL_PHOTO_ANGLES`
 * (`types/rental.types.ts`), a lista canônica dos 14 ângulos que o produto já
 * mostrava no fluxo de aluguel. Vistoria e aluguel usam o MESMO vocabulário —
 * o `InspectionService` do backend importa o mesmo `RentalPhotoAngleEnum` —,
 * então inventar uma segunda tradução daria dois nomes ao mesmo ângulo em
 * telas vizinhas, que é exatamente o defeito que centralizar este helper
 * evitou.
 *
 * ## O que trafega NÃO muda
 *
 * Só o rótulo EXIBIDO é traduzido. A chave (`FRONT`, `BACK`, …) continua sendo
 * o que vai e volta da API, e é por ela que as fotos são indexadas.
 */
const LABELS: ReadonlyMap<string, string> = new Map([
  ...RENTAL_PHOTO_ANGLES.map(({ value, label }) => [value, label] as const),
  /*
   * Apelidos LEGADOS: linhas gravadas antes das migrações V62/V63 ainda trazem
   * `*_PANEL` onde hoje se grava `*_TIRE` (o backend resolve os dois em
   * `RentalPhotoAngleEnum.LEGACY_ALIASES`). Uma vistoria antiga tem de mostrar
   * "Pneu dianteiro esquerdo", e não a chave crua.
   */
  ['FRONT_LEFT_PANEL', 'Pneu dianteiro esquerdo'] as const,
  ['FRONT_RIGHT_PANEL', 'Pneu dianteiro direito'] as const,
  ['REAR_LEFT_PANEL', 'Pneu traseiro esquerdo'] as const,
  ['REAR_RIGHT_PANEL', 'Pneu traseiro direito'] as const,
]);

/**
 * Ângulo desconhecido NÃO vira texto vazio nem quebra a tela: cai no
 * embelezamento da chave, que é o que esta função fazia para todos antes.
 *
 * O roteiro é configurável por empresa (`checklist/{companyId}`), então uma
 * chave fora da lista é possível — e nesse caso mostrar "Custom angle" é
 * melhor que mostrar nada ou adivinhar uma tradução errada.
 */
export function angleLabel(angle: string): string {
  const known = LABELS.get(angle);
  if (known) return known;

  const text = angle.replace(/_/g, ' ').toLowerCase();
  return text.charAt(0).toUpperCase() + text.slice(1);
}
