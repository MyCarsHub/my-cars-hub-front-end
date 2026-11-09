import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CepService } from '../../services/cep.service';
import { CompanyContactService } from '../../services/company-contact.service';
import { NotificationService } from '../../services/notification.service';
import { SessionService } from '../../services/session.service';
import { EMPTY_COMPANY_CONTACT } from '../../types/company-contact.types';
import { CompanyContactQuickForm } from './company-contact-quick-form';

describe('CompanyContactQuickForm', () => {
  const save = vi.fn();
  const lookup = vi.fn();

  function setup(contact = EMPTY_COMPANY_CONTACT, signerReadOnly = false) {
    save.mockReset().mockReturnValue(of({ name: 'Locadora', contact }));
    lookup.mockReset().mockReturnValue(of({ street: 'Rua das Flores', district: 'Centro', city: 'Campinas', uf: 'SP' }));
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [CompanyContactQuickForm],
      providers: [
        { provide: CompanyContactService, useValue: { load: () => of({ name: 'Locadora', contact }), save } },
        { provide: CepService, useValue: { lookup } },
        { provide: NotificationService, useValue: { success: vi.fn(), error: vi.fn() } },
        {
          provide: SessionService,
          useValue: { getIdentityFromToken: () => ({ id: '1', name: 'Maria Souza', email: 'maria@conta.com' }) },
        },
      ],
    });
    const fixture = TestBed.createComponent(CompanyContactQuickForm);
    fixture.componentRef.setInput('signerReadOnly', signerReadOnly);
    fixture.detectChanges();
    return fixture;
  }

  const input = (f: { nativeElement: HTMLElement }, id: string) =>
    f.nativeElement.querySelector<HTMLInputElement>(`#${id}`)!;

  function type(el: HTMLInputElement, value: string) {
    el.value = value;
    el.dispatchEvent(new Event('input'));
  }

  it('prefills the account email and the owner name as representative; the role stays empty', () => {
    const f = setup();
    expect(input(f, 'qc-email').value).toBe('maria@conta.com');
    expect(input(f, 'qc-rep').value).toBe('Maria Souza');
    expect(input(f, 'qc-role').value).toBe('');
  });

  it('keeps what is already saved over the account suggestions', () => {
    const f = setup({ ...EMPTY_COMPANY_CONTACT, email: 'contato@loc.com', representativeName: 'João' });
    expect(input(f, 'qc-email').value).toBe('contato@loc.com');
    expect(input(f, 'qc-rep').value).toBe('João');
  });

  it('autofills street, district, city and UF from the CEP', () => {
    const f = setup();
    type(input(f, 'qc-cep'), '13010111');
    f.detectChanges();
    expect(lookup).toHaveBeenCalledWith('13010111');
    expect(input(f, 'qc-street').value).toBe('Rua das Flores');
    expect(input(f, 'qc-district').value).toBe('Centro');
    expect(input(f, 'qc-city').value).toBe('Campinas');
    expect(input(f, 'qc-uf').value).toBe('SP');
  });

  it('does not save while required fields are missing', () => {
    const f = setup();
    (f.nativeElement as HTMLElement).querySelector('form')!.dispatchEvent(new Event('submit'));
    expect(save).not.toHaveBeenCalled();
  });

  it('saves the whole eleven-key block and emits saved', () => {
    const f = setup();
    const saved = vi.fn();
    f.componentInstance.saved.subscribe(saved);
    type(input(f, 'qc-phone'), '11987654321');
    type(input(f, 'qc-cep'), '13010111');
    f.detectChanges();
    type(input(f, 'qc-number'), '10');
    type(input(f, 'qc-role'), 'Sócio');
    f.detectChanges();
    (f.nativeElement as HTMLElement).querySelector('form')!.dispatchEvent(new Event('submit'));
    expect(save).toHaveBeenCalledTimes(1);
    const [name, payload] = save.mock.calls[0];
    expect(name).toBe('Locadora');
    expect(Object.keys(payload)).toHaveLength(11);
    expect(payload).toMatchObject({
      phone: '(11) 98765-4321', email: 'maria@conta.com', addressCep: '13010-111', addressStreet: 'Rua das Flores',
      addressNumber: '10', addressCity: 'Campinas', addressUf: 'SP', representativeName: 'Maria Souza',
      representativeRole: 'Sócio', addressComplement: '',
    });
    expect(saved).toHaveBeenCalledTimes(1);
  });

  it('every control is 16px or larger (no iOS focus zoom)', () => {
    const f = setup();
    const inputs = Array.from((f.nativeElement as HTMLElement).querySelectorAll('input'));
    expect(inputs.length).toBeGreaterThan(0);
    for (const i of inputs) expect(i.className).toContain('text-base');
  });
  describe('manager (signer read-only)', () => {
    const withSigner = {
      ...EMPTY_COMPANY_CONTACT,
      representativeName: 'João Dono',
      representativeRole: 'Sócio',
    };

    it('shows the existing signer disabled, never suggests the manager name, and resends the signer unchanged', () => {
      const f = setup(withSigner, true);
      expect(input(f, 'qc-rep').value).toBe('João Dono');
      expect(input(f, 'qc-rep').disabled).toBe(true);
      expect(input(f, 'qc-role').value).toBe('Sócio');
      expect(input(f, 'qc-role').disabled).toBe(true);
      type(input(f, 'qc-phone'), '11987654321');
      type(input(f, 'qc-cep'), '13010111');
      f.detectChanges();
      type(input(f, 'qc-number'), '10');
      f.detectChanges();
      (f.nativeElement as HTMLElement).querySelector('form')!.dispatchEvent(new Event('submit'));
      expect(save).toHaveBeenCalledTimes(1);
      expect(save.mock.calls[0][1]).toMatchObject({
        representativeName: 'João Dono',
        representativeRole: 'Sócio',
        phone: '(11) 98765-4321',
      });
    });

    it('with an empty signer shows only the ask-the-owner message, no form', () => {
      const f = setup(EMPTY_COMPANY_CONTACT, true);
      expect(f.nativeElement.querySelector('form')).toBeNull();
      expect(f.nativeElement.textContent).toContain('proprietário');
      expect(save).not.toHaveBeenCalled();
    });
  });
});
