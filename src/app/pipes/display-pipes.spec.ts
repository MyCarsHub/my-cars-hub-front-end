import { PersonNamePipe } from './person-name.pipe';
import { PlatePipe } from './plate.pipe';
import { VehicleBrandPipe } from './vehicle-brand.pipe';
import { VehicleLabelPipe } from './vehicle-label.pipe';
import { VehicleModelPipe } from './vehicle-model.pipe';

describe('display pipes (FEAT-0556)', () => {
  it('personName title-cases uniform case and leaves mixed case alone', () => {
    const p = new PersonNamePipe();
    expect(p.transform('JOÃO DA SILVA')).toBe('João da Silva');
    expect(p.transform('maria de souza')).toBe('Maria de Souza');
    expect(p.transform('Ana da SILVA')).toBe('Ana da SILVA');
    expect(p.transform(null)).toBe('');
  });

  it('plate uppercases and hyphenates 7-char plates, optionally without hyphen', () => {
    const p = new PlatePipe();
    expect(p.transform('abc1d23')).toBe('ABC-1D23');
    expect(p.transform('abc1d23', false)).toBe('ABC1D23');
    expect(p.transform(undefined)).toBe('—');
  });

  it('vehicleBrand / vehicleModel / vehicleLabel format the parts', () => {
    expect(new VehicleBrandPipe().transform('VOLKSWAGEN')).toBe('Volkswagen');
    expect(new VehicleBrandPipe().transform('BYD')).toBe('BYD');
    expect(new VehicleModelPipe().transform('HB20')).toBe('HB20');
    expect(new VehicleLabelPipe().transform('FIAT', 'UNO MILLE')).toBe('Fiat Uno Mille');
    expect(new VehicleLabelPipe().transform('fiat', null)).toBe('Fiat');
    expect(new VehicleLabelPipe().transform(null, undefined)).toBe('');
  });
});
