import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { DOCUMENT } from '@angular/common';
import { Router } from '@angular/router';
import { NewsTabs } from '../../components/news-tabs/news-tabs';
import { map } from 'rxjs';
import { classifyAppLink } from '../../utils/app-link';
import { AnnouncementMedia, AnnouncementMediaRefresh } from '../../components/notices/announcement-media';
import { DefaultPageLayout } from '../../components/layout/default-page-layout/default-page-layout';
import { StatusChip } from '../../components/core/status-chip/status-chip';
import { NewsFeedService } from '../../services/news-feed.service';
import { NewsUnreadBadgeStore } from '../../services/news-unread-badge.store';
import { SessionService } from '../../services/session.service';
import { AnnouncementFeedItem } from '../../types/announcement-feed.types';
import { AnnouncementMediaType } from '../../types/announcement.types';

const MONTHS_SHORT = ['jan.', 'fev.', 'mar.', 'abr.', 'maio', 'jun.', 'jul.', 'ago.', 'set.', 'out.', 'nov.', 'dez.'];
const MONTHS_LONG = [
  'janeiro',
  'fevereiro',
  'março',
  'abril',
  'maio',
  'junho',
  'julho',
  'agosto',
  'setembro',
  'outubro',
  'novembro',
  'dezembro',
];

interface FeedDate {
  iso: string;
  short: string;
  year: string;
  long: string;
}

type FeedLink = { kind: 'internal' | 'external'; href: string; label: string } | null;

/** Uma novidade pronta para o template (sem lógica no HTML). */
export interface FeedRow {
  id: string;
  headingId: string;
  title: string;
  paragraphs: string[];
  items: string[];
  isNew: boolean;
  date: FeedDate | null;
  link: FeedLink;
  mediaType: AnnouncementMediaType | null;
  mediaUrl: string | null;
  mediaWidth: number | null;
  mediaHeight: number | null;
  refresh: AnnouncementMediaRefresh;
}

/** Data `yyyy-MM-dd` (só a parte da data, lida como está, nunca convertida de fuso). */
export function feedDate(raw: string | null | undefined): FeedDate | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw ?? '');
  if (!match) return null;
  const [, year, mm, dd] = match;
  const month = Number(mm) - 1;
  const day = Number(dd);
  if (month < 0 || month > 11 || day < 1 || day > 31) return null;
  return {
    iso: `${year}-${mm}-${dd}`,
    short: `${day} ${MONTHS_SHORT[month]}`,
    year,
    long: `${day} de ${MONTHS_LONG[month]} de ${year}`,
  };
}

/**
 * Só rota do app (`/algo`, nunca `//host`) ou `https://`; qualquer outra coisa não vira botão.
 * `https://` do próprio app vira rota (mesma aba): outra aba não tem a sessão.
 */
function feedLink(url: string | null, label: string | null, currentHost: string | null): FeedLink {
  const text = (label ?? '').trim();
  if (!text) return null;
  const link = classifyAppLink(url, currentHost);
  if (!link) return null;
  return link.kind === 'internal'
    ? { kind: 'internal', href: link.path, label: text }
    : { kind: 'external', href: link.href, label: text };
}

/**
 * NOVIDADES — tudo o que já foi anunciado, do mais novo para o mais antigo (canvas
 * NovidadesPagina / NovidadesPaginaMobile / NovidadesMotoristaMobile / NovidadesEstados, 12/11).
 *
 * - Página de 10 em 10 com "Carregar mais"; sem total no servidor, só `hasMore`.
 * - "Nova" = a pessoa ainda não leu. A página NÃO marca como lida: quem marca é o popup
 *   (uma novidade por sessão), como decidido no canvas.
 * - Texto sempre simples (interpolação, nunca HTML); quebras de linha mantidas.
 * - Sessão de suporte: o servidor devolve página vazia, e a tela mostra o vazio.
 */
@Component({
  selector: 'app-news-feed-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DefaultPageLayout, StatusChip, AnnouncementMedia, NewsTabs],
  templateUrl: './news-feed-page.html',
})
export class NewsFeedPage {
  private readonly feed = inject(NewsFeedService);
  private readonly badge = inject(NewsUnreadBadgeStore);
  private readonly session = inject(SessionService);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private readonly currentHost = inject(DOCUMENT).defaultView?.location?.host ?? null;

  /** Novidades carregadas, com a página de onde vieram (para renovar a URL da mídia). */
  private readonly loaded = signal<{ item: AnnouncementFeedItem; page: number }[]>([]);
  private readonly nextPage = signal(0);
  protected readonly hasMore = signal(false);
  protected readonly loading = signal(true);
  protected readonly failed = signal(false);
  protected readonly loadingMore = signal(false);
  protected readonly moreFailed = signal(false);
  /** Descarta resposta de uma carga anterior (Tentar de novo no meio de outra). */
  private generation = 0;

  protected readonly isDriver = this.session.getCompanyRoleFromToken() === 'DRIVER';
  protected readonly skeletons = [true, false, false];
  protected readonly skeletonTitleWidths = ['78%', '64%', '70%'];

  protected readonly rows = computed<FeedRow[]>(() => {
    // Lida pelo popup com a página aberta: o "Nova" some junto com o chip do menu.
    const readNow = this.badge.readIds();
    return this.loaded().map(({ item, page }) => {
      const row = this.toRow(item, page);
      return readNow.has(item.id) ? { ...row, isNew: false } : row;
    });
  });
  protected readonly isEmpty = computed(
    () => !this.loading() && !this.failed() && this.rows().length === 0,
  );
  protected readonly isEnd = computed(
    () => !this.loading() && !this.failed() && this.rows().length > 0 && !this.hasMore(),
  );
  protected readonly firstPublished = computed(() => {
    const rows = this.rows();
    return rows.length ? (rows[rows.length - 1].date?.long ?? null) : null;
  });
  protected readonly shownCaption = computed(() => {
    const n = this.rows().length;
    return n === 1 ? 'Mostrando a mais recente' : `Mostrando as ${n} mais recentes`;
  });
  protected readonly lead = computed(() => {
    const base = 'O que mudou no MyCarsHub, do mais novo para o mais antigo.';
    const n = this.badge.unread();
    if (n <= 0) return base;
    return `${base} ${n === 1 ? '1 nova' : `${n} novas`} desde a sua última visita.`;
  });
  protected readonly emptyText = this.isDriver
    ? 'Quando o app ganhar algo novo para você, como um recibo ou um aviso da vistoria, aparece aqui primeiro.'
    : 'Quando o MyCarsHub ganhar uma função nova ou mudar alguma tela, o aviso aparece aqui primeiro.';

  constructor() {
    this.load();
  }

  /** Primeira página (e o "Tentar de novo" do erro). */
  protected load(): void {
    const gen = ++this.generation;
    this.loading.set(true);
    this.failed.set(false);
    this.moreFailed.set(false);
    this.feed
      .page(0)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          if (gen !== this.generation) return;
          this.loaded.set(res.content.map((item) => ({ item, page: 0 })));
          this.hasMore.set(res.hasMore);
          this.nextPage.set(1);
          this.loading.set(false);
        },
        error: () => {
          if (gen !== this.generation) return;
          this.loaded.set([]);
          this.hasMore.set(false);
          this.loading.set(false);
          this.failed.set(true);
        },
      });
  }

  protected loadMore(): void {
    if (this.loadingMore() || this.loading() || !this.hasMore()) return;
    const gen = this.generation;
    const page = this.nextPage();
    this.loadingMore.set(true);
    this.moreFailed.set(false);
    this.feed
      .page(page)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          if (gen !== this.generation) return;
          // Uma novidade publicada entre as duas páginas empurra a lista: não repete a mesma.
          const seen = new Set(this.loaded().map((l) => l.item.id));
          const fresh = res.content.filter((item) => !seen.has(item.id));
          this.loaded.update((list) => [...list, ...fresh.map((item) => ({ item, page }))]);
          this.hasMore.set(res.hasMore);
          this.nextPage.set(page + 1);
          this.loadingMore.set(false);
        },
        error: () => {
          if (gen !== this.generation) return;
          this.loadingMore.set(false);
          this.moreFailed.set(true);
        },
      });
  }

  /** Rota do app: navega sem recarregar (Ctrl/Cmd+clique segue o navegador). */
  protected openInternal(event: MouseEvent, href: string): void {
    if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    void this.router.navigateByUrl(href);
  }

  private toRow(item: AnnouncementFeedItem, page: number): FeedRow {
    const body = (item.body ?? '').trim();
    const hasMedia = !!item.mediaType && !!item.mediaUrl;
    return {
      id: item.id,
      headingId: `news-feed-${item.id}`,
      title: item.title,
      paragraphs: body ? body.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean) : [],
      items: (item.items ?? []).filter((s) => !!s && s.trim().length > 0),
      isNew: item.read === false,
      // `startsOn` é a data de negócio (sem fuso) e a chave da ordem da lista; `publishedAt` é
      // gravado em UTC e viraria o dia seguinte para quem publica depois das 21h em Brasília.
      date: feedDate(item.startsOn) ?? feedDate(item.publishedAt),
      link: feedLink(item.linkUrl, item.linkLabel, this.currentHost),
      mediaType: hasMedia ? (item.mediaType ?? null) : null,
      mediaUrl: hasMedia ? (item.mediaUrl ?? null) : null,
      mediaWidth: item.mediaWidth ?? null,
      mediaHeight: item.mediaHeight ?? null,
      // URL assinada vence (~1 h): pede a mesma página de novo e pega a desta novidade.
      refresh: () =>
        this.feed
          .page(page)
          .pipe(map((res) => res.content.find((a) => a.id === item.id)?.mediaUrl ?? null)),
    };
  }
}
