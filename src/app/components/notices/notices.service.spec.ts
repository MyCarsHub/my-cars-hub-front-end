import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { Notice, NoticeOutcome, NoticesService } from './notices.service';

function notice(id: string, extra: Partial<Notice> = {}): Notice {
  return { id, type: 'REMINDER', title: id, message: 'm', ...extra };
}

describe('NoticesService', () => {
  let service: NoticesService;

  beforeEach(() => {
    TestBed.resetTestingModule();
    service = TestBed.inject(NoticesService);
  });

  it('shows one notice at a time, in arrival order', () => {
    service.enqueue(notice('a'));
    service.enqueue(notice('b', { type: 'NEWS' }));
    expect(service.current()?.id).toBe('a');
    expect(service.waiting()).toBe(1);
    service.dismiss('a');
    expect(service.current()?.id).toBe('b');
    expect(service.waiting()).toBe(0);
  });

  it('puts a blocking notice ahead of dismissible ones, but never over the one on screen', () => {
    service.enqueue(notice('a'));
    service.enqueue(notice('b'));
    service.enqueue(notice('c', { blocking: true }));
    expect(service.current()?.id).toBe('a');
    service.dismiss('a');
    expect(service.current()?.id).toBe('c');
    service.dismiss('c');
    expect(service.current()?.id).toBe('b');
  });

  it('emits the outcome once when the notice leaves the queue', () => {
    const seen: NoticeOutcome[] = [];
    service.enqueue(notice('a')).subscribe((o) => seen.push(o));
    service.resolve('a');
    expect(seen).toEqual(['resolved']);
    expect(service.current()).toBeNull();
  });

  it('reports dismissed when the user leaves without resolving', () => {
    const seen: NoticeOutcome[] = [];
    service.enqueue(notice('a')).subscribe((o) => seen.push(o));
    service.dismiss('a');
    expect(seen).toEqual(['dismissed']);
  });

  it('does not duplicate a notice with the same id and shares its outcome', () => {
    const seen: NoticeOutcome[] = [];
    service.enqueue(notice('a')).subscribe((o) => seen.push(o));
    service.enqueue(notice('a')).subscribe((o) => seen.push(o));
    expect(service.waiting()).toBe(0);
    service.resolve('a');
    expect(seen).toEqual(['resolved', 'resolved']);
  });

  it('ignores resolve/dismiss for an unknown id', () => {
    service.enqueue(notice('a'));
    service.resolve('zzz');
    expect(service.current()?.id).toBe('a');
  });

  it('discard tira da fila sem desfecho (só completa) e o próximo assume', () => {
    const seen: NoticeOutcome[] = [];
    let completed = false;
    service.enqueue(notice('a', { type: 'NEWS' })).subscribe({ next: (o) => seen.push(o), complete: () => (completed = true) });
    service.enqueue(notice('b'));
    service.discard('a');
    expect(seen).toEqual([]);
    expect(completed).toBe(true);
    expect(service.current()?.id).toBe('b');
  });
});
