import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, provideRouter } from '@angular/router';
import { NEVER, Subject, of, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { VehicleForm } from './vehicle-form';
import { VehiclesService } from '../../services/vehicles.service';
import { InsurancesService } from '../../services/insurances.service';
import { NotificationService } from '../../services/notification.service';
import { ApiErrorService } from '../../services/api-error.service';
import { FipeService } from '../../services/fipe.service';
import { SessionService } from '../../services/session.service';

/**
 * Foto do veículo no formulário (cadastro e edição): campo opcional, só dono e
 * gerente, enviado DEPOIS de o veículo existir pelo mesmo anexo PHOTO do card
 * de documentos. A falha da foto nunca perde o veículo.
 */
describe('VehicleForm — foto do veículo', () => {
  const NEW_ID = 'veh-novo';
  const EDIT_ID = 'veh-1';

  let create: ReturnType<typeof vi.fn>;
  let update: ReturnType<typeof vi.fn>;
  let getOne: ReturnType<typeof vi.fn>;
  let uploadDocument: ReturnType<typeof vi.fn>;
  let deleteDocument: ReturnType<typeof vi.fn>;
  let listDocuments: ReturnType<typeof vi.fn>;
  let documentSignedUrl: ReturnType<typeof vi.fn>;
  let notifySuccess: ReturnType<typeof vi.fn>;
  let navigate: ReturnType<typeof vi.spyOn>;
  let fixture: ReturnType<typeof TestBed.createComponent<VehicleForm>>;

  const photo = new File(['jpg'], 'frente.jpg', { type: 'image/jpeg' });
  const otherPhoto = new File(['png'], 'lateral.png', { type: 'image/png' });

  interface FormApi {
    form: { patchValue: (v: unknown) => void };
    submit: () => void;
    isEdit: () => boolean;
  }

  const api = (): FormApi => fixture.componentInstance as unknown as FormApi;
  const host = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const q = <T extends HTMLElement>(sel: string): T | null => host().querySelector<T>(sel);

  function fillValidVehicle(): void {
    api().form.patchValue({
      plate: 'ABC1D23',
      brand: 'Fiat',
      model: 'Mobi',
      yearManufacture: 2022,
      yearModel: 2022,
      hodometer: 1000,
    });
  }

  function choose(file: File): void {
    const input = q<HTMLInputElement>('[data-photo-input]');
    if (!input) throw new Error('o seletor da foto não está na tela');
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    input.dispatchEvent(new Event('change'));
    fixture.detectChanges();
  }

  function click(sel: string): void {
    const el = q<HTMLButtonElement>(sel);
    if (!el) throw new Error(`${sel} não está na tela`);
    el.click();
    fixture.detectChanges();
  }

  async function setup(opts: { role: string | null; editing?: boolean; listPending?: boolean }): Promise<void> {
    TestBed.resetTestingModule();
    create = vi.fn().mockReturnValue(of({ id: NEW_ID }));
    update = vi.fn().mockReturnValue(of({ id: EDIT_ID }));
    getOne = vi.fn().mockReturnValue(
      of({
        id: EDIT_ID,
        plate: 'ABC1D23',
        type: 'CAR',
        brand: 'Fiat',
        model: 'Mobi',
        yearManufacture: 2022,
        yearModel: 2022,
        hodometer: 1000,
      }),
    );
    uploadDocument = vi.fn().mockReturnValue(of({ id: 'doc-novo' }));
    deleteDocument = vi.fn().mockReturnValue(of(void 0));
    listDocuments = vi
      .fn()
      .mockReturnValue(opts.listPending ? NEVER : of([{ id: 'doc-foto', kind: 'PHOTO' }]));
    documentSignedUrl = vi.fn().mockReturnValue(of({ url: 'https://cdn.test/foto.jpg' }));
    notifySuccess = vi.fn();

    await TestBed.configureTestingModule({
      imports: [VehicleForm],
      providers: [
        provideRouter([]),
        ApiErrorService,
        {
          provide: VehiclesService,
          useValue: {
            create,
            update,
            getOne,
            uploadDocument,
            deleteDocument,
            listDocuments,
            documentSignedUrl,
            plateLookupUnavailable: signal(false),
          },
        },
        { provide: InsurancesService, useValue: { create: vi.fn() } },
        { provide: FipeService, useValue: { brands: () => of([]), models: () => of([]), years: () => of([]) } },
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: {
              paramMap: { get: () => (opts.editing ? EDIT_ID : null) },
              queryParamMap: { get: () => null },
            },
          },
        },
        {
          provide: NotificationService,
          useValue: { error: vi.fn(), warning: vi.fn(), info: vi.fn(), success: notifySuccess },
        },
      ],
    }).compileComponents();

    vi.spyOn(TestBed.inject(SessionService), 'getCompanyRoleFromToken').mockReturnValue(opts.role);
    navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    fixture = TestBed.createComponent(VehicleForm);
    fixture.detectChanges();
  }

  afterEach(() => {
    TestBed.resetTestingModule();
  });

  describe('cadastro', () => {
    beforeEach(async () => {
      await setup({ role: 'OWNER' });
    });

    it('cria COM foto: o veículo é criado primeiro e a foto sobe como PHOTO, depois navega', () => {
      fillValidVehicle();
      choose(photo);
      expect(q('[data-photo-preview]')).not.toBeNull();
      expect(q('[data-photo-name]')?.textContent).toContain('frente.jpg');

      api().submit();
      fixture.detectChanges();

      expect(create).toHaveBeenCalledTimes(1);
      expect(uploadDocument).toHaveBeenCalledTimes(1);
      expect(uploadDocument).toHaveBeenCalledWith(NEW_ID, 'PHOTO', photo);
      expect(create.mock.invocationCallOrder[0]).toBeLessThan(
        uploadDocument.mock.invocationCallOrder[0],
      );
      expect(notifySuccess).toHaveBeenCalledWith('Foto do veículo salva.');
      expect(navigate).toHaveBeenCalledWith(['/veiculos', NEW_ID]);
    });

    it('cria SEM foto: nenhum envio de anexo e o fluxo é o de sempre', () => {
      fillValidVehicle();
      api().submit();
      fixture.detectChanges();

      expect(create).toHaveBeenCalledTimes(1);
      expect(uploadDocument).not.toHaveBeenCalled();
      expect(deleteDocument).not.toHaveBeenCalled();
      expect(navigate).toHaveBeenCalledWith(['/veiculos', NEW_ID]);
    });

    it('a falha da foto NÃO perde o veículo: avisa, oferece reenviar e o reenvio sobe só a foto', () => {
      uploadDocument.mockReturnValueOnce(
        throwError(
          () => new HttpErrorResponse({ status: 500, error: { message: 'Falha no armazenamento.' } }),
        ),
      );
      fillValidVehicle();
      choose(photo);
      api().submit();
      fixture.detectChanges();

      expect(create).toHaveBeenCalledTimes(1);
      expect(api().isEdit()).toBe(true);
      expect(navigate).not.toHaveBeenCalled();
      const failure = q('[data-photo-failure]');
      expect(failure?.textContent).toContain('O veículo foi salvo, mas a foto não foi enviada.');
      expect(failure?.textContent).toContain('Falha no armazenamento.');
      expect(q('[data-photo-retry]')?.textContent).toContain('Tentar enviar a foto de novo');

      click('[data-photo-retry]');

      expect(create).toHaveBeenCalledTimes(1);
      expect(update).not.toHaveBeenCalled();
      expect(uploadDocument).toHaveBeenCalledTimes(2);
      expect(uploadDocument).toHaveBeenLastCalledWith(NEW_ID, 'PHOTO', photo);
      expect(navigate).toHaveBeenCalledWith(['/veiculos', NEW_ID]);
    });

    it('«Continuar sem a foto» leva ao veículo já criado', () => {
      uploadDocument.mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 500 })));
      fillValidVehicle();
      choose(photo);
      api().submit();
      fixture.detectChanges();

      click('[data-photo-skip]');

      expect(navigate).toHaveBeenCalledWith(['/veiculos', NEW_ID]);
      expect(create).toHaveBeenCalledTimes(1);
    });

    it('recusa PDF e HEIC antes de qualquer envio, com a razão na tela', () => {
      choose(new File(['x'], 'crlv.pdf', { type: 'application/pdf' }));
      expect(q('[data-photo-rejection]')?.textContent).toContain('JPG, PNG ou WebP');
      choose(new File(['x'], 'iphone.heic', { type: 'image/heic' }));
      expect(q('[data-photo-rejection]')).not.toBeNull();
      expect(q('[data-photo-preview]')).toBeNull();

      fillValidVehicle();
      api().submit();
      expect(uploadDocument).not.toHaveBeenCalled();
    });

    it('remover antes de salvar descarta a escolha', () => {
      choose(photo);
      click('[data-photo-remove]');
      expect(q('[data-photo-name]')).toBeNull();
      expect(q('[data-photo-remove]')).toBeNull();

      fillValidVehicle();
      api().submit();
      expect(uploadDocument).not.toHaveBeenCalled();
    });

    it('botões a partir de 44px (min-h-11) e texto de 16px (text-base)', () => {
      choose(photo);
      for (const sel of ['[data-photo-pick]', '[data-photo-remove]']) {
        const cls = q(sel)?.className ?? '';
        expect(cls).toContain('min-h-11');
        expect(cls).toContain('text-base');
      }
      expect(q('[data-photo-thumb]')?.className).toContain('aspect-square');
    });

    it('não envia a foto enquanto o veículo ainda está sendo criado (a foto vem DEPOIS)', () => {
      const pending = new Subject<{ id: string }>();
      create.mockReturnValue(pending);
      fillValidVehicle();
      choose(photo);
      api().submit();
      expect(uploadDocument).not.toHaveBeenCalled();
      pending.next({ id: NEW_ID });
      pending.complete();
      expect(uploadDocument).toHaveBeenCalledWith(NEW_ID, 'PHOTO', photo);
    });
  });

  describe('edição', () => {
    beforeEach(async () => {
      await setup({ role: 'MANAGER', editing: true });
    });

    it('mostra a foto atual (URL assinada) com trocar e remover', () => {
      expect(listDocuments).toHaveBeenCalledWith(EDIT_ID);
      expect(documentSignedUrl).toHaveBeenCalledWith(EDIT_ID, 'doc-foto');
      expect(q<HTMLImageElement>('[data-photo-preview]')?.getAttribute('src')).toBe(
        'https://cdn.test/foto.jpg',
      );
      expect(q('[data-photo-pick]')?.textContent).toContain('Trocar foto');
      expect(q('[data-photo-remove]')).not.toBeNull();
    });

    it('trocar SUBSTITUI o anexo: apaga o atual e só então anexa o novo (nunca acumula)', () => {
      choose(otherPhoto);
      api().submit();
      fixture.detectChanges();

      expect(update).toHaveBeenCalledTimes(1);
      expect(deleteDocument).toHaveBeenCalledWith(EDIT_ID, 'doc-foto');
      expect(uploadDocument).toHaveBeenCalledWith(EDIT_ID, 'PHOTO', otherPhoto);
      expect(deleteDocument.mock.invocationCallOrder[0]).toBeLessThan(
        uploadDocument.mock.invocationCallOrder[0],
      );
      expect(navigate).toHaveBeenCalledWith(['/veiculos', EDIT_ID]);
    });

    it('remover apaga o anexo ao salvar e não envia nada', () => {
      click('[data-photo-remove]');
      expect(deleteDocument).not.toHaveBeenCalled();
      expect(q('[data-photo-preview]')).toBeNull();

      api().submit();
      fixture.detectChanges();

      expect(deleteDocument).toHaveBeenCalledWith(EDIT_ID, 'doc-foto');
      expect(uploadDocument).not.toHaveBeenCalled();
      expect(navigate).toHaveBeenCalledWith(['/veiculos', EDIT_ID]);
    });

    it('salvar sem mexer na foto não toca no anexo', () => {
      api().submit();
      fixture.detectChanges();

      expect(update).toHaveBeenCalledTimes(1);
      expect(deleteDocument).not.toHaveBeenCalled();
      expect(uploadDocument).not.toHaveBeenCalled();
    });

    it('se o envio da nova falha depois de apagar a antiga, o retry só envia (não apaga de novo)', () => {
      uploadDocument.mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 503 })));
      choose(otherPhoto);
      api().submit();
      fixture.detectChanges();

      expect(q('[data-photo-failure]')?.textContent).toContain('A foto anterior já foi removida');
      listDocuments.mockReturnValue(of([]));
      click('[data-photo-retry]');

      expect(deleteDocument).toHaveBeenCalledTimes(1);
      expect(uploadDocument).toHaveBeenCalledTimes(2);
      expect(update).toHaveBeenCalledTimes(1);
      expect(navigate).toHaveBeenCalledWith(['/veiculos', EDIT_ID]);
    });
  });

  describe('retry com resposta perdida', () => {
    it('relista os anexos: se a foto já chegou ao servidor, apaga e reenvia em vez de bater na duplicata', async () => {
      await setup({ role: 'OWNER' });
      uploadDocument.mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 504 })));
      fillValidVehicle();
      choose(photo);
      api().submit();
      fixture.detectChanges();

      listDocuments.mockReturnValue(of([{ id: 'doc-fantasma', kind: 'PHOTO' }]));
      click('[data-photo-retry]');

      expect(listDocuments).toHaveBeenCalledWith(NEW_ID);
      expect(deleteDocument).toHaveBeenCalledWith(NEW_ID, 'doc-fantasma');
      expect(uploadDocument).toHaveBeenCalledTimes(2);
      expect(navigate).toHaveBeenCalledWith(['/veiculos', NEW_ID]);
    });
  });

  describe('edição — carregamento', () => {
    it('o campo fica travado até a listagem de anexos responder', async () => {
      await setup({ role: 'OWNER', editing: true, listPending: true });
      expect(q<HTMLButtonElement>('[data-photo-pick]')?.disabled).toBe(true);
    });

    it('e destravado quando ela responde', async () => {
      await setup({ role: 'OWNER', editing: true });
      expect(q<HTMLButtonElement>('[data-photo-pick]')?.disabled).toBe(false);
    });
  });

  describe('permissões', () => {
    it('o motorista não vê o campo, não lista anexos e não tem seletor de foto', async () => {
      await setup({ role: 'DRIVER', editing: true });

      expect(q('app-vehicle-photo-field')).toBeNull();
      expect(q('[data-photo-input]')).toBeNull();
      expect(listDocuments).not.toHaveBeenCalled();
      expect(host().textContent).not.toContain('Foto do veículo');
    });

    it('sem papel conhecido o campo também não aparece (fail-closed)', async () => {
      await setup({ role: null });
      expect(q('app-vehicle-photo-field')).toBeNull();
    });

    it('dono vê o campo no cadastro', async () => {
      await setup({ role: 'OWNER' });
      expect(q('app-vehicle-photo-field')).not.toBeNull();
      expect(host().textContent).toContain('Foto do veículo (opcional)');
    });
  });
});
