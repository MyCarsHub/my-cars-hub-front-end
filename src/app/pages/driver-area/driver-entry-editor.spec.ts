import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiErrorService } from '../../services/api-error.service';
import { DriverLedgerService } from '../../services/driver-ledger.service';
import { NotificationService } from '../../services/notification.service';
import { DriverActiveRental, LedgerEntry } from '../../types/driver-ledger.types';
import { addDaysIso, minusYearsIso } from '../../utils/driver-ledger';
import { todayInBusinessTz } from '../../utils/business-clock';
import { DriverEntryEditor } from './driver-entry-editor';

const RENTAL: DriverActiveRental = {
  rentalId: 'r-1',
  vehicleId: 'v-1',
  plate: 'ABC1D23',
  brand: 'Fiat',
  model: 'Argo',
  startDate: '2026-09-01',
  endDate: null,
};

const ENTRY: LedgerEntry = {
  id: 'e-1',
  kind: 'EXPENSE',
  category: 'FUEL',
  amountCents: 15000,
  occurredOn: '2026-10-05',
  description: 'Posto da avenida',
  rentalId: 'r-1',
};

describe('DriverEntryEditor', () => {
  let fixture: ComponentFixture<DriverEntryEditor>;
  let create: ReturnType<typeof vi.fn>;
  let update: ReturnType<typeof vi.fn>;
  let remove: ReturnType<typeof vi.fn>;
  let notifications: NotificationService;
  let saved: LedgerEntry[];
  let removed: string[];

  const root = () => fixture.nativeElement as HTMLElement;
  const text = () => (root().textContent ?? '').replace(/\s+/g, ' ');
  const q = <T extends HTMLElement>(selector: string) => root().querySelector<T>(selector);
  const chips = () => Array.from(root().querySelectorAll<HTMLButtonElement>('[role="radio"]'));
  const chip = (label: string) => chips().find((c) => c.textContent?.trim() === label);

  function type(selector: string, value: string, inputType = 'insertText'): void {
    const el = q<HTMLInputElement>(selector)!;
    el.value = value;
    // Campo de data nao tem selecao: setSelectionRange lanca InvalidStateError nele.
    if (el.type === 'text') el.setSelectionRange(value.length, value.length);
    el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType, data: value }));
    fixture.detectChanges();
  }

  function submit(): void {
    q<HTMLButtonElement>('button[type="submit"]')!.click();
    fixture.detectChanges();
  }

  const amountField = () => q<HTMLInputElement>('#driver-entry-amount')!;

  function setup(activeRental: DriverActiveRental | null = RENTAL): void {
    fixture.componentRef.setInput('activeRental', activeRental);
    fixture.detectChanges();
  }

  beforeEach(() => {
    create = vi.fn((payload) => of({ ...ENTRY, id: 'new', ...payload }));
    update = vi.fn((id, payload) => of({ ...ENTRY, id, ...payload }));
    remove = vi.fn(() => of(undefined));

    TestBed.configureTestingModule({
      providers: [
        provideNoopAnimations(),
        ApiErrorService,
        { provide: DriverLedgerService, useValue: { create, update, remove } },
      ],
    });
    notifications = TestBed.inject(NotificationService);
    fixture = TestBed.createComponent(DriverEntryEditor);
    saved = [];
    removed = [];
    fixture.componentInstance.saved.subscribe((e) => saved.push(e));
    fixture.componentInstance.removed.subscribe((id) => removed.push(id));
  });

  describe('abertura', () => {
    it('começa fechado: nenhuma folha no DOM', () => {
      setup();
      expect(q('[role="dialog"]')).toBeNull();
    });

    it('o botão define o tipo: custo mostra as 7 categorias de custo e o título certo', () => {
      setup();
      fixture.componentInstance.openCreate('EXPENSE');
      fixture.detectChanges();

      expect(q('[role="dialog"]')).not.toBeNull();
      expect(text()).toContain('Registrar custo');
      expect(chips().map((c) => c.textContent?.trim())).toEqual([
        'Combustível',
        'Manutenção',
        'Aluguel do carro',
        'Multa',
        'Alimentação',
        'Pedágio e estacionamento',
        'Outros custos',
      ]);
      expect(q<HTMLButtonElement>('button[type="submit"]')!.textContent).toContain('Salvar custo');
    });

    it('ganho mostra as 3 categorias de ganho', () => {
      setup();
      fixture.componentInstance.openCreate('INCOME');
      fixture.detectChanges();

      expect(text()).toContain('Registrar ganho');
      expect(chips().map((c) => c.textContent?.trim())).toEqual([
        'Corridas',
        'Entregas',
        'Outros ganhos',
      ]);
    });

    it('a data nasce hoje e o campo não aceita o futuro (max = hoje)', () => {
      setup();
      fixture.componentInstance.openCreate('INCOME');
      fixture.detectChanges();

      const date = q<HTMLInputElement>('#driver-entry-date')!;
      expect(date.value).toBe(todayInBusinessTz());
      expect(date.getAttribute('max')).toBe(todayInBusinessTz());
      expect(date.type).toBe('date');
    });

    it('o valor é texto com teclado decimal, e o campo tem 16px ou mais no celular', () => {
      setup();
      fixture.componentInstance.openCreate('INCOME');
      fixture.detectChanges();

      const amount = amountField();
      expect(amount.type).toBe('text');
      expect(amount.getAttribute('inputmode')).toBe('decimal');
      // text-2xl = 24px; nenhuma classe text-sm/text-xs pode rebaixar abaixo dos 16px do iOS.
      expect(amount.className).toContain('text-2xl');
      expect(q<HTMLInputElement>('#driver-entry-date')!.className).toContain('text-base');
      expect(q<HTMLInputElement>('#driver-entry-description')!.className).toContain('text-base');
    });

    it('o botão salvar tem 48px de alvo e os atalhos de data 44px', () => {
      setup();
      fixture.componentInstance.openCreate('INCOME');
      fixture.detectChanges();

      expect(q<HTMLButtonElement>('button[type="submit"]')!.className).toContain('min-h-12');
      const quick = Array.from(root().querySelectorAll<HTMLButtonElement>('button')).filter((b) =>
        ['Hoje', 'Ontem'].includes(b.textContent?.trim() ?? ''),
      );
      expect(quick).toHaveLength(2);
      quick.forEach((b) => expect(b.className).toContain('min-h-11'));
    });
  });

  describe('validação', () => {
    beforeEach(() => {
      setup();
      fixture.componentInstance.openCreate('EXPENSE');
      fixture.detectChanges();
    });

    it('enviar vazio não chama o servidor e aponta categoria e valor', () => {
      submit();

      expect(create).not.toHaveBeenCalled();
      expect(text()).toContain('Escolha uma categoria.');
      expect(text()).toContain('Informe o valor.');
      // A folha continua aberta: o motorista não perde o que já digitou.
      expect(q('[role="dialog"]')).not.toBeNull();
    });

    it('zero não é valor', () => {
      chip('Combustível')!.click();
      type('#driver-entry-amount', '0,00');
      submit();

      expect(create).not.toHaveBeenCalled();
      expect(text()).toContain('Informe um valor maior que zero.');
    });

    it('"45.99" colado é recusado em voz alta, nunca lido como 4.599', () => {
      chip('Combustível')!.click();
      // Colagem: o evento chega sem inputType de digitação; a máscara não reinterpreta.
      type('#driver-entry-amount', '45.99', 'insertFromPaste');
      submit();

      expect(create).not.toHaveBeenCalled();
      expect(text()).toContain('Informe um valor válido (ex.: 1.200,00).');
    });

    it('acima de R$ 1.000.000,00 é recusado antes de ir ao servidor', () => {
      chip('Combustível')!.click();
      type('#driver-entry-amount', '1000000,01');
      submit();

      expect(create).not.toHaveBeenCalled();
      expect(text()).toContain('O valor máximo por lançamento é R$ 1.000.000,00.');
    });

    it('data no futuro é recusada', () => {
      chip('Combustível')!.click();
      type('#driver-entry-amount', '50,00');
      type('#driver-entry-date', addDaysIso(todayInBusinessTz(), 2)!, 'insertText');
      submit();

      expect(create).not.toHaveBeenCalled();
      expect(text()).toContain('A data não pode ser no futuro.');
    });

    it('data de mais de um ano atrás é recusada, como o servidor faz', () => {
      chip('Combustível')!.click();
      type('#driver-entry-amount', '50,00');
      type('#driver-entry-date', minusYearsIso(todayInBusinessTz(), 2)!, 'insertText');
      submit();

      expect(create).not.toHaveBeenCalled();
      expect(text()).toContain('A data não pode ser anterior a um ano atrás.');
    });

    it('exatamente um ano atrás ainda vale', () => {
      chip('Combustível')!.click();
      type('#driver-entry-amount', '50,00');
      type('#driver-entry-date', minusYearsIso(todayInBusinessTz(), 1)!, 'insertText');
      submit();

      expect(create).toHaveBeenCalledTimes(1);
    });

    it('o seletor de data já nasce limitado entre um ano atrás e hoje', () => {
      const date = q<HTMLInputElement>('#driver-entry-date')!;
      expect(date.getAttribute('min')).toBe(minusYearsIso(todayInBusinessTz(), 1));
      expect(date.getAttribute('max')).toBe(todayInBusinessTz());
    });

    it('o atalho "Ontem" volta um dia', () => {
      const ontem = Array.from(root().querySelectorAll<HTMLButtonElement>('button')).find(
        (b) => b.textContent?.trim() === 'Ontem',
      )!;
      ontem.click();
      fixture.detectChanges();

      expect(q<HTMLInputElement>('#driver-entry-date')!.value).toBe(
        addDaysIso(todayInBusinessTz(), -1),
      );
    });
  });

  describe('máscara e centavos', () => {
    beforeEach(() => {
      setup(null);
      fixture.componentInstance.openCreate('INCOME');
      fixture.detectChanges();
      chip('Corridas')!.click();
    });

    it('agrupa o milhar enquanto digita e envia centavos inteiros', () => {
      type('#driver-entry-amount', '1234,56');
      expect(amountField().value).toBe('1.234,56');

      submit();

      expect(create).toHaveBeenCalledTimes(1);
      expect(create.mock.calls[0][0].amountCents).toBe(123456);
    });

    it('valor sem vírgula é em reais, não em centavos', () => {
      type('#driver-entry-amount', '250');
      submit();

      expect(create.mock.calls[0][0].amountCents).toBe(25000);
    });

    it('uma casa decimal vale dezenas de centavos ("45,5" = 4550)', () => {
      type('#driver-entry-amount', '45,5');
      submit();

      expect(create.mock.calls[0][0].amountCents).toBe(4550);
    });
  });

  describe('salvar', () => {
    it('manda o corpo exato do contrato, avisa e entrega a resposta do servidor', () => {
      setup(null);
      fixture.componentInstance.openCreate('INCOME');
      fixture.detectChanges();
      chip('Entregas')!.click();
      type('#driver-entry-amount', '320,00');
      type('#driver-entry-description', '  Almoço de sábado  ');
      submit();

      expect(create).toHaveBeenCalledWith({
        kind: 'INCOME',
        category: 'DELIVERIES',
        amountCents: 32000,
        occurredOn: todayInBusinessTz(),
        description: 'Almoço de sábado',
        rentalId: null,
      });
      expect(saved).toHaveLength(1);
      expect(saved[0].id).toBe('new');
      expect(notifications.notifications().map((n) => n.message)).toContain('Ganho registrado.');
      expect(q('[role="dialog"]')).toBeNull();
    });

    it('observação em branco vai como null, não como string vazia', () => {
      setup(null);
      fixture.componentInstance.openCreate('EXPENSE');
      fixture.detectChanges();
      chip('Multa')!.click();
      type('#driver-entry-amount', '195,23');
      type('#driver-entry-description', '   ');
      submit();

      expect(create.mock.calls[0][0].description).toBeNull();
      expect(notifications.notifications().map((n) => n.message)).toContain('Custo registrado.');
    });

    it('com aluguel ativo o vínculo nasce marcado e manda o id do aluguel', () => {
      setup(RENTAL);
      fixture.componentInstance.openCreate('EXPENSE');
      fixture.detectChanges();

      expect(text()).toContain('Vincular ao meu aluguel ativo (ABC1D23)');
      const link = q<HTMLInputElement>('input[type="checkbox"]')!;
      expect(link.checked).toBe(true);

      chip('Combustível')!.click();
      type('#driver-entry-amount', '100');
      submit();

      expect(create.mock.calls[0][0].rentalId).toBe('r-1');
    });

    it('desmarcar o vínculo manda null', () => {
      setup(RENTAL);
      fixture.componentInstance.openCreate('EXPENSE');
      fixture.detectChanges();
      const link = q<HTMLInputElement>('input[type="checkbox"]')!;
      link.click();
      fixture.detectChanges();

      chip('Combustível')!.click();
      type('#driver-entry-amount', '100');
      submit();

      expect(create.mock.calls[0][0].rentalId).toBeNull();
    });

    it('sem aluguel ativo não existe a opção de vincular', () => {
      setup(null);
      fixture.componentInstance.openCreate('EXPENSE');
      fixture.detectChanges();

      expect(q('input[type="checkbox"]')).toBeNull();
    });

    it('erro do servidor fica DENTRO da folha e nada é emitido', () => {
      create.mockReturnValue(
        throwError(
          () =>
            new HttpErrorResponse({
              status: 400,
              error: { message: 'amountCents acima do máximo permitido' },
            }),
        ),
      );
      setup(null);
      fixture.componentInstance.openCreate('INCOME');
      fixture.detectChanges();
      chip('Corridas')!.click();
      type('#driver-entry-amount', '10');
      submit();

      expect(saved).toHaveLength(0);
      expect(q('[role="dialog"]')).not.toBeNull();
      expect(text()).toContain('amountCents acima do máximo permitido');
    });

    it('erro de campo do servidor cai embaixo do campo, não no topo', () => {
      create.mockReturnValue(
        throwError(
          () =>
            new HttpErrorResponse({
              status: 400,
              error: {
                message: 'Dados inválidos',
                fieldErrors: { description: 'description deve ter no máximo 200 caracteres' },
              },
            }),
        ),
      );
      setup(null);
      fixture.componentInstance.openCreate('INCOME');
      fixture.detectChanges();
      chip('Corridas')!.click();
      type('#driver-entry-amount', '10');
      submit();

      const inline = q('#driver-entry-description-error');
      expect(inline?.textContent).toContain('no máximo 200 caracteres');
    });
  });

  describe('editar', () => {
    beforeEach(() => {
      setup(RENTAL);
      fixture.componentInstance.openEdit(ENTRY);
      fixture.detectChanges();
    });

    it('abre com tudo preenchido e o tipo travado', () => {
      expect(text()).toContain('Editar custo');
      expect(amountField().value).toBe('150,00');
      expect(q<HTMLInputElement>('#driver-entry-date')!.value).toBe('2026-10-05');
      expect(q<HTMLInputElement>('#driver-entry-description')!.value).toBe('Posto da avenida');
      expect(chip('Combustível')!.getAttribute('aria-checked')).toBe('true');
      expect(chip('Manutenção')!.getAttribute('aria-checked')).toBe('false');
      // O tipo não muda numa edição: as categorias são só as de custo.
      expect(chips()).toHaveLength(7);
    });

    it('salva com PUT no id e com o corpo inteiro', () => {
      chip('Manutenção')!.click();
      type('#driver-entry-amount', '200,00');
      submit();

      expect(update).toHaveBeenCalledWith('e-1', {
        kind: 'EXPENSE',
        category: 'MAINTENANCE',
        amountCents: 20000,
        occurredOn: '2026-10-05',
        description: 'Posto da avenida',
        rentalId: 'r-1',
      });
      expect(create).not.toHaveBeenCalled();
      expect(notifications.notifications().map((n) => n.message)).toContain(
        'Lançamento atualizado.',
      );
      expect(saved[0].id).toBe('e-1');
    });

    it('um lançamento preso a um aluguel ANTIGO mantém o vínculo ao editar', () => {
      fixture.componentRef.setInput('activeRental', null);
      fixture.componentInstance.openEdit({ ...ENTRY, rentalId: 'r-old' });
      fixture.detectChanges();

      expect(text()).toContain('Vinculado a um aluguel');
      submit();

      expect(update.mock.calls[0][1].rentalId).toBe('r-old');
    });
  });

  describe('excluir', () => {
    beforeEach(() => {
      setup();
    });

    it('pede confirmação dizendo o que será apagado, e não apaga antes', () => {
      fixture.componentInstance.askDelete(ENTRY);
      fixture.detectChanges();

      expect(text()).toContain('Excluir este lançamento?');
      expect(text()).toContain('R$');
      expect(text()).toContain('Combustível');
      expect(text()).toContain('05/10/2026');
      expect(remove).not.toHaveBeenCalled();
    });

    it('confirmar apaga, avisa e informa o id', async () => {
      fixture.componentInstance.askDelete(ENTRY);
      fixture.detectChanges();
      const confirm = Array.from(root().querySelectorAll<HTMLButtonElement>('button')).find(
        (b) => b.textContent?.trim() === 'Excluir',
      )!;
      confirm.click();
      fixture.detectChanges();
      // O diálogo sai com animação (noop nos testes, mas assíncrona): espera assentar.
      await fixture.whenStable();
      fixture.detectChanges();

      expect(remove).toHaveBeenCalledWith('e-1');
      expect(removed).toEqual(['e-1']);
      expect(notifications.notifications().map((n) => n.message)).toContain(
        'Lançamento excluído.',
      );
      expect(text()).not.toContain('Excluir este lançamento?');
    });

    it('cancelar fecha sem apagar', () => {
      fixture.componentInstance.askDelete(ENTRY);
      fixture.detectChanges();
      const cancel = Array.from(root().querySelectorAll<HTMLButtonElement>('button')).find(
        (b) => b.textContent?.trim() === 'Cancelar',
      )!;
      cancel.click();
      fixture.detectChanges();

      expect(remove).not.toHaveBeenCalled();
      expect(removed).toEqual([]);
    });

    it('falha ao apagar avisa com o texto do servidor e não informa remoção', () => {
      remove.mockReturnValue(
        throwError(
          () => new HttpErrorResponse({ status: 404, error: { message: 'Lançamento não encontrado.' } }),
        ),
      );
      fixture.componentInstance.askDelete(ENTRY);
      fixture.detectChanges();
      Array.from(root().querySelectorAll<HTMLButtonElement>('button'))
        .find((b) => b.textContent?.trim() === 'Excluir')!
        .click();
      fixture.detectChanges();

      expect(removed).toEqual([]);
      expect(
        notifications.notifications().some((n) => n.kind === 'error' && /não encontrado/i.test(n.message)),
      ).toBe(true);
    });
  });
});
