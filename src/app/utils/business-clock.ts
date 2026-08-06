/**
 * Relógio de NEGÓCIO da aplicação — horário de Brasília, não o do navegador.
 *
 * O backend trata datas e horas de aluguel como horário de parede de
 * `America/Sao_Paulo` (ver `OverdueFeeCalculator`: nenhuma conversão de fuso
 * acontece lá, os dois instantes são comparados direto). Um operador em Manaus
 * (UTC−4) que preenchesse a devolução com o relógio do próprio navegador
 * mandaria uma hora ATRASADA em relação ao prazo — o que, na fronteira da
 * tolerância, é a diferença entre R$ 0,00 e uma diária cheia.
 *
 * Usa só `Intl`, que existe no navegador e no Node do SSR — nenhuma
 * dependência de fuso adicional no projeto.
 */
export const BUSINESS_TIME_ZONE = 'America/Sao_Paulo';

/**
 * `en-CA` porque é o locale cujo formato numérico curto já é `yyyy-MM-dd` —
 * o mesmo que `<input type="date">` consome, sem remontar as partes na mão.
 */
const DATE_FMT = new Intl.DateTimeFormat('en-CA', {
  timeZone: BUSINESS_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** `hourCycle: 'h23'` para a meia-noite sair `00:00` e não `24:00`. */
const TIME_FMT = new Intl.DateTimeFormat('en-GB', {
  timeZone: BUSINESS_TIME_ZONE,
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/** Data corrente em Brasília, `yyyy-MM-dd`. */
export function todayInBusinessTz(now: Date = new Date()): string {
  return DATE_FMT.format(now);
}

/** Hora corrente em Brasília, `HH:mm`. */
export function nowHhMmInBusinessTz(now: Date = new Date()): string {
  return TIME_FMT.format(now);
}
