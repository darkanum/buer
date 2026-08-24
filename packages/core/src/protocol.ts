import { z } from 'zod';
export const PROTOCOL_VERSION = 1 as const;

export const IngestEnvelope = z.object({
  protocolVersion: z.literal(PROTOCOL_VERSION),
  cliVersion: z.string().min(1),
  takenAt: z.iso.datetime(),
  account: z.object({
    gameUid: z.string().min(1),
    region: z.enum(['os_usa', 'os_euro', 'os_asia', 'os_cht']),
    nickname: z.string().nullable().optional(),
    lang: z.string().refine((l) => l !== 'pt-br', 'use pt-pt, não pt-br'),
  }),
  raw: z.object({ list: z.unknown(), detail: z.unknown() }),
});
export type IngestEnvelope = z.infer<typeof IngestEnvelope>;
