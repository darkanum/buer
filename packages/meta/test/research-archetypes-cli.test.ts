import { describe, it, expect } from 'vitest';
import { runArchetypeBatch } from '../scripts/research-archetypes.js';
import type { ArchetypeClaims } from '../scripts/research/archetype.js';
import { readRawMeta } from '../src/load.js';

const raw = readRawMeta();
const usage = { inputTokens: 10, outputTokens: 10 };

/**
 * Xiangling e Bennett "redescobrem" o mesmo National — mesma composição,
 * ids e fontes diferentes, exatamente como duas pesquisas independentes
 * fariam ao pesquisar cada personagem do próprio time.
 */
function nationalClaimsFor(subject: string, source: 'icy-veins' | 'game8'): ArchetypeClaims {
  return {
    subject,
    sources: [`https://${source}.example/${subject}`],
    teams: [{
      id: `national-${subject}`,
      label: 'National',
      members: [
        { slug: 'xiangling', role: ['sub-dps'] },
        { slug: 'bennett', role: ['buffer'] },
        { slug: 'xingqiu', role: ['sub-dps'] },
      ],
      strength: 'meta',
      citedBy: [source],
    }],
  };
}

describe('runArchetypeBatch — composição repetida ENTRE alvos (achado Important #3)', () => {
  it('o segundo alvo que redescobre a mesma composição não falha o lote nem duplica', async () => {
    const progress: string[] = [];
    const written: string[] = [];

    const report = await runArchetypeBatch({
      targets: ['xiangling', 'bennett'],
      gameVersion: '7.0',
      existing: { profiles: raw.profiles, archetypes: [] },
      research: async () => ({ text: 'pesquisa', urls: ['https://icy-veins.com/x'], usage }),
      extract: async (subject) => ({
        claims: nationalClaimsFor(subject, subject === 'xiangling' ? 'icy-veins' : 'game8'),
        refused: [],
        usage,
      }),
      write: (archetype) => { written.push(archetype.id); },
      onProgress: (line) => progress.push(line),
    });

    // Antes da correção, o segundo alvo batia em "id duplicado" no
    // validateMeta e derrubava TODO o grupo de arquétipos daquele alvo.
    expect(report.failed).toEqual([]);

    // Só o primeiro alvo grava — o segundo reconhece a MESMA composição e
    // não regrava outro arquivo para ela.
    expect(written).toEqual(['national-xiangling']);
    expect(report.written).toEqual(['national-xiangling']);

    // ... e isso é visível no relatório, não silencioso.
    expect(progress.some((l) => l.includes('já conhecido'))).toBe(true);
  });

  it('composição já existente no banco (de um lote anterior) também é reconhecida, não só a do mesmo lote', async () => {
    const existingArchetype = {
      schemaVersion: 1 as const,
      id: 'national',
      label: 'National',
      gameVersionAdded: '1.0',
      strength: 'meta',
      tags: [],
      sources: [],
      slots: [
        { role: ['sub-dps'], requires: { kind: 'character' as const, anyOf: ['xiangling'] }, substitutable: false },
        { role: ['buffer'], requires: { kind: 'character' as const, anyOf: ['bennett'] }, substitutable: false },
        { role: ['sub-dps'], requires: { kind: 'character' as const, anyOf: ['xingqiu'] }, substitutable: false },
      ],
    };

    const written: string[] = [];
    const progress: string[] = [];

    const report = await runArchetypeBatch({
      targets: ['xiangling'],
      gameVersion: '7.0',
      existing: { profiles: raw.profiles, archetypes: [existingArchetype] },
      research: async () => ({ text: 'pesquisa', urls: [], usage }),
      extract: async (subject) => ({
        claims: nationalClaimsFor(subject, 'icy-veins'),
        refused: [],
        usage,
      }),
      write: (archetype) => { written.push(archetype.id); },
      onProgress: (line) => progress.push(line),
    });

    expect(report.failed).toEqual([]);
    expect(written).toEqual([]);
    expect(report.written).toEqual([]);
    expect(progress.some((l) => l.includes('já conhecido'))).toBe(true);
  });
});
