import { Injectable, computed, signal } from '@angular/core';
import { AsyncSubject, Observable } from 'rxjs';
import { AnnouncementAudience } from '../../types/announcement.types';

/** REMINDER: algo que o usuário precisa fazer. NEWS: novidade do produto. */
export type NoticeType = 'REMINDER' | 'NEWS';

/** Como o aviso terminou: `resolved` = o usuário fez o que o aviso pedia; `dismissed` = saiu. */
export type NoticeOutcome = 'resolved' | 'dismissed';

/** Link do aviso para uma rota do app. */
export interface NoticeLink {
  label: string;
  route: string;
}

/**
 * Mídia no topo do aviso (novidade). `url` é assinada e de validade curta: `refresh` pede
 * outra quando ela falha. Nunca vai para storage.
 */
export interface NoticeMedia {
  type: 'IMAGE' | 'VIDEO';
  url: string;
  width: number | null;
  height: number | null;
  refresh?: () => Observable<string | null>;
}

/** Corpo especial que o popup sabe desenhar dentro do aviso. */
export type NoticeForm = 'company-contact';

export interface Notice {
  /** Identidade estável: o mesmo id enfileirado duas vezes é um aviso só. */
  id: string;
  type: NoticeType;
  title: string;
  message: string;
  /** Lista curta de "o que falta" / "o que mudou". */
  items?: readonly string[];
  /** Bloqueante: sem X, sem Esc, sem fundo; a saída é só pelos botões do aviso. */
  blocking?: boolean;
  /** Formulário inline (o usuário resolve sem sair da tela). */
  form?: NoticeForm;
  /** Só para `company-contact`: nome e cargo de quem assina ficam somente leitura (gerente). */
  signerReadOnly?: boolean;
  /** Atalho para uma página (ex.: `/configuracoes/contato`). */
  link?: NoticeLink;
  /** Texto do botão de sair; padrão "Agora não". */
  dismissLabel?: string;
  /** Imagem ou vídeo no topo (só novidade). */
  media?: NoticeMedia;
  /** Área de quem lê (só novidade): muda a frase do topo laranja. */
  audience?: AnnouncementAudience;
}

/**
 * Fila de avisos (lembretes e novidades) mostrados pelo `app-notices-popup`.
 *
 * - Um aviso por vez; os bloqueantes passam à frente dos demais (ordem de chegada dentro de cada grupo).
 * - `enqueue` devolve um Observable que emite UMA vez, com o desfecho, quando o aviso sai da fila —
 *   é como quem pediu o aviso (ex.: criar aluguel) sabe se pode seguir.
 * - Novidades do servidor entram pelo `NewsNoticesService` (todas as não lidas, uma de cada vez, NEWS, não bloqueante).
 */
@Injectable({ providedIn: 'root' })
export class NoticesService {
  private readonly items = signal<readonly Notice[]>([]);
  private readonly outcomes = new Map<string, AsyncSubject<NoticeOutcome>>();

  /** O aviso que está na tela (ou `null`). */
  readonly current = computed<Notice | null>(() => this.items()[0] ?? null);
  /** A fila inteira, o atual primeiro (só leitura). */
  readonly queue = this.items.asReadonly();
  /** Quantos esperam depois do atual. */
  readonly waiting = computed(() => Math.max(0, this.items().length - 1));

  enqueue(notice: Notice): Observable<NoticeOutcome> {
    const existing = this.outcomes.get(notice.id);
    if (existing) return existing.asObservable();

    const subject = new AsyncSubject<NoticeOutcome>();
    this.outcomes.set(notice.id, subject);
    this.items.update((list) => {
      const next = [...list];
      if (notice.blocking) {
        // Depois do último bloqueante, antes dos demais — mas nunca por cima do que já está na tela.
        let at = next.length;
        for (let i = 1; i < next.length; i++) {
          if (!next[i].blocking) {
            at = i;
            break;
          }
        }
        next.splice(next.length === 0 ? 0 : at, 0, notice);
      } else {
        next.push(notice);
      }
      return next;
    });
    return subject.asObservable();
  }

  /** O usuário fez o que o aviso pedia. */
  resolve(id: string): void {
    this.finish(id, 'resolved');
  }

  /** O usuário saiu sem resolver. */
  dismiss(id: string): void {
    this.finish(id, 'dismissed');
  }

  /**
   * Tira da fila SEM desfecho: quem pediu o aviso não recebe nada (o Observable só completa).
   * Para quando o aviso nem pôde ser mostrado — a novidade não conta como lida.
   */
  discard(id: string): void {
    const subject = this.outcomes.get(id);
    if (!subject) return;
    this.outcomes.delete(id);
    this.items.update((list) => list.filter((n) => n.id !== id));
    subject.complete();
  }

  private finish(id: string, outcome: NoticeOutcome): void {
    const subject = this.outcomes.get(id);
    if (!subject) return;
    this.outcomes.delete(id);
    this.items.update((list) => list.filter((n) => n.id !== id));
    subject.next(outcome);
    subject.complete();
  }
}
