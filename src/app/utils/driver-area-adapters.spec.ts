import { describe, expect, it } from 'vitest';
import {
  maskDocumentForDisplay,
  toActiveRental,
  toDriverDashboard,
  toDriverProfile,
  toLedgerEntry,
} from './driver-area-adapters';

/**
 * O formato é o dos DTOs do backend (`driver_area/dto`): estes testes são o contrato
 * escrito do lado do cliente. Se um DTO mudar, o que quebra é ESTE arquivo e o
 * `driver-area-adapters.ts` — e nenhuma tela.
 */
describe('driver-area adapters', () => {
  describe('toLedgerEntry', () => {
    const wire = {
      id: 'e-1',
      kind: 'EXPENSE',
      category: 'FUEL',
      amountCents: 15000,
      occurredOn: '2026-10-09',
      description: 'Posto Shell',
      rentalId: 'r-1',
      createdDate: '2026-10-09T10:00:00',
      modifyDate: null,
    };

    it('lê as seis colunas e ignora a auditoria', () => {
      expect(toLedgerEntry(wire)).toEqual({
        id: 'e-1',
        kind: 'EXPENSE',
        category: 'FUEL',
        amountCents: 15000,
        occurredOn: '2026-10-09',
        description: 'Posto Shell',
        rentalId: 'r-1',
      });
    });

    it('descrição e aluguel ausentes viram null, não string vazia', () => {
      const entry = toLedgerEntry({ ...wire, description: '  ', rentalId: null });
      expect(entry?.description).toBeNull();
      expect(entry?.rentalId).toBeNull();
    });

    it('larga a linha que não dá para editar ou apagar', () => {
      expect(toLedgerEntry({ ...wire, id: null })).toBeNull();
      expect(toLedgerEntry({ ...wire, kind: 'TRANSFER' })).toBeNull();
      expect(toLedgerEntry({ ...wire, occurredOn: null })).toBeNull();
      expect(toLedgerEntry('lixo')).toBeNull();
    });
  });

  describe('toDriverDashboard', () => {
    const wire = {
      from: '2026-10-01',
      to: '2026-10-31',
      totals: { incomeCents: 500000, expenseCents: 180000, netCents: 320000, entryCount: 42 },
      previousPeriod: {
        from: '2026-08-31',
        to: '2026-09-30',
        incomeCents: 400000,
        expenseCents: 200000,
        netCents: 200000,
        entryCount: 30,
      },
      incomeByCategory: [
        { category: 'RIDES', totalCents: 450000, entryCount: 35 },
        { category: 'DELIVERIES', totalCents: 50000, entryCount: 7 },
      ],
      expenseByCategory: [{ category: 'FUEL', totalCents: 120000, entryCount: 12 }],
      granularity: 'DAY',
      series: [{ periodStart: '2026-10-01', incomeCents: 1000, expenseCents: 400, netCents: 600 }],
      activeRental: {
        rentalId: 'r-1',
        vehicleId: 'v-1',
        plate: 'ABC1D23',
        brand: 'Fiat',
        model: 'Argo',
        startDate: '2026-09-01',
        endDate: '2026-12-01',
      },
    };

    it('lê totais, período anterior, categorias achatadas com o tipo, série e aluguel', () => {
      const d = toDriverDashboard(wire);
      expect(d.totals).toEqual({
        incomeCents: 500000,
        expenseCents: 180000,
        netCents: 320000,
        entryCount: 42,
      });
      expect(d.previousPeriod.netCents).toBe(200000);
      expect(d.previousPeriod.from).toBe('2026-08-31');
      expect(d.byCategory).toEqual([
        { kind: 'INCOME', category: 'RIDES', totalCents: 450000, entryCount: 35 },
        { kind: 'INCOME', category: 'DELIVERIES', totalCents: 50000, entryCount: 7 },
        { kind: 'EXPENSE', category: 'FUEL', totalCents: 120000, entryCount: 12 },
      ]);
      expect(d.granularity).toBe('DAY');
      expect(d.series).toHaveLength(1);
      expect(d.activeRental?.plate).toBe('ABC1D23');
    });

    it('semana é semana; qualquer outra coisa é dia', () => {
      expect(toDriverDashboard({ ...wire, granularity: 'WEEK' }).granularity).toBe('WEEK');
      expect(toDriverDashboard({ ...wire, granularity: 'MONTH' }).granularity).toBe('DAY');
    });

    it('período vazio: zeros, listas vazias e sem aluguel — nada de undefined', () => {
      const d = toDriverDashboard(
        {
          from: '2026-10-01',
          to: '2026-10-31',
          totals: {},
          previousPeriod: {},
          incomeByCategory: [],
          expenseByCategory: [],
          series: [],
          activeRental: null,
        },
        '2026-10-01',
        '2026-10-31',
      );
      expect(d.totals).toEqual({ incomeCents: 0, expenseCents: 0, netCents: 0, entryCount: 0 });
      expect(d.byCategory).toEqual([]);
      expect(d.activeRental).toBeNull();
    });

    it('resposta que perdeu o líquido deriva ganho − custo', () => {
      const d = toDriverDashboard({ totals: { incomeCents: 900, expenseCents: 400 } });
      expect(d.totals.netCents).toBe(500);
    });

    it('lixo no lugar da resposta não derruba a tela', () => {
      const d = toDriverDashboard(null, '2026-10-01', '2026-10-31');
      expect(d.from).toBe('2026-10-01');
      expect(d.totals.entryCount).toBe(0);
    });
  });

  describe('aluguel ativo', () => {
    it('exige o id do aluguel', () => {
      expect(toActiveRental({ plate: 'ABC1D23' })).toBeNull();
      expect(toActiveRental({ rentalId: 'r-9' })?.rentalId).toBe('r-9');
    });
  });

  describe('perfil', () => {
    const wire = {
      driverId: 'd-1',
      name: 'Carlos Souza',
      status: 'WORKING',
      registrationStatus: 'COMPLETE',
      documentType: 'CPF',
      documentMasked: '***.456.789-**',
      email: 'carlos@example.com',
      phone: '11987654321',
      licenseCategory: 'B',
      licenseExpiry: '2029-05-01',
      address: {
        street: 'Rua A',
        number: '10',
        complement: null,
        district: 'Centro',
        cep: '01001-000',
        city: 'São Paulo',
        uf: 'sp',
      },
      companyId: 'c-1',
      companyName: 'Locadora Alfa',
      activeRental: null,
    };

    it('lê o cadastro e mantém o CPF como o servidor mandou, mascarado', () => {
      const p = toDriverProfile(wire);
      expect(p.documentMasked).toBe('***.456.789-**');
      expect(p.phone).toBe('11987654321');
      expect(p.address?.uf).toBe('SP');
      expect(p.companyName).toBe('Locadora Alfa');
      expect(p.registrationStatus).toBe('COMPLETE');
    });

    it('um CPF que chegou com os dígitos à mostra é mascarado AQUI também', () => {
      expect(toDriverProfile({ ...wire, documentMasked: '12345678901' }).documentMasked).toBe(
        '***.***.***-01',
      );
      expect(maskDocumentForDisplay('123.456.789-01')).toBe('***.***.***-01');
      expect(maskDocumentForDisplay('12345678000190')).toBe('**.***.***/****-90');
    });

    it('um valor já mascarado passa intacto; vazio vira travessão', () => {
      expect(maskDocumentForDisplay('***.456.789-**')).toBe('***.456.789-**');
      expect(maskDocumentForDisplay(null)).toBe('—');
    });

    it('telefone fica só com dígitos; cadastro sem endereço devolve null', () => {
      const p = toDriverProfile({ ...wire, phone: '(11) 98765-4321', address: null });
      expect(p.phone).toBe('11987654321');
      expect(p.address).toBeNull();
    });
  });
});
