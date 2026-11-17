import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DriverContactsCard } from './driver-contacts-card';
import { ApiErrorService } from '../../services/api-error.service';
import { DriverService } from '../../services/driver.service';
import { NotificationService } from '../../services/notification.service';
import type { ThirdPartyContact } from '../../types/driver.types';

/**
 * Contatos de terceiros no detalhe: parentesco visível, kebab Editar/Remover por linha, folha
 * para acrescentar/editar com parentesco obrigatório. Toda interação passa pelo DOM.
 */
describe('DriverContactsCard', () => {
  const DRIVER_ID = 'drv-1';

  const maria: ThirdPartyContact = {
    id: 'c-1',
    fullName: 'Maria da Silva',
    phone: '11987654321',
    relationship: 'MOTHER',
  };
  /** Contato anterior ao campo: sem parentesco. */
  const antigo: ThirdPartyContact = {
    id: 'c-2',
    fullName: 'José Souza',
    phone: '1132654321',
    relationship: null,
  };

  let addContact: ReturnType<typeof vi.fn>;
  let updateContact: ReturnType<typeof vi.fn>;
  let deleteContact: ReturnType<typeof vi.fn>;
  let changed: ReturnType<typeof vi.fn<() => void>>;
  let fixture: ComponentFixture<DriverContactsCard>;

  function host(): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }

  function rows(): HTMLElement[] {
    return Array.from(host().querySelectorAll<HTMLElement>('[data-third-party-contacts] > li'));
  }

  function byText(root: ParentNode, label: string): HTMLButtonElement {
    const btn = Array.from(root.querySelectorAll<HTMLButtonElement>('button')).find(
      (b) => (b.textContent ?? '').trim() === label,
    );
    if (!btn) throw new Error(`botão "${label}" não está na tela`);
    return btn;
  }

  function openMenuItem(row: number, action: 'edit' | 'remove'): void {
    const trigger = rows()[row].querySelector<HTMLButtonElement>('app-actions-menu button');
    if (!trigger) throw new Error('kebab da linha não está na tela');
    trigger.click();
    fixture.detectChanges();
    const item = host().querySelector<HTMLButtonElement>(`[data-contact-action="${action}"]`);
    if (!item) throw new Error(`item ${action} do kebab não está na tela`);
    item.click();
    fixture.detectChanges();
  }

  function input(id: string): HTMLInputElement {
    const el = host().querySelector<HTMLInputElement>(`#${id}`);
    if (!el) throw new Error(`campo ${id} não está na tela`);
    return el;
  }

  function relationship(): HTMLSelectElement {
    const el = host().querySelector<HTMLSelectElement>('#driver-contact-relationship');
    if (!el) throw new Error('select de parentesco não está na tela');
    return el;
  }

  function type(el: HTMLInputElement, value: string): void {
    el.value = value;
    el.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  }

  function choose(value: string): void {
    relationship().value = value;
    relationship().dispatchEvent(new Event('change'));
    fixture.detectChanges();
  }

  function submit(): void {
    const btn = host().querySelector<HTMLButtonElement>('[data-contact-submit]');
    if (!btn) throw new Error('botão de salvar não está na tela');
    btn.click();
    fixture.detectChanges();
  }

  async function setup(contacts: ThirdPartyContact[]): Promise<void> {
    addContact = vi.fn().mockReturnValue(of({ ...maria, id: 'c-9' }));
    updateContact = vi.fn().mockReturnValue(of(maria));
    deleteContact = vi.fn().mockReturnValue(of(undefined));
    changed = vi.fn<() => void>();
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        provideNoopAnimations(),
        { provide: DriverService, useValue: { addContact, updateContact, deleteContact } },
        {
          provide: NotificationService,
          useValue: { success: vi.fn(), info: vi.fn(), error: vi.fn(), warning: vi.fn() },
        },
        {
          provide: ApiErrorService,
          useValue: {
            claim: vi.fn(),
            messageFor: vi.fn(() => 'erro'),
            handleForm: vi.fn(() => ({ formMessage: 'erro' })),
          },
        },
      ],
    });
    fixture = TestBed.createComponent(DriverContactsCard);
    fixture.componentRef.setInput('driverId', DRIVER_ID);
    fixture.componentRef.setInput('contacts', contacts);
    fixture.componentInstance.changed.subscribe(() => changed());
    fixture.detectChanges();
    await fixture.whenStable();
  }

  beforeEach(() => {
    TestBed.resetTestingModule();
  });

  it('mostra o rótulo do parentesco e omite quando o contato antigo não tem', async () => {
    await setup([maria, antigo]);

    expect(rows()).toHaveLength(2);
    expect(rows()[0].querySelector('[data-contact-relationship]')?.textContent).toBe('Mãe');
    expect(rows()[0].textContent).toContain('(11) 98765-4321');
    expect(rows()[1].querySelector('[data-contact-relationship]')).toBeNull();
  });

  it('acrescenta com parentesco obrigatório e avisa o detalhe', async () => {
    await setup([maria]);
    byText(host(), 'Adicionar contato').click();
    fixture.detectChanges();

    type(input('driver-contact-name'), '  Ana Pereira ');
    type(input('driver-contact-phone'), '(21) 99988-7766');
    submit();
    expect(addContact).not.toHaveBeenCalled();

    choose('SISTER');
    submit();

    expect(addContact).toHaveBeenCalledWith(DRIVER_ID, {
      fullName: 'Ana Pereira',
      phone: '21999887766',
      relationship: 'SISTER',
    });
    expect(changed).toHaveBeenCalledTimes(1);
  });

  it('esconde o "Adicionar contato" no teto de 3', async () => {
    await setup([maria, antigo, { ...maria, id: 'c-3' }]);

    expect(host().querySelector('[data-contact-add]')).toBeNull();
  });

  it('editar um contato antigo abre o parentesco vazio e exige escolher', async () => {
    await setup([maria, antigo]);
    openMenuItem(1, 'edit');

    expect(input('driver-contact-name').value).toBe('José Souza');
    expect(input('driver-contact-phone').value).toBe('(11) 3265-4321');
    expect(relationship().value).toBe('');
    submit();
    expect(updateContact).not.toHaveBeenCalled();

    choose('FATHER');
    submit();

    expect(updateContact).toHaveBeenCalledWith(DRIVER_ID, 'c-2', {
      fullName: 'José Souza',
      phone: '1132654321',
      relationship: 'FATHER',
    });
    expect(changed).toHaveBeenCalledTimes(1);
  });

  it('telefone antigo com mais de 11 dígitos não é cortado: intocado volta igual', async () => {
    const comDdi: ThirdPartyContact = {
      id: 'c-7',
      fullName: 'Ana Pereira',
      phone: '+55 21 99988-7766',
      relationship: null,
    };
    await setup([comDdi]);
    openMenuItem(0, 'edit');

    expect(input('driver-contact-phone').value).toBe('+55 21 99988-7766');
    choose('AUNT');
    submit();

    expect(updateContact).toHaveBeenCalledWith(DRIVER_ID, 'c-7', {
      fullName: 'Ana Pereira',
      phone: '+55 21 99988-7766',
      relationship: 'AUNT',
    });
  });

  it('telefone antigo editado passa a valer a regra de 10–11 dígitos', async () => {
    await setup([{ id: 'c-7', fullName: 'Ana Pereira', phone: '+55 21 99988-7766', relationship: 'AUNT' }]);
    openMenuItem(0, 'edit');

    type(input('driver-contact-phone'), '219998');
    submit();
    expect(updateContact).not.toHaveBeenCalled();

    type(input('driver-contact-phone'), '21999887766');
    submit();
    expect(updateContact).toHaveBeenCalledWith(DRIVER_ID, 'c-7', {
      fullName: 'Ana Pereira',
      phone: '21999887766',
      relationship: 'AUNT',
    });
  });

  it('remover pede confirmação e só então chama o servidor', async () => {
    await setup([maria, antigo]);
    openMenuItem(0, 'remove');
    expect(deleteContact).not.toHaveBeenCalled();

    const dialog = host().querySelector('app-confirm-dialog');
    if (!dialog) throw new Error('diálogo de confirmação não está na tela');
    byText(dialog, 'Remover').click();
    fixture.detectChanges();

    expect(deleteContact).toHaveBeenCalledWith(DRIVER_ID, 'c-1');
    expect(changed).toHaveBeenCalledTimes(1);
  });
});
