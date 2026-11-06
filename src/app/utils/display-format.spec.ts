import {
  formatBrand,
  formatModel,
  formatPersonName,
  formatPlate,
  formatVehicleLabel,
} from './display-format';

describe('formatPersonName (FEAT-0556)', () => {
  const cases: [string, string, string][] = [
    ['all upper', 'JOÃO DA SILVA', 'João da Silva'],
    ['all lower', 'joão da silva', 'João da Silva'],
    ['particle de', 'MARIA DE FÁTIMA SOUZA', 'Maria de Fátima Souza'],
    ['particle do', 'carlos do nascimento', 'Carlos do Nascimento'],
    ['particle dos', 'ANA DOS SANTOS', 'Ana dos Santos'],
    ['particle das', 'LUIZA DAS NEVES', 'Luiza das Neves'],
    ['particle e', 'PEDRO E PAULO', 'Pedro e Paulo'],
    ['particle first word', 'DA SILVA JOSE', 'Da Silva Jose'],
    ['accents', 'JOSÉ ÁLVARO ÇÃO', 'José Álvaro Ção'],
    ['apostrophe', "ANA D'ÁVILA", "Ana D'Ávila"],
    ['apostrophe first', "d'ávila costa", "D'Ávila Costa"],
    ['apostrophe after particle', "MARIA DE D'ÁVILA", "Maria de d'Ávila"],
    ['typographic apostrophe', 'JOÃO O’BRIEN', 'João O’Brien'],
    ['hyphen', 'MARIA-CLARA SILVA', 'Maria-Clara Silva'],
    ['roman II', 'JOÃO II', 'João II'],
    ['roman III lower', 'pedro iii', 'Pedro III'],
    ['roman IV', 'LUIS IV', 'Luis IV'],
    ['roman I', 'PEDRO I', 'Pedro I'],
    ['roman V', 'carlos v', 'Carlos V'],
    ['roman VIII', 'HENRIQUE VIII', 'Henrique VIII'],
    ['roman IX', 'LUIS IX', 'Luis IX'],
    ['roman X', 'pio x', 'Pio X'],
    ['collapse spaces', '  JOAO    SILVA ', 'Joao Silva'],
    ['real 1', 'FRANCISCO DE ASSIS PEREIRA JÚNIOR', 'Francisco de Assis Pereira Júnior'],
    ['real 2', 'aparecida da conceição lima', 'Aparecida da Conceição Lima'],
    ['real 3', 'GABRIEL HENRIQUE DOS REIS', 'Gabriel Henrique dos Reis'],
    ['real 4', 'rafaela souza e silva', 'Rafaela Souza e Silva'],
    ['real 5', 'WELLINGTON DA COSTA BARBOSA', 'Wellington da Costa Barbosa'],
    ['real 6', 'tiago de oliveira', 'Tiago de Oliveira'],
    ['real 7', 'VANESSA CRISTINA DO CARMO', 'Vanessa Cristina do Carmo'],
    ['real 8', 'josé ricardo das chagas', 'José Ricardo das Chagas'],
    ['real 9', 'LUCAS ANDRÉ DE LIMA E SILVA', 'Lucas André de Lima e Silva'],
    ['real 10', 'beatriz helena', 'Beatriz Helena'],
    ['single word', 'LORRAN', 'Lorran'],
  ];
  it.each(cases)('%s', (_n, input, expected) => {
    expect(formatPersonName(input)).toBe(expected);
  });

  const mixed = ['da Silva', 'McDonald', "D'Ávila", 'João da SILVA', 'maria Souza', 'Ana'];
  it.each(mixed)('leaves mixed-case "%s" exactly as typed', (m) => {
    expect(formatPersonName(m)).toBe(m);
  });

  it('is null/undefined/blank safe', () => {
    expect(formatPersonName(null)).toBe('');
    expect(formatPersonName(undefined)).toBe('');
    expect(formatPersonName('')).toBe('');
    expect(formatPersonName('   ')).toBe('');
  });

  it('is idempotent', () => {
    for (const [, input] of cases) {
      const once = formatPersonName(input);
      expect(formatPersonName(once)).toBe(once);
    }
  });

  it('never touches an e-mail address used as a fallback name', () => {
    expect(formatPersonName('joao@example.com')).toBe('joao@example.com');
  });

  it('leaves digits-only text untouched', () => {
    expect(formatPersonName('123')).toBe('123');
  });
});

describe('formatBrand / formatModel (FEAT-0556)', () => {
  const brands: [string, string][] = [
    ['VOLKSWAGEN', 'Volkswagen'],
    ['fiat', 'Fiat'],
    ['CHEVROLET', 'Chevrolet'],
    ['BYD', 'BYD'],
    ['byd', 'BYD'],
    ['BMW', 'BMW'],
    ['vw', 'VW'],
    ['GM', 'GM'],
    ['JAC', 'JAC'],
    ['GWM', 'GWM'],
    ['RAM', 'RAM'],
    ['MG', 'MG'],
    ['DS', 'DS'],
    ['KIA', 'Kia'],
    ['MINI', 'Mini'],
    ['MERCEDES-BENZ', 'Mercedes-Benz'],
    ['LAND ROVER', 'Land Rover'],
    ['CITROËN', 'Citroën'],
    ['Mercedes-Benz', 'Mercedes-Benz'],
  ];
  it.each(brands)('brand %s -> %s', (i, e) => expect(formatBrand(i)).toBe(e));

  const models: [string, string][] = [
    ['ONIX', 'Onix'],
    ['uno mille', 'Uno Mille'],
    ['HB20', 'HB20'],
    ['hb20', 'HB20'],
    ['HB20S', 'HB20S'],
    ['SW4', 'SW4'],
    ['T-CROSS', 'T-Cross'],
    ['t-cross', 'T-Cross'],
    ['CR-V', 'CR-V'],
    ['cr-v', 'CR-V'],
    ['HR-V', 'HR-V'],
    ['CX-5', 'CX-5'],
    ['COROLLA XEI', 'Corolla XEI'],
    ['corolla xei', 'Corolla XEI'],
    ['PALIO CD', 'Palio CD'],
    ['CELTA CS', 'Celta CS'],
    ['UNO CE', 'Uno CE'],
    ['HILUX SLT', 'Hilux SLT'],
    ['hilux xls', 'Hilux XLS'],
    ['RANGER XLT', 'Ranger XLT'],
    ['CRUZE LTZ', 'Cruze LTZ'],
    ['GOL GTI', 'Gol GTI'],
    ['COMPASS LONGITUDE', 'Compass Longitude'],
    ['C4 CACTUS', 'C4 Cactus'],
    ['UP!', 'Up!'],
    ['Corolla Cross', 'Corolla Cross'],
    ['HB20 Comfort', 'HB20 Comfort'],
    ['Strada freedom', 'Strada freedom'],
  ];
  it.each(models)('model %s -> %s', (i, e) => expect(formatModel(i)).toBe(e));

  it('is null safe and idempotent', () => {
    expect(formatBrand(null)).toBe('');
    expect(formatModel(undefined)).toBe('');
    expect(formatModel('  ')).toBe('');
    for (const [i] of models) expect(formatModel(formatModel(i))).toBe(formatModel(i));
    for (const [i] of brands) expect(formatBrand(formatBrand(i))).toBe(formatBrand(i));
  });

  it('joins brand and model, dropping empty parts', () => {
    expect(formatVehicleLabel('FIAT', 'UNO')).toBe('Fiat Uno');
    expect(formatVehicleLabel('byd', 'DOLPHIN')).toBe('BYD Dolphin');
    expect(formatVehicleLabel('Fiat', null)).toBe('Fiat');
    expect(formatVehicleLabel(null, 'Uno')).toBe('Uno');
    expect(formatVehicleLabel(undefined, undefined)).toBe('');
  });
});

describe('formatPlate (FEAT-0556)', () => {
  it('uppercases and hyphenates 7-char plates', () => {
    expect(formatPlate('abc1d23')).toBe('ABC-1D23');
    expect(formatPlate('ABC1234')).toBe('ABC-1234');
  });
  it('keeps other lengths and a stored hyphen untouched beyond case', () => {
    expect(formatPlate('abc-1234')).toBe('ABC-1234');
    expect(formatPlate('ab12')).toBe('AB12');
  });
  it('empty yields dash by default and can be overridden', () => {
    expect(formatPlate(null)).toBe('—');
    expect(formatPlate('')).toBe('—');
    expect(formatPlate(undefined, { empty: 'Veículo' })).toBe('Veículo');
  });
  it('keeps a stored hyphen on a 7-char plate (no double hyphen)', () => {
    expect(formatPlate('abc-123')).toBe('ABC-123');
    expect(formatPlate('ABC-123')).toBe('ABC-123');
  });
  it('hyphen:false only uppercases', () => {
    expect(formatPlate('abc1d23', { hyphen: false })).toBe('ABC1D23');
  });
});
