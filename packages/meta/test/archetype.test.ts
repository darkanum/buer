import { describe, it, expect } from 'vitest';
import { buildArchetypeDrafts, buildArchetypePrompt } from '../scripts/research/archetype.js';
import { validateMeta } from '../src/validate.js';
import { readRawMeta } from '../src/load.js';

const base = { subject: 'xingqiu', gameVersion: '7.0', sources: ['https://icy-veins.com/t', 'https://game8.co/t'] };

const time = (id: string, membros: string[], over: Record<string, unknown> = {}) => ({
  id,
  label: id,
  members: membros.map((slug) => ({ slug, role: ['sub-dps'] })),
  citedBy: ['icy-veins'] as const,
  ...over,
});

describe('buildArchetypePrompt', () => {
  it('pede VÁRIOS times, não o melhor', () => {
    const p = buildArchetypePrompt('xingqiu');
    expect(p).toContain('xingqiu');
    expect(p).toMatch(/todos os times|vários times|cada time/i);
    expect(p).not.toMatch(/o melhor time apenas|somente o melhor/i);
  });

  it('exige o papel de cada membro e proíbe deduzir', () => {
    const p = buildArchetypePrompt('xingqiu');
    expect(p).toMatch(/papel/i);
    expect(p).toMatch(/não invente|omita/i);
  });
});

describe('buildArchetypeDrafts — vários times, nada descartado', () => {
  it('duas composições diferentes viram DOIS arquétipos', () => {
    const claims = { ...base, teams: [time('national', ['xiangling', 'bennett', 'xingqiu']), time('freeze', ['xingqiu', 'kaeya', 'sucrose'])] };
    const d = buildArchetypeDrafts({ claims, ...base });
    expect(d.archetypes.map((a) => a.id)).toEqual(['national', 'freeze']);
  });

  it('fontes diferentes descrevendo a MESMA composição viram um arquétipo só', () => {
    const claims = {
      ...base,
      teams: [
        time('national', ['xiangling', 'bennett', 'xingqiu'], { citedBy: ['icy-veins'] }),
        time('national-alt', ['bennett', 'xingqiu', 'xiangling'], { citedBy: ['game8'] }),
      ],
    };
    const d = buildArchetypeDrafts({ claims, ...base });
    expect(d.archetypes).toHaveLength(1);
  });

  it('monta slots NOMEADOS, nunca flex', () => {
    const claims = { ...base, teams: [time('national', ['xiangling', 'bennett', 'xingqiu'])] };
    const d = buildArchetypeDrafts({ claims, ...base });
    for (const slot of d.archetypes[0]!.slots) {
      expect(slot.substitutable).toBe(false);
      expect(slot.requires.kind).toBe('character');
    }
  });

  it('strength discordante fica na MAIS CONSERVADORA — superestimar é pior', () => {
    const claims = {
      ...base,
      teams: [
        time('t', ['xingqiu', 'b'], { strength: 'meta', citedBy: ['icy-veins'] }),
        time('t2', ['xingqiu', 'b'], { strength: 'niche', citedBy: ['game8'] }),
      ],
    };
    const d = buildArchetypeDrafts({ claims, ...base });
    expect(d.archetypes[0]!.strength).toBe('niche');
  });

  it('strength fora do vocabulário vira niche em vez de lançar', () => {
    const claims = { ...base, teams: [time('t', ['xingqiu', 'b'], { strength: 'S-tier' })] };
    expect(buildArchetypeDrafts({ claims, ...base }).archetypes[0]!.strength).toBe('niche');
  });

  it('RECUSA time com menos de 2 ou mais de 4 membros, sem derrubar os outros', () => {
    const claims = {
      ...base,
      teams: [
        time('solo', ['xingqiu']),
        time('ok', ['xingqiu', 'b', 'c']),
        time('cinco', ['xingqiu', 'b', 'c', 'd', 'e']),
      ],
    };
    const d = buildArchetypeDrafts({ claims, ...base });
    expect(d.archetypes.map((a) => a.id)).toEqual(['ok']);
    expect(d.refused.map((r) => r.id).sort()).toEqual(['cinco', 'solo']);
  });

  it('RECUSA time em que algum membro voltou sem papel', () => {
    const claims = { ...base, teams: [{ ...time('t', ['xingqiu', 'b']), members: [{ slug: 'xingqiu', role: [] }, { slug: 'b', role: ['sub-dps'] }] }] };
    const d = buildArchetypeDrafts({ claims, ...base });
    expect(d.archetypes).toEqual([]);
    expect(d.refused[0]!.because.join(' ')).toMatch(/papel/i);
  });

  it('o time exigido não pode faltar o personagem pesquisado', () => {
    const claims = { ...base, teams: [time('sem-o-sujeito', ['a', 'b', 'c'])] };
    const d = buildArchetypeDrafts({ claims, ...base });
    expect(d.refused[0]!.because.join(' ')).toMatch(/xingqiu/);
  });

  it('cada arquétipo cita só as fontes que o descreveram', () => {
    const claims = {
      ...base,
      teams: [
        time('a', ['xingqiu', 'b'], { citedBy: ['icy-veins'] }),
        time('c', ['xingqiu', 'd'], { citedBy: ['game8', 'genshin-builds'] }),
      ],
    };
    const d = buildArchetypeDrafts({ claims, ...base });
    expect(d.archetypes[0]!.tags).toContain('citado-por:icy-veins');
    expect(d.archetypes[1]!.tags).toContain('citado-por:game8');
  });

  it('o arquétipo montado passa no validateMeta, dadas as fichas dos membros', () => {
    const raw = readRawMeta();
    const claims = {
      subject: 'xingqiu',
      sources: base.sources,
      teams: [{
        id: 'national-pesquisado', label: 'National',
        members: [
          { slug: 'xiangling', role: ['sub-dps'] },
          { slug: 'bennett', role: ['buffer'] },
          { slug: 'xingqiu', role: ['sub-dps'] },
        ],
        strength: 'meta', citedBy: ['icy-veins'] as const,
      }],
    };
    const d = buildArchetypeDrafts({ claims, ...base });
    expect(validateMeta({ profiles: raw.profiles, archetypes: d.archetypes })).toEqual([]);
  });
});
