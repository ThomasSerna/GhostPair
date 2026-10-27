import { expect, it } from 'vitest';
import { spanish, translator } from './messages';

it('keeps user text intact when translating dynamic labels', () => {
  const title = 'A < B {title} & Español';
  expect(translator('es')('Stop sharing {title}', { title })).toBe(`Dejar de compartir ${title}`);
  expect(translator('en')('Stop sharing {title}', { title })).toBe(`Stop sharing ${title}`);
  expect(translator('es')('At least {count} characters', { count: 8 })).toBe('Al menos 8 caracteres');
});

it('preserves required placeholders in both language catalogs', () => {
  const placeholders = (text: string) => [...text.matchAll(/\{\w+\}/g)].map(match => match[0]).sort();
  for (const [english, translation] of Object.entries(spanish)) expect(placeholders(translation), english).toEqual(placeholders(english));
});
