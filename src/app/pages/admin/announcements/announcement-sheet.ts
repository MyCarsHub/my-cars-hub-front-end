import { DOCUMENT, NgTemplateOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  OnInit,
  computed,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormArray, FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { HttpEventType } from '@angular/common/http';
import { Observable, Subscription, of, switchMap, tap } from 'rxjs';
import { AlertBanner } from '../../../components/alert-banner/alert-banner';
import { BottomSheet } from '../../../components/core/bottom-sheet/bottom-sheet';
import { ApiErrorService } from '../../../services/api-error.service';
import { toStoredAppLink } from '../../../utils/app-link';
import {
  ANNOUNCEMENT_LIMITS,
  AdminAnnouncement,
  AnnouncementAudience,
  AnnouncementRequest,
} from '../../../types/announcement.types';
import { AdminAnnouncementsService } from './admin-announcements.service';
import { mediaKindOf, validateAnnouncementMedia } from './announcement-media-file';
import {
  AnnouncementMediaField,
  MediaFieldError,
  MediaFieldMedia,
  MediaFieldUpload,
} from './announcement-media-field';
import { AnnouncementPreview, PreviewDevice } from './announcement-preview';

/** `new` = criar (ou duplicar); `edit` = rascunho ou publicada; `view` = encerrada (só leitura). */
export type AnnouncementSheetMode = 'new' | 'edit' | 'view';

/** Rota do app (`/algo`, nunca `//host`) ou `https://` — a mesma regra do servidor. */
export function isAllowedLink(url: string): boolean {
  for (let i = 0; i < url.length; i++) {
    const code = url.charCodeAt(i);
    // Controle (0-31, 127) ou espaço de qualquer tipo: recusado.
    if (code <= 32 || code === 127 || /\s/.test(url[i])) return false;
  }
  if (url.startsWith('/')) return !url.startsWith('//') && !url.startsWith('/\\');
  if (url.length <= 8 || url.slice(0, 8).toLowerCase() !== 'https://') return false;
  try {
    return new URL(url).protocol === 'https:';
  } catch {
    return false;
  }
}

interface PreviewState {
  title: string;
  body: string;
  items: string[];
  linkUrl: string;
  linkLabel: string;
  loc: boolean;
  mot: boolean;
  startsOn: string;
  endsOn: string;
}

/**
 * Folha "Nova novidade" (prancha NovidadeForm): formulário à esquerda e prévia ao vivo à
 * direita (celular/computador × locadora/motorista). No celular a prévia desce para baixo do
 * formulário. Publicar exige pelo menos um público.
 */
@Component({
  selector: 'app-announcement-sheet',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [BottomSheet, ReactiveFormsModule, AlertBanner, AnnouncementPreview, NgTemplateOutlet, AnnouncementMediaField],
  templateUrl: './announcement-sheet.html',
})
export class AnnouncementSheet implements OnInit {
  private readonly service = inject(AdminAnnouncementsService);
  private readonly apiErrors = inject(ApiErrorService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly currentHost = inject(DOCUMENT).defaultView?.location?.host ?? null;
  private readonly sheet = viewChild(BottomSheet);

  /** Novidade aberta; `null` = nova. */
  readonly announcement = input<AdminAnnouncement | null>(null);
  /** Abre uma encerrada como base de um rascunho novo. */
  readonly duplicate = input(false);
  /** Algo mudou no servidor (a lista recarrega). */
  readonly saved = output<AdminAnnouncement>();
  readonly closed = output<void>();
  /** Um rascunho foi criado mesmo que o passo seguinte (publicar) tenha falhado: a lista recarrega. */
  readonly listChanged = output<void>();

  protected readonly limits = ANNOUNCEMENT_LIMITS;
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  /** Duplicar a partir da tela de uma encerrada troca o modo para `new`. */
  private readonly duplicating = signal(false);
  /**
   * Id do rascunho criado por ESTA folha. Se "Publicar" criou e a publicação falhou, a nova
   * tentativa atualiza e publica a mesma linha, em vez de criar outro rascunho.
   */
  private readonly createdId = signal<string | null>(null);

  /** Mídia gravada no servidor (a da novidade aberta; some ao duplicar). */
  protected readonly media = signal<MediaFieldMedia | null>(null);
  protected readonly upload = signal<MediaFieldUpload | null>(null);
  protected readonly mediaError = signal<MediaFieldError | null>(null);
  protected readonly removingMedia = signal(false);
  /** Envio (ou criação do rascunho + envio) em voo; desinscrever cancela. */
  private uploadSub: Subscription | null = null;
  /** Encerrada: trocar não pode (409); remover pode. */
  protected readonly canReplaceMedia = computed(() => this.mode() !== 'view');
  protected readonly mediaBusy = computed(() => this.upload() !== null || this.removingMedia());

  protected readonly mode = computed<AnnouncementSheetMode>(() => {
    const a = this.announcement();
    if (!a || this.duplicate() || this.duplicating()) return 'new';
    return a.status === 'EXPIRED' ? 'view' : 'edit';
  });
  protected readonly isPublished = computed(
    () => this.mode() === 'edit' && this.announcement()?.status === 'PUBLISHED',
  );

  protected readonly title = computed(() => {
    switch (this.mode()) {
      case 'view':
        return 'Novidade encerrada';
      case 'edit':
        return this.isPublished() ? 'Editar novidade publicada' : 'Editar rascunho';
      default:
        return 'Nova novidade';
    }
  });
  protected readonly subtitle = computed(() => {
    switch (this.mode()) {
      case 'view':
        return 'Encerrada não volta ao ar. Duplique como rascunho para reaproveitar o texto.';
      case 'edit':
        return this.isPublished()
          ? 'No ar. A mudança vale para quem ainda não leu; quem já leu não vê de novo.'
          : 'Rascunho. Ninguém vê até você publicar.';
      default:
        return 'Rascunho. Ninguém vê até você publicar.';
    }
  });

  protected readonly form = new FormGroup({
    title: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.maxLength(ANNOUNCEMENT_LIMITS.title)],
    }),
    body: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.maxLength(ANNOUNCEMENT_LIMITS.body)],
    }),
    items: new FormArray<FormControl<string>>([]),
    linkUrl: new FormControl('', { nonNullable: true }),
    linkLabel: new FormControl('', { nonNullable: true }),
    loc: new FormControl(false, { nonNullable: true }),
    mot: new FormControl(false, { nonNullable: true }),
    startsOn: new FormControl('', { nonNullable: true }),
    endsOn: new FormControl('', { nonNullable: true }),
  });

  /** Espelho do formulário para a prévia e os contadores (o form não é sinal). */
  protected readonly state = signal<PreviewState>({
    title: '',
    body: '',
    items: [],
    linkUrl: '',
    linkLabel: '',
    loc: false,
    mot: false,
    startsOn: '',
    endsOn: '',
  });

  protected readonly device = signal<PreviewDevice>('phone');
  private readonly pickedArea = signal<AnnouncementAudience>('LOCADORA');

  protected readonly noAudience = computed(() => !this.state().loc && !this.state().mot);
  protected readonly showAreas = computed(() => this.state().loc && this.state().mot);
  protected readonly area = computed<AnnouncementAudience>(() => {
    const s = this.state();
    if (s.loc && s.mot) return this.pickedArea();
    return s.mot ? 'MOTORISTA' : 'LOCADORA';
  });
  protected readonly previewLink = computed(() =>
    this.state().linkUrl.trim() ? this.state().linkLabel : '',
  );
  protected readonly canAddItem = computed(() => this.state().items.length < ANNOUNCEMENT_LIMITS.items);

  /** Erro de link na hora (o servidor também recusa). */
  protected readonly linkError = computed(() => {
    const url = this.state().linkUrl.trim();
    const label = this.state().linkLabel.trim();
    if (!url && !label) return null;
    if (!url || !label) return 'Link e texto do botão vão juntos: preencha os dois ou nenhum.';
    if (!isAllowedLink(url)) return 'Use uma página do app (começa com /) ou um endereço https.';
    return null;
  });
  protected readonly periodError = computed(() => {
    const { startsOn: start, endsOn: end } = this.state();
    return start && end && end < start ? 'O fim não pode ser antes do início.' : null;
  });

  protected readonly contentValid = computed(() => {
    const s = this.state();
    return (
      s.title.trim().length > 0 &&
      s.body.trim().length > 0 &&
      s.title.length <= ANNOUNCEMENT_LIMITS.title &&
      s.body.length <= ANNOUNCEMENT_LIMITS.body &&
      !this.linkError() &&
      !this.periodError()
    );
  });
  protected readonly canSave = computed(() => this.contentValid() && !this.busy() && !this.mediaBusy());
  protected readonly canPublish = computed(() => this.canSave() && !this.noAudience());

  ngOnInit(): void {
    this.destroyRef.onDestroy(() => this.cancelUpload());
    this.fill(this.announcement());
    if (this.mode() === 'view') this.form.disable({ emitEvent: false });
    this.form.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => this.sync());
    this.sync();
  }

  protected get itemControls(): FormControl<string>[] {
    return this.form.controls.items.controls;
  }

  protected addItem(): void {
    if (!this.canAddItem()) return;
    this.form.controls.items.push(
      new FormControl('', { nonNullable: true, validators: [Validators.maxLength(ANNOUNCEMENT_LIMITS.item)] }),
    );
  }

  protected removeItem(index: number): void {
    this.form.controls.items.removeAt(index);
  }

  protected pickDevice(d: PreviewDevice): void {
    this.device.set(d);
  }

  protected pickArea(a: AnnouncementAudience): void {
    this.pickedArea.set(a);
  }

  protected saveDraft(): void {
    if (!this.canSave()) return;
    this.run(this.persist(), 'Não foi possível salvar a novidade.');
  }

  /** Salva e publica (rascunho/nova). */
  protected publish(): void {
    if (!this.canPublish()) return;
    this.run(
      this.persist().pipe(switchMap((a) => this.service.publish(a.id))),
      'Não foi possível publicar a novidade.',
    );
  }

  /** Publicada: grava as mudanças, continua no ar. */
  protected saveChanges(): void {
    if (!this.canPublish()) return;
    this.run(this.persist(), 'Não foi possível salvar as mudanças.');
  }

  /**
   * Arquivo escolhido: confere na hora (formato e tamanho) e envia. A mídia sobe para um
   * rascunho JÁ salvo: sendo nova, a folha cria o rascunho primeiro e guarda o id (o mesmo
   * que "Publicar" usa depois). Numa existente, envia direto, sem gravar o texto.
   */
  protected onMediaPicked(file: File): void {
    if (!this.canReplaceMedia() || this.mediaBusy()) return;
    const problem = validateAnnouncementMedia(file);
    if (problem) {
      this.mediaError.set({ name: file.name, message: problem });
      return;
    }
    const id = this.savedId();
    if (!id && !this.contentValid()) {
      this.mediaError.set({
        name: file.name,
        message: 'Preencha o título e o texto antes de enviar a mídia: ela fica guardada no rascunho.',
      });
      return;
    }
    const kind = mediaKindOf(file)!;
    this.mediaError.set(null);
    this.error.set(null);
    this.upload.set({ name: file.name, sizeBytes: file.size, contentType: kind.contentType, progress: 0 });
    const target$: Observable<string> = id ? of(id) : this.persist().pipe(switchMap((a) => of(a.id)));
    this.uploadSub = target$
      .pipe(switchMap((target) => this.service.uploadMedia(target, file)))
      .subscribe({
        next: (event) => {
          if (event.type === HttpEventType.UploadProgress) {
            const pct = event.total ? Math.round((100 * event.loaded) / event.total) : 0;
            this.upload.update((u) => (u ? { ...u, progress: Math.min(99, pct) } : u));
          } else if (event.type === HttpEventType.Response && event.body) {
            this.uploadSub = null;
            this.upload.set(null);
            this.media.set(this.mediaOf(event.body, file.name));
            this.listChanged.emit();
          }
        },
        error: (err: unknown) => {
          this.uploadSub = null;
          this.upload.set(null);
          this.mediaError.set({ name: file.name, message: this.apiErrors.messageFor(err, 'Não foi possível enviar o arquivo.') });
        },
      });
  }

  /** Cancela o envio (aborta o XHR). Um rascunho já criado continua existindo. */
  protected cancelUpload(): void {
    this.uploadSub?.unsubscribe();
    this.uploadSub = null;
    this.upload.set(null);
  }

  protected removeMedia(): void {
    const id = this.savedId();
    if (!id || this.mediaBusy()) return;
    this.removingMedia.set(true);
    this.mediaError.set(null);
    this.service
      .removeMedia(id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.removingMedia.set(false);
          this.media.set(null);
          this.listChanged.emit();
        },
        error: (err: unknown) => {
          this.removingMedia.set(false);
          this.mediaError.set({ name: null, message: this.apiErrors.messageFor(err, 'Não foi possível remover a mídia.') });
        },
      });
  }

  /** Encerrada → rascunho novo com o mesmo texto (datas em branco). */
  protected startDuplicate(): void {
    // A mídia não vai junto: o rascunho novo começa sem, e a pessoa envia de novo se quiser.
    this.media.set(null);
    this.mediaError.set(null);
    this.duplicating.set(true);
    this.form.enable({ emitEvent: false });
    this.form.patchValue({ startsOn: '', endsOn: '' });
    this.sync();
  }

  protected close(): void {
    this.sheet()?.requestClose();
  }

  private run(call: Observable<AdminAnnouncement>, fallback: string): void {
    this.busy.set(true);
    this.error.set(null);
    call.subscribe({
      next: (a) => {
        this.busy.set(false);
        this.saved.emit(a);
        this.sheet()?.requestClose(true);
      },
      error: (err: unknown) => {
        this.busy.set(false);
        this.error.set(this.apiErrors.messageFor(err, fallback));
      },
    });
  }

  /** Id da linha no servidor que esta folha edita (rascunho criado aqui, ou a aberta). */
  private savedId(): string | null {
    const created = this.createdId();
    if (created) return created;
    const a = this.announcement();
    return a && this.mode() !== 'new' ? a.id : null;
  }

  private mediaOf(a: AdminAnnouncement, name: string | null): MediaFieldMedia | null {
    if (!a.mediaType) return null;
    return {
      type: a.mediaType,
      url: a.mediaUrl ?? null,
      contentType: a.mediaContentType ?? null,
      sizeBytes: a.mediaSizeBytes ?? null,
      width: a.mediaWidth ?? null,
      height: a.mediaHeight ?? null,
      name,
    };
  }

  private persist(): Observable<AdminAnnouncement> {
    const req = this.request();
    const created = this.createdId();
    if (created) return this.service.update(created, req);
    const a = this.announcement();
    if (this.mode() === 'edit' && a) return this.service.update(a.id, req);
    return this.service.create(req).pipe(
      tap((draft) => {
        this.createdId.set(draft.id);
        this.listChanged.emit();
      }),
    );
  }

  private request(): AnnouncementRequest {
    const v = this.form.getRawValue();
    const audiences: AnnouncementAudience[] = [];
    if (v.loc) audiences.push('LOCADORA');
    if (v.mot) audiences.push('MOTORISTA');
    // Endereço completo do próprio app grava como rota: abre na mesma aba, onde a sessão vive.
    const linkUrl = toStoredAppLink(v.linkUrl.trim(), this.currentHost);
    const linkLabel = v.linkLabel.trim();
    return {
      title: v.title.trim(),
      body: v.body.trim(),
      items: v.items.map((s) => s.trim()).filter((s) => s.length > 0),
      linkUrl: linkUrl || null,
      linkLabel: linkLabel || null,
      audiences,
      startsOn: v.startsOn || null,
      endsOn: v.endsOn || null,
    };
  }

  private fill(a: AdminAnnouncement | null): void {
    if (!a) {
      // Nova: começa com um item vazio, como a prancha, e sem público escolhido.
      this.addItem();
      return;
    }
    for (const item of a.items ?? []) {
      this.form.controls.items.push(
        new FormControl(item, { nonNullable: true, validators: [Validators.maxLength(ANNOUNCEMENT_LIMITS.item)] }),
      );
    }
    const dup = this.duplicate();
    if (!dup) this.media.set(this.mediaOf(a, null));
    this.form.patchValue(
      {
        title: a.title,
        body: a.body,
        linkUrl: a.linkUrl ?? '',
        linkLabel: a.linkLabel ?? '',
        loc: a.audiences.includes('LOCADORA'),
        mot: a.audiences.includes('MOTORISTA'),
        startsOn: dup ? '' : (a.startsOn ?? ''),
        endsOn: dup ? '' : (a.endsOn ?? ''),
      },
      { emitEvent: false },
    );
  }

  private sync(): void {
    const v = this.form.getRawValue();
    this.state.set({
      title: v.title,
      body: v.body,
      items: [...v.items],
      linkUrl: v.linkUrl,
      linkLabel: v.linkLabel,
      loc: v.loc,
      mot: v.mot,
      startsOn: v.startsOn,
      endsOn: v.endsOn,
    });
  }
}
