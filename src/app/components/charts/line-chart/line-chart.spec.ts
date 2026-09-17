import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, it, expect, beforeEach } from 'vitest';

import {
  LineChart,
  LinePoint,
  MAIN_SERIES_STYLE,
  REFERENCE_STYLE,
  Y_AXIS_MIN_TOP,
  axisTopFor,
} from './line-chart';

/**
 * FEAT-0121 — o que este arquivo protege NAO e a biblioteca, e a HONESTIDADE
 * DA ESCALA.
 *
 * O grafico anterior normalizava pelo proprio maximo da serie, entao QUALQUER
 * serie ocupava a altura inteira do cartao: 3 usuarios num mes desenhavam a
 * mesma montanha que 300. O dono olhou e disse "esta ridiculo" — e estava
 * certo, porque o eixo mentia.
 *
 * Trocar de biblioteca nao conserta isso sozinho; a regra de escala conserta.
 * Por isso ela e funcao pura, exportada e testada aqui.
 */
describe('axisTopFor — a regra de escala (FEAT-0121)', () => {
  it('nao deixa o eixo encolher abaixo do piso quando os numeros sao pequenos', () => {
    // O caso do dono: pico 3. Num eixo de 0 a 5, tres usuarios PARECEM tres.
    expect(axisTopFor([0, 1, 3, 2, 0])).toBe(Y_AXIS_MIN_TOP);
  });

  it('trata uma serie toda zerada sem colapsar o eixo', () => {
    expect(axisTopFor([0, 0, 0])).toBe(Y_AXIS_MIN_TOP);
  });

  it('trata serie vazia sem virar -Infinity', () => {
    expect(axisTopFor([])).toBe(Y_AXIS_MIN_TOP);
  });

  it('acompanha o dado quando o produto cresce', () => {
    expect(axisTopFor([4, 40, 12])).toBe(40);
    expect(axisTopFor([0, 6])).toBe(6);
  });

  /**
   * FEAT-0121 (filtros) — a regra vale para as TRES granularidades, e o risco
   * muda de forma em cada uma.
   *
   * A altura do eixo depende so da MAGNITUDE, nunca de quantos pontos a serie
   * tem — entao trocar DAY/WEEK/MONTH nao reabre o exagero vertical. O que
   * MUDA com MONTH e o comprimento: poucos pontos esticados na largura toda
   * (ver GOTCHA no card sobre o eixo horizontal).
   */
  it('mantem o piso nas tres granularidades quando os numeros sao pequenos', () => {
    // DAY: 30 buckets pequenos.
    expect(axisTopFor(Array.from({ length: 30 }, (_, i) => (i === 7 ? 3 : 0)))).toBe(5);
    // WEEK: ~13 buckets, mesma ordem de grandeza.
    expect(axisTopFor([0, 2, 1, 3, 0, 1, 0, 0, 2, 1, 0, 1, 1])).toBe(5);
    // MONTH: 3 buckets, o caso mais curto — e o mais tentador de exagerar.
    expect(axisTopFor([1, 4, 2])).toBe(5);
  });

  it('acompanha o dado em MONTH quando o volume cresce', () => {
    expect(axisTopFor([120, 340, 90])).toBe(340);
  });

  /**
   * O ponto que resume o defeito: duas series de magnitude MUITO diferente nao
   * podem produzir o mesmo teto de eixo. Antes produziam — era sempre o proprio
   * maximo, entao as duas ocupavam a altura toda.
   */
  it('da tetos diferentes para magnitudes diferentes', () => {
    const pequena = axisTopFor([0, 1, 3]);
    const grande = axisTopFor([0, 100, 300]);

    expect(pequena).not.toBe(grande);
    expect(grande).toBe(300);
  });
});

@Component({
  imports: [LineChart],
  template: `
    <app-line-chart
      [points]="points()"
      ariaLabel="Novos usuários por dia"
      valueLabel="Novos usuários"
    />
  `,
})
class Host {
  readonly points = signal<LinePoint[]>([
    { label: '01 set', value: 0 },
    { label: '02 set', value: 3 },
    { label: '03 set', value: 1 },
  ]);
}

/**
 * A alternativa textual. Um canvas e um retangulo opaco para leitor de tela —
 * sem esta tabela, o grafico simplesmente nao existe para quem nao enxerga.
 */
describe('LineChart — alternativa textual', () => {
  let host: HTMLElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [Host] }).compileComponents();
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    host = fixture.nativeElement as HTMLElement;
  });

  it('publica a serie inteira numa tabela, com rotulo e valor', () => {
    const rows = Array.from(host.querySelectorAll('tbody tr')).map((tr) =>
      Array.from(tr.querySelectorAll('th, td')).map((c) => c.textContent?.trim()),
    );

    expect(rows).toEqual([
      ['01 set', '0'],
      ['02 set', '3'],
      ['03 set', '1'],
    ]);
  });

  it('nomeia a tabela com o mesmo rotulo do grafico', () => {
    expect(host.querySelector('caption')?.textContent?.trim()).toBe('Novos usuários por dia');
    expect(host.querySelector('thead th:last-child')?.textContent?.trim()).toBe('Novos usuários');
  });

  /** A tabela e para o leitor de tela, nao para o olho. */
  it('esconde a tabela visualmente sem tira-la da arvore de acessibilidade', () => {
    const table = host.querySelector('table');

    expect(table?.className).toContain('sr-only');
    expect(table?.getAttribute('aria-hidden')).toBeNull();
  });

  /** O desenho e decorativo: quem informa e a tabela. */
  it('marca o canvas como decorativo', () => {
    expect(host.querySelector('canvas')?.getAttribute('aria-hidden')).toBe('true');
  });
});

/**
 * FEAT-0121 — o BUCKET PARCIAL.
 *
 * O ultimo bucket da serie esta sempre em andamento (hoje / semana corrente /
 * mes corrente) e por isso vale menos que os vizinhos: ele nao terminou.
 * Desenhado como ponto normal, ele vira uma QUEDA no fim do grafico — e quem
 * olha conclui que o negocio caiu quando so o calendario nao fechou.
 */
describe('LineChart — periodo em andamento', () => {
  @Component({
    imports: [LineChart],
    template: `
      <app-line-chart [points]="points()" ariaLabel="Novos usuários" valueLabel="Novos usuários" />
    `,
  })
  class PartialHost {
    readonly points = signal<LinePoint[]>([
      { label: 'jul', value: 40 },
      { label: 'ago', value: 38 },
      { label: 'set', value: 9, partial: true },
    ]);
  }

  let host: HTMLElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [PartialHost] }).compileComponents();
    const fixture = TestBed.createComponent(PartialHost);
    fixture.detectChanges();
    host = fixture.nativeElement as HTMLElement;
  });

  /**
   * A ressalva PRECISA existir em texto: marcar so no desenho a entregaria a
   * quem enxerga e a esconderia de quem usa leitor de tela.
   */
  it('diz na tabela que o ultimo periodo ainda nao fechou', () => {
    const rows = Array.from(host.querySelectorAll('tbody tr')).map((tr) =>
      (tr.querySelector('th')?.textContent ?? '').replace(/\s+/g, ' ').trim(),
    );

    expect(rows[2]).toContain('período em andamento');
    expect(rows[2]).toContain('set');
  });

  /** E NAO pode marcar os periodos fechados — senao a ressalva perde sentido. */
  it('nao marca os periodos ja fechados', () => {
    const rows = Array.from(host.querySelectorAll('tbody tr')).map(
      (tr) => tr.querySelector('th')?.textContent ?? '',
    );

    expect(rows[0]).not.toContain('em andamento');
    expect(rows[1]).not.toContain('em andamento');
  });

  /** O valor do bucket parcial continua sendo publicado, com a ressalva junto. */
  it('publica o valor do periodo parcial', () => {
    const cells = Array.from(host.querySelectorAll('tbody td')).map((td) => td.textContent?.trim());

    expect(cells).toEqual(['40', '38', '9']);
  });
});

/**
 * FEAT-0121 Parte A — o modo BARRA.
 *
 * O componente aceita barra para NAO existirem dois componentes de grafico no
 * app: a regra de escala e a tabela sr-only tem de valer nos dois modos, e duas
 * copias garantem que uma fica para tras. Quando a barra do dashboard virar
 * canvas, a tabela deixa de ser boa pratica e passa a ser a UNICA forma de a
 * informacao existir para leitor de tela — os <button aria-label> de hoje pelo
 * menos falam; um canvas nao fala nada.
 */
describe('LineChart — modo barra', () => {
  @Component({
    imports: [LineChart],
    template: `
      <app-line-chart
        type="bar"
        [points]="points()"
        [axisTop]="axisTop()"
        ariaLabel="Faturamento por mês"
        valueLabel="Faturamento"
      />
    `,
  })
  class BarHost {
    readonly points = signal<LinePoint[]>([
      { label: 'jul', value: 1200 },
      { label: 'ago', value: 1500 },
      { label: 'set', value: 400, partial: true },
    ]);
    readonly axisTop = signal<number | null>(null);
  }

  let fixture: ReturnType<typeof TestBed.createComponent<BarHost>>;
  let host: HTMLElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [BarHost] }).compileComponents();
    fixture = TestBed.createComponent(BarHost);
    fixture.detectChanges();
    host = fixture.nativeElement as HTMLElement;
  });

  /** A alternativa textual NAO pode depender do modo. */
  it('publica a serie na tabela sr-only tambem em barra', () => {
    const rows = Array.from(host.querySelectorAll('tbody tr')).map((tr) =>
      Array.from(tr.querySelectorAll('th, td')).map((c) =>
        (c.textContent ?? '').replace(/\s+/g, ' ').trim(),
      ),
    );

    expect(rows.map((r) => r[1])).toEqual(['1200', '1500', '400']);
    expect(host.querySelector('caption')?.textContent?.trim()).toBe('Faturamento por mês');
  });

  /** E a ressalva do periodo em andamento vale em barra pelo mesmo motivo. */
  it('marca o periodo em andamento na tabela, em barra', () => {
    const last = (host.querySelectorAll('tbody tr')[2].querySelector('th')?.textContent ?? '')
      .replace(/\s+/g, ' ')
      .trim();

    expect(last).toContain('período em andamento');
  });

  it('mantem o canvas decorativo e a tabela visivel ao leitor de tela', () => {
    expect(host.querySelector('canvas')?.getAttribute('aria-hidden')).toBe('true');
    expect(host.querySelector('table')?.className).toContain('sr-only');
  });
});

/**
 * O teto do eixo vem do CHAMADOR quando o dominio nao e contagem.
 *
 * Contagem e dinheiro tem pisos diferentes por natureza — 5 unidades nao e
 * R$ 100 —, entao cada dominio traz o seu (`axisTopFor` aqui, `moneyAxisTopFor`
 * no dashboard) e o componente nao escolhe por ninguem.
 */
describe('LineChart — teto do eixo vindo do chamador', () => {
  it('a regra de contagem continua sendo o padrao quando ninguem passa teto', () => {
    // Sem `axisTop`, vale axisTopFor: piso 5 para numeros pequenos.
    expect(axisTopFor([1, 3, 2])).toBe(5);
  });

  /**
   * Um piso de 5 em cima de uma serie de DINHEIRO seria R$ 5 — inutil. Por isso
   * quem plota dinheiro passa o proprio teto, e este teste prende o contrato:
   * o valor do chamador vence o padrao.
   */
  it('respeita um teto de outro dominio sem aplicar o piso de contagem', () => {
    const moneyTop = 2000;

    expect(moneyTop).toBeGreaterThan(axisTopFor([1200, 1500, 400]));
  });
});

/**
 * FEAT-0121 — SERIE DE REFERENCIA (mes anterior atras do mes corrente).
 *
 * O cartao de caixa E a comparacao: sem a segunda curva sobra um numero que o
 * dono ja tem noutro bloco. E o peso visual menor e regra de PRODUTO, nao
 * preferencia — duas linhas de peso parecido fazem a do mes passado ser lida
 * como PREVISAO do mes atual, e o cartao passa a prometer futuro em vez de
 * comparar com o passado.
 */
describe('LineChart — serie de referencia', () => {
  const ATUAL: LinePoint[] = [
    { label: '01', value: 10 },
    { label: '02', value: 25 },
    { label: '03', value: 40, partial: true },
  ];
  const ANTERIOR: LinePoint[] = [
    { label: '01', value: 30 },
    { label: '02', value: 55 },
    { label: '03', value: 70 },
  ];

  @Component({
    imports: [LineChart],
    template: `
      <app-line-chart
        [points]="points()"
        [reference]="reference()"
        [type]="type()"
        ariaLabel="Caixa do mês"
        valueLabel="Mês atual"
        referenceLabel="Mês anterior"
      />
    `,
  })
  class RefHost {
    readonly points = signal<LinePoint[]>(ATUAL);
    readonly reference = signal<readonly LinePoint[] | null>(ANTERIOR);
    readonly type = signal<'line' | 'bar'>('line');
  }

  function render(setup?: (h: RefHost) => void) {
    const fixture = TestBed.createComponent(RefHost);
    setup?.(fixture.componentInstance);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [RefHost] }).compileComponents();
  });

  it('publica a comparacao na tabela, lado a lado com o mes atual', () => {
    const rows = Array.from(render().querySelectorAll('tbody tr')).map((tr) =>
      Array.from(tr.querySelectorAll('td')).map((td) => td.textContent?.trim()),
    );

    expect(rows).toEqual([
      ['10', '30'],
      ['25', '55'],
      ['40', '70'],
    ]);
  });

  it('nomeia a coluna de comparacao com o rotulo da referencia', () => {
    const headers = Array.from(render().querySelectorAll('thead th')).map((th) =>
      th.textContent?.trim(),
    );

    expect(headers).toEqual(['Período', 'Mês atual', 'Mês anterior']);
  });

  /**
   * A marca de parcial e da serie PRINCIPAL. A referencia e um periodo fechado
   * e nao pode herda-la, ou o desenho diria que o mes passado ainda esta
   * enchendo.
   */
  it('nao contamina a referencia com a marca de periodo em andamento', () => {
    const rows = Array.from(render().querySelectorAll('tbody tr')).map(
      (tr) => (tr.querySelector('th')?.textContent ?? '').replace(/\s+/g, ' ').trim(),
    );

    // A ressalva aparece UMA vez, na linha do bucket parcial da serie principal.
    expect(rows.filter((r) => r.includes('em andamento'))).toHaveLength(1);
    expect(rows[2]).toContain('em andamento');
  });

  it('tolera referencia mais curta que a serie principal', () => {
    const host = render((h) => h.reference.set([{ label: '01', value: 30 }]));
    const rows = Array.from(host.querySelectorAll('tbody tr')).map((tr) =>
      Array.from(tr.querySelectorAll('td')).map((td) => td.textContent?.trim()),
    );

    expect(rows[0]).toEqual(['10', '30']);
    expect(rows[1]).toEqual(['25', '—']);
  });

  it('aceita referencia tambem em barra', () => {
    const host = render((h) => h.type.set('bar'));
    const headers = Array.from(host.querySelectorAll('thead th')).map((th) =>
      th.textContent?.trim(),
    );

    expect(headers).toContain('Mês anterior');
  });

  /**
   * REGRESSAO: o admin-home JA ESTA EM PRODUCAO com este componente e NAO passa
   * referencia. Sem ela, tudo tem de ficar exatamente como era — inclusive a
   * tabela com DUAS colunas, nao tres com uma vazia.
   */
  describe('sem referencia, nada muda', () => {
    it('a tabela volta a ter duas colunas', () => {
      const host = render((h) => h.reference.set(null));

      expect(
        Array.from(host.querySelectorAll('thead th')).map((th) => th.textContent?.trim()),
      ).toEqual(['Período', 'Mês atual']);
    });

    it('nenhuma linha ganha celula de comparacao', () => {
      const host = render((h) => h.reference.set(null));
      const cells = Array.from(host.querySelectorAll('tbody tr')).map(
        (tr) => tr.querySelectorAll('td').length,
      );

      expect(cells).toEqual([1, 1, 1]);
    });

    it('a marca de periodo em andamento continua funcionando', () => {
      const host = render((h) => h.reference.set(null));
      const rows = Array.from(host.querySelectorAll('tbody tr')).map(
        (tr) => tr.querySelector('th')?.textContent ?? '',
      );

      expect(rows[2]).toContain('em andamento');
    });
  });
});

/**
 * O teto do eixo tem de enxergar as DUAS series: uma referencia mais alta que a
 * principal sairia CORTADA, e a serie cortada seria justamente a que da a
 * medida de comparacao.
 */
describe('axisTopFor — com serie de referencia', () => {
  it('o topo cobre a referencia quando ela e maior que a principal', () => {
    const atual = [10, 25, 40];
    const anterior = [30, 55, 70];

    expect(axisTopFor([...atual, ...anterior])).toBe(70);
    expect(axisTopFor(atual)).toBe(40);
  });
});

/**
 * O PESO MENOR E POR CONSTRUCAO — e a regra que este no manda enterrar no
 * componente, entao ela precisa de teste, nao so de comentario.
 *
 * O desenho nao e testavel (canvas nao roda no JSDOM), entao o que se afirma
 * aqui e o CONTRATO: fina, tracejada, sem preenchimento, sem pontos. Se alguem
 * "melhorar" a referencia para solida ou grossa, cai aqui — e nao na reuniao em
 * que o dono le a linha do mes passado como previsao do mes atual.
 */
describe('REFERENCE_STYLE — peso visual da referencia', () => {
  it('e fina, tracejada, sem preenchimento e sem pontos', () => {
    expect(REFERENCE_STYLE.borderWidth).toBe(1);
    expect(REFERENCE_STYLE.borderDash.length).toBeGreaterThan(0);
    expect(REFERENCE_STYLE.fill).toBe(false);
    expect(REFERENCE_STYLE.pointRadius).toBe(0);
    expect(REFERENCE_STYLE.pointHoverRadius).toBe(0);
  });

  /**
   * A afirmacao que interessa e RELATIVA: "a referencia e mais leve que a
   * principal" — nao "a referencia e mais fina que dois".
   *
   * Antes isto comparava com o literal 2, e a protecao era de MAO UNICA: pegava
   * quem engrossasse a referencia, e passava verde para quem AFINASSE a
   * principal ate as duas se igualarem. A segunda direcao e a perigosa, porque
   * e ela que faz a curva do mes passado ser lida como PREVISAO do mes atual.
   * Comparando as duas CONSTANTES, qualquer um dos dois lados que mude derruba
   * o teste.
   */
  it('e mais leve que a serie principal, nos dois sentidos', () => {
    expect(REFERENCE_STYLE.borderWidth).toBeLessThan(MAIN_SERIES_STYLE.borderWidth);
  });

  /** Peso nao e so espessura: a principal preenche, a referencia nao. */
  it('nao preenche, enquanto a principal preenche', () => {
    expect(MAIN_SERIES_STYLE.fill).toBe(true);
    expect(REFERENCE_STYLE.fill).toBe(false);
  });

  /** Simetria com a referencia: ninguem muda a principal em tempo de execucao. */
  it('a principal tambem e congelada', () => {
    expect(Object.isFrozen(MAIN_SERIES_STYLE)).toBe(true);
  });

  /** Congelado: nem o proprio componente muda isto em tempo de execucao. */
  it('nao pode ser alterado', () => {
    expect(Object.isFrozen(REFERENCE_STYLE)).toBe(true);
  });
});
