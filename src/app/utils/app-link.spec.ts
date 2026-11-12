import { describe, expect, it } from 'vitest';
import { classifyAppLink, toStoredAppLink } from './app-link';

describe('classifyAppLink', () => {
  const cases: [string, string | null, ReturnType<typeof classifyAppLink>][] = [
    ['/ajustes', null, { kind: 'internal', path: '/ajustes' }],
    ['https://www.mycarshub.app.br/ajustes', null, { kind: 'internal', path: '/ajustes' }],
    ['https://mycarshub.app.br/ajustes', null, { kind: 'internal', path: '/ajustes' }],
    ['HTTPS://WWW.MYCARSHUB.APP.BR/ajustes', null, { kind: 'internal', path: '/ajustes' }],
    ['https://mycarshub.app.br/gastos?mes=11#topo', null, { kind: 'internal', path: '/gastos?mes=11#topo' }],
    ['https://mycarshub.app.br', null, { kind: 'internal', path: '/' }],
    ['https://staging.example.test/ajustes', 'staging.example.test', { kind: 'internal', path: '/ajustes' }],
    ['https://www.gov.br/denatran', null, { kind: 'external', href: 'https://www.gov.br/denatran' }],
    ['https://mycarshub.app.br.evil.com/x', null, { kind: 'external', href: 'https://mycarshub.app.br.evil.com/x' }],
    ['https://www.mycarshub.app.br//evil.com', null, null],
    ['//evil.com', null, null],
    ['/\\evil.com', null, null],
    ['javascript:alert(1)', null, null],
    ['http://www.mycarshub.app.br/ajustes', null, null],
    ['http://x.com', null, null],
    ['https://', null, null],
    ['', null, null],
  ];

  it.each(cases)('%s (aba em %s)', (raw, host, expected) => {
    expect(classifyAppLink(raw, host)).toEqual(expected);
  });

  it('null/undefined is no link', () => {
    expect(classifyAppLink(null)).toBeNull();
    expect(classifyAppLink(undefined)).toBeNull();
  });
});

describe('toStoredAppLink', () => {
  it('own-host absolute URL is stored as the route; anything else is kept as typed', () => {
    expect(toStoredAppLink('https://www.mycarshub.app.br/ajustes')).toBe('/ajustes');
    expect(toStoredAppLink('https://mycarshub.app.br/a?b=1#c')).toBe('/a?b=1#c');
    expect(toStoredAppLink('https://www.gov.br/x')).toBe('https://www.gov.br/x');
    expect(toStoredAppLink('/gastos')).toBe('/gastos');
    expect(toStoredAppLink('javascript:alert(1)')).toBe('javascript:alert(1)');
  });
});
