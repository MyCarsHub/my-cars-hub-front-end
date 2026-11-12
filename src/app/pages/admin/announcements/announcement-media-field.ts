import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import { AnnouncementMedia } from '../../../components/notices/announcement-media';
import { AnnouncementMediaType } from '../../../types/announcement.types';
import { ANNOUNCEMENT_MEDIA_ACCEPT, formatBytes, formatLabel, orientationLabel } from './announcement-media-file';

/** Mídia gravada no servidor, como o campo a mostra. */
export interface MediaFieldMedia {
  type: AnnouncementMediaType;
  url: string | null;
  contentType: string | null;
  sizeBytes: number | null;
  width: number | null;
  height: number | null;
  /** Nome do arquivo escolhido nesta folha (o servidor não guarda o nome). */
  name: string | null;
}

/** Envio em andamento. */
export interface MediaFieldUpload {
  name: string;
  sizeBytes: number;
  contentType: string;
  /** 0–100. */
  progress: number;
}

export interface MediaFieldError {
  name: string | null;
  message: string;
}

/**
 * Campo "Imagem ou vídeo" da folha da novidade (pranchas NovidadeMidiaCampo e
 * NovidadeMidiaCampoEstados): vazio (arrastar/clicar no computador, botão da galeria no
 * celular), enviando (barra e Cancelar), pronto (prévia, Trocar, Remover) e erro.
 *
 * Só desenha e avisa: conferir o arquivo e enviar é da folha.
 */
@Component({
  selector: 'app-announcement-media-field',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [AnnouncementMedia],
  template: `
    <fieldset class="m-0 flex min-w-0 flex-col gap-2.5 border-0 p-0" data-testid="media-field">
      <legend class="mb-2 p-0 text-sm font-medium text-fg-soft">
        Imagem ou vídeo <span class="text-xs font-normal text-fg-subtle">(opcional, um por novidade)</span>
      </legend>

      @if (upload(); as up) {
        <div class="flex items-center gap-3 rounded-2xl bg-surface-sunken p-3.5" data-testid="media-uploading">
          <span aria-hidden="true" class="h-10 w-[72px] shrink-0 rounded-lg bg-surface-strong motion-safe:animate-pulse"></span>
          <div class="flex min-w-0 flex-1 flex-col gap-2">
            <div class="flex justify-between gap-2 text-sm text-fg">
              <span class="truncate">{{ up.name }}</span>
              <span class="shrink-0 text-fg-subtle tabular-nums" data-testid="media-progress-label">{{ up.progress }}%</span>
            </div>
            <div
              role="progressbar"
              aria-label="Enviando arquivo"
              aria-valuemin="0"
              aria-valuemax="100"
              [attr.aria-valuenow]="up.progress"
              class="h-1.5 overflow-hidden rounded-full bg-surface-strong"
              data-testid="media-progress"
            >
              <div class="h-full rounded-full bg-primary-500 transition-[width]" [style.width.%]="up.progress"></div>
            </div>
            <span class="text-xs text-fg-subtle">{{ uploadMeta() }}</span>
          </div>
          <button
            type="button"
            class="press inline-flex min-h-11 shrink-0 items-center rounded-lg px-1.5 text-sm font-semibold text-fg-soft
                   focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400"
            data-testid="media-cancel"
            (click)="cancelRequested.emit()"
          >Cancelar</button>
        </div>
      } @else if (media(); as m) {
        <div class="flex flex-col gap-3 rounded-2xl bg-surface-sunken p-3.5" data-testid="media-ready" [attr.data-type]="m.type">
          <div class="w-full max-w-[440px]">
            <app-announcement-media
              [type]="m.type"
              [url]="m.url"
              [width]="m.width"
              [height]="m.height"
              [alt]="alt()"
              [interactive]="false"
              fit="dialog"
            />
          </div>
          <div class="flex flex-wrap items-center justify-between gap-3">
            <div class="flex min-w-0 flex-col gap-0.5">
              <b class="truncate text-sm font-semibold text-fg">{{ readyName() }}</b>
              <span class="text-xs text-fg-subtle" data-testid="media-meta">{{ readyMeta() }}</span>
            </div>
            <div class="flex items-center gap-1">
              @if (canReplace()) {
                <label
                  class="press relative inline-flex min-h-11 cursor-pointer items-center rounded-full border border-edge px-[18px] text-sm font-semibold text-fg
                         focus-within:ring-2 focus-within:ring-primary-400"
                >
                  <input class="sr-only" type="file" [accept]="accept" data-testid="media-replace" (change)="onInput($event)" />
                  Trocar
                </label>
              }
              @if (canRemove()) {
                <button
                  type="button"
                  class="press inline-flex min-h-11 items-center rounded-lg px-1.5 text-sm font-semibold text-primary-700 disabled:opacity-40
                         dark:text-primary-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400"
                  [disabled]="removing()"
                  data-testid="media-remove"
                  (click)="removeRequested.emit()"
                >Remover</button>
              }
            </div>
          </div>
          @if (error(); as err) {
            <span role="alert" class="text-sm text-rose-600 dark:text-rose-300" data-testid="media-error">{{ err.message }}</span>
          }
        </div>
      } @else if (error(); as err) {
        <div class="flex flex-col gap-3 rounded-2xl bg-surface-sunken p-4" data-testid="media-error-box">
          <div class="flex items-start gap-3">
            <span aria-hidden="true" class="grid size-10 shrink-0 place-items-center rounded-xl bg-surface-muted text-rose-600 dark:text-rose-300">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9" /><path d="M12 7.5v5.5M12 16.5v.01" /></svg>
            </span>
            <div class="flex min-w-0 flex-col gap-1">
              @if (err.name) {
                <span class="truncate text-sm text-fg-subtle">{{ err.name }}</span>
              }
              <span role="alert" class="text-sm text-rose-600 dark:text-rose-300" data-testid="media-error">{{ err.message }}</span>
            </div>
          </div>
          @if (canReplace()) {
            <label
              class="press relative inline-flex min-h-11 cursor-pointer items-center self-start rounded-full border border-edge px-[18px] text-sm font-semibold text-fg
                     focus-within:ring-2 focus-within:ring-primary-400"
            >
              <input class="sr-only" type="file" [accept]="accept" data-testid="media-input" (change)="onInput($event)" />
              Escolher outro arquivo
            </label>
          }
        </div>
      } @else if (canReplace()) {
        <!-- Computador: arrastar ou clicar. -->
        <label
          class="relative hidden min-h-[168px] cursor-pointer flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed p-6 text-center
                 focus-within:ring-2 focus-within:ring-primary-400 focus-within:ring-offset-2 md:flex"
          [class]="dragging() ? 'border-primary-500 bg-primary-50 dark:bg-primary-500/10' : 'border-edge-field bg-surface-sunken'"
          data-testid="media-dropzone"
          (dragover)="onDragOver($event)"
          (dragleave)="dragging.set(false)"
          (drop)="onDrop($event)"
        >
          <input class="sr-only" type="file" [accept]="accept" data-testid="media-input" (change)="onInput($event)" />
          <span
            aria-hidden="true"
            class="grid size-12 place-items-center rounded-[14px]"
            [class]="dragging() ? 'bg-primary-500 text-white' : 'bg-primary-500/15 text-primary-500'"
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 16V4M7 9l5-5 5 5" /><path d="M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" /></svg>
          </span>
          <span class="flex flex-col items-center gap-1">
            <b class="text-base font-semibold text-fg">{{ dragging() ? 'Solte para enviar' : 'Arraste a imagem ou o vídeo para cá' }}</b>
            <span class="text-sm text-fg-subtle">{{ dragging() ? 'Um arquivo por novidade' : 'ou clique para escolher no computador' }}</span>
          </span>
        </label>
        <!-- Celular: botão que abre a galeria ou os arquivos. -->
        <label
          class="relative flex min-h-16 cursor-pointer items-center gap-3 rounded-2xl bg-surface-sunken px-3.5 py-3
                 focus-within:ring-2 focus-within:ring-primary-400 md:hidden"
          data-testid="media-picker"
        >
          <input class="sr-only" type="file" [accept]="accept" (change)="onInput($event)" />
          <span aria-hidden="true" class="grid size-10 shrink-0 place-items-center rounded-xl bg-primary-500/15 text-primary-500">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="3" /><circle cx="9" cy="10" r="1.6" /><path d="M21 16l-5-5-7 8" /></svg>
          </span>
          <span class="flex min-w-0 flex-col gap-0.5">
            <b class="text-base font-semibold text-fg">Escolher imagem ou vídeo</b>
            <span class="text-sm text-fg-subtle">Da galeria ou dos arquivos</span>
          </span>
        </label>
      } @else {
        <span class="text-sm text-fg-subtle" data-testid="media-none">Sem imagem ou vídeo.</span>
      }

      @if (canReplace()) {
        <span class="text-xs leading-[18px] text-fg-subtle">
          Imagem JPG, PNG ou WEBP até 5 MB, de preferência 1600 × 900 (deitada). Vídeo MP4 até 30 s e 25 MB, deitado (16:9) ou em
          pé (9:16). O vídeo começa sem som e repete; tocar liga o som.
        </span>
      }
    </fieldset>
  `,
})
export class AnnouncementMediaField {
  readonly media = input<MediaFieldMedia | null>(null);
  readonly upload = input<MediaFieldUpload | null>(null);
  readonly error = input<MediaFieldError | null>(null);
  /** Escolher/trocar (falso na encerrada: lá só dá para remover). */
  readonly canReplace = input(true);
  readonly canRemove = input(true);
  readonly removing = input(false);
  /** Texto alternativo da prévia (o título). */
  readonly alt = input('');

  readonly picked = output<File>();
  readonly removeRequested = output<void>();
  readonly cancelRequested = output<void>();

  protected readonly accept = ANNOUNCEMENT_MEDIA_ACCEPT;
  protected readonly dragging = signal(false);

  protected readonly uploadMeta = computed(() => {
    const up = this.upload();
    if (!up) return '';
    return `${formatLabel(up.contentType, null)} · ${formatBytes(up.sizeBytes)} · pode continuar escrevendo`;
  });
  protected readonly readyName = computed(() => {
    const m = this.media();
    if (!m) return '';
    return m.name ?? (m.type === 'VIDEO' ? 'Vídeo atual' : 'Imagem atual');
  });
  protected readonly readyMeta = computed(() => {
    const m = this.media();
    if (!m) return '';
    const parts = [formatLabel(m.contentType, m.type)];
    if (m.type === 'IMAGE' && m.width && m.height) parts.push(`${m.width} × ${m.height}`);
    if (m.sizeBytes) parts.push(formatBytes(m.sizeBytes));
    if (m.type === 'VIDEO') {
      const o = orientationLabel(m.width, m.height);
      if (o) parts.push(o);
    }
    return parts.join(' · ');
  });

  protected onInput(event: Event): void {
    const el = event.target as HTMLInputElement;
    const file = el.files?.[0];
    // Limpa para que escolher o MESMO arquivo de novo dispare outra vez.
    el.value = '';
    if (file) this.picked.emit(file);
  }

  protected onDragOver(event: DragEvent): void {
    event.preventDefault();
    this.dragging.set(true);
  }

  protected onDrop(event: DragEvent): void {
    event.preventDefault();
    this.dragging.set(false);
    const file = event.dataTransfer?.files?.[0];
    if (file) this.picked.emit(file);
  }
}
