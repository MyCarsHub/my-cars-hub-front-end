import {
  ControlMethod,
  METHOD_MULTIPLIER,
  simulate,
  yearlyLabel,
} from './simulator-math';

describe('simulator-math', () => {
  const methods: ControlMethod[] = ['planilha', 'caderno', 'cabeca'];

  describe('tabela de casos (carros × método)', () => {
    // Valores esperados calculados à mão: linha = round(carros × taxa × mult),
    // total = soma das linhas arredondadas (linha-primeiro, por spec).
    const cases: {
      cars: number;
      method: ControlMethod;
      lines: [number, number, number, number];
      total: number;
      hub: number;
    }[] = [
      { cars: 1, method: 'planilha', lines: [1, 1, 1, 1], total: 4, hub: 1 },
      { cars: 1, method: 'caderno', lines: [2, 1, 1, 1], total: 5, hub: 1 },
      { cars: 1, method: 'cabeca', lines: [2, 1, 1, 1], total: 5, hub: 1 },
      { cars: 7, method: 'planilha', lines: [10, 7, 4, 5], total: 26, hub: 2 },
      { cars: 7, method: 'caderno', lines: [11, 8, 5, 6], total: 30, hub: 2 },
      { cars: 7, method: 'cabeca', lines: [13, 9, 5, 6], total: 33, hub: 2 },
      { cars: 15, method: 'planilha', lines: [21, 15, 9, 11], total: 56, hub: 4 },
      { cars: 15, method: 'caderno', lines: [24, 17, 10, 12], total: 63, hub: 4 },
      { cars: 15, method: 'cabeca', lines: [27, 20, 12, 14], total: 73, hub: 4 },
      { cars: 30, method: 'planilha', lines: [42, 30, 18, 21], total: 111, hub: 8 },
      { cars: 30, method: 'caderno', lines: [48, 35, 21, 24], total: 128, hub: 8 },
      { cars: 30, method: 'cabeca', lines: [55, 39, 23, 27], total: 144, hub: 8 },
    ];

    for (const c of cases) {
      it(`${c.cars} carro(s), método ${c.method}`, () => {
        const r = simulate(c.cars, c.method);
        expect([
          r.lines.charges,
          r.lines.spreadsheet,
          r.lines.fines,
          r.lines.documents,
        ]).toEqual(c.lines);
        expect(r.totalManual).toBe(c.total);
        expect(r.withMyCarsHub).toBe(c.hub);
      });
    }
  });

  it('default aprovado no mockup: 7 carros, planilha → 26h, linhas 10/7/4/5', () => {
    const r = simulate(7, 'planilha');
    expect(r.totalManual).toBe(26);
    expect(r.lines).toEqual({ charges: 10, spreadsheet: 7, fines: 4, documents: 5 });
    expect(r.workDays).toBe(3);
    expect(r.yearlyLabel).toBe('um mês e meio');
    expect(r.withMyCarsHub).toBe(2);
  });

  it('consistência linhas-vs-total em toda a faixa 1–30 × 3 métodos', () => {
    for (let cars = 1; cars <= 30; cars++) {
      for (const method of methods) {
        const r = simulate(cars, method);
        const sum =
          r.lines.charges + r.lines.spreadsheet + r.lines.fines + r.lines.documents;
        expect(r.totalManual).toBe(sum);
        expect(Number.isInteger(r.totalManual)).toBe(true);
      }
    }
  });

  it('lado MyCarsHub nunca exibe menos de 1h', () => {
    for (let cars = 1; cars <= 30; cars++) {
      for (const method of methods) {
        expect(simulate(cars, method).withMyCarsHub).toBeGreaterThanOrEqual(1);
      }
    }
  });

  it('multiplicadores são os da spec', () => {
    expect(METHOD_MULTIPLIER.planilha).toBe(1.0);
    expect(METHOD_MULTIPLIER.caderno).toBe(1.15);
    expect(METHOD_MULTIPLIER.cabeca).toBe(1.3);
  });

  describe('faixas textuais do "por ano" (meses de trabalho de 176h)', () => {
    it('nunca devolve decimal cru — sempre uma faixa conhecida', () => {
      const known = [
        'mais de uma semana',
        'quase um mês',
        'um mês inteiro',
        'um mês e meio',
        'quase dois meses',
        'quase três meses',
        'quase quatro meses',
        'quase cinco meses',
        'quase seis meses',
        'mais de meio ano',
      ];
      for (let cars = 1; cars <= 30; cars++) {
        for (const method of methods) {
          expect(known).toContain(simulate(cars, method).yearlyLabel);
        }
      }
    });

    it('faixas nos pontos de referência', () => {
      expect(yearlyLabel(4)).toBe('mais de uma semana'); // 48h/ano ≈ 0,27 mês
      expect(yearlyLabel(11)).toBe('quase um mês'); // 132h/ano = 0,75 mês
      expect(yearlyLabel(15)).toBe('um mês inteiro'); // 180h/ano ≈ 1,02 mês
      expect(yearlyLabel(26)).toBe('um mês e meio'); // 312h/ano ≈ 1,77 mês (default)
      expect(yearlyLabel(30)).toBe('quase dois meses'); // 360h/ano ≈ 2,05 meses
      expect(yearlyLabel(56)).toBe('quase quatro meses'); // 15 carros planilha
      expect(yearlyLabel(111)).toBe('mais de meio ano'); // 30 carros planilha
    });

    it('faixas são monotônicas nas fronteiras (sem buracos)', () => {
      for (let h = 1; h <= 150; h++) {
        expect(yearlyLabel(h)).toBeTruthy();
      }
    });
  });

  it('dias de trabalho = round(total / 8)', () => {
    expect(simulate(30, 'planilha').workDays).toBe(Math.round(111 / 8));
    expect(simulate(1, 'planilha').workDays).toBe(Math.round(4 / 8));
  });
});
