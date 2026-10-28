import { ClientSignalMessageSchema, PasswordSchema } from '@ghostpair/protocol';

// Protocol 4 openings omit the protocol/salt fields and send the human password.
export const LegacyOpeningSchema = ClientSignalMessageSchema.options[0]
  .omit({ protocol: true, salt: true }).extend({ password: PasswordSchema })
  .or(ClientSignalMessageSchema.options[2].omit({ protocol: true }).extend({ password: PasswordSchema }));
export type LegacyOpening = ReturnType<typeof LegacyOpeningSchema.parse>;
