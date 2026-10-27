import { expect, it } from 'vitest';
import { PasswordSchema, SettingsSchema } from '@ghostpair/protocol';
import { spanishRuntimeMessages, translateRuntimeMessage, validationMessage } from './runtime-messages';

it('translates canonical errors on presentation without altering the stored cause', () => {
  const error = new Error('The host ended the session.');
  expect(translateRuntimeMessage('es', error.message)).toBe('La persona que comparte finalizó la sesión.');
  expect(translateRuntimeMessage('en', error.message)).toBe(error.message);
  expect(error.message).toBe('The host ended the session.');
  for (const [message, spanish] of Object.entries(spanishRuntimeMessages)) {
    expect(spanish.trim()).not.toBe('');
    expect(translateRuntimeMessage('en', message)).toBe(message);
    expect(translateRuntimeMessage('es', message)).toBe(spanish);
  }
});

it('localizes dynamic errors and hides unknown browser diagnostics from user copy', () => {
  expect(translateRuntimeMessage('es', 'The connection server could not set up GhostPair (503). Check the connection settings and try again.')).toContain('(503)');
  expect(translateRuntimeMessage('es', 'Could not play the shared video: Decoder failure')).toBe('No se pudo reproducir el video compartido. Inténtalo de nuevo.');
  expect(translateRuntimeMessage('es', 'Page control could not be installed. Check site permissions in the extension menu. Cannot access tab')).toContain('Revisa los permisos');
  expect(translateRuntimeMessage('es', 'Unexpected browser error')).toBe('No se pudo completar la operación. Inténtalo de nuevo.');
  expect(translateRuntimeMessage('en', 'Demasiados mensajes.')).toBe('Too many messages.');
});

it('uses validation issue codes and fields instead of displaying Zod JSON', () => {
  const invalid = [
    [PasswordSchema.safeParse('short'), 'Use at least 8 characters.'],
    [PasswordSchema.safeParse('x'.repeat(257)), 'Use at most 256 characters.'],
    [SettingsSchema.safeParse({ signalingUrl: 'invalid', stunUrls: ['stun:example.com'] }), 'Enter a valid connection server URL.'],
    [SettingsSchema.safeParse({ signalingUrl: 'http://example.com', stunUrls: ['stun:example.com'] }), 'Use HTTPS for signaling, or HTTP on localhost.'],
    [SettingsSchema.safeParse({ signalingUrl: 'https://example.com', stunUrls: [] }), 'Add one to five STUN servers, each starting with stun: or stuns:.'],
  ] as const;
  for (const [parsed, expected] of invalid) {
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(validationMessage(parsed.error)).toBe(expected);
      expect(translateRuntimeMessage('es', validationMessage(parsed.error))).not.toBe(expected);
    }
  }
});
