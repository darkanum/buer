import { describe, it, expect } from 'vitest';
import { buildArchetypeDrafts, buildArchetypePrompt, extractArchetypes, archetypeCompositionKey } from '../scripts/research/archetype.js';
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

  // ---------------------------------------------------------------------------
  // Proveniência: o rascunho se declara MÁQUINA, e a confiança sai de quantas
  // fontes independentes citaram a composição — nunca de quão bom o time é.
  // ---------------------------------------------------------------------------

  it('o rascunho nasce authoredBy "researched" — nunca indistinguível de curadoria humana', () => {
    const claims = { ...base, teams: [time('t', ['xingqiu', 'bennett'])] };
    const d = buildArchetypeDrafts({ claims, ...base });
    expect(d.archetypes[0]!.provenance.authoredBy).toBe('researched');
  });

  it('UMA fonte citando a composição → confiança low', () => {
    const claims = { ...base, teams: [time('t', ['xingqiu', 'bennett'], { citedBy: ['icy-veins'] })] };
    const d = buildArchetypeDrafts({ claims, ...base });
    expect(d.archetypes[0]!.provenance.confidence).toBe('low');
  });

  it('DUAS fontes citando a mesma composição → confiança medium', () => {
    const claims = {
      ...base,
      teams: [
        time('t', ['xingqiu', 'bennett'], { citedBy: ['icy-veins'] }),
        time('t-alt', ['bennett', 'xingqiu'], { citedBy: ['game8'] }),
      ],
    };
    const d = buildArchetypeDrafts({ claims, ...base });
    expect(d.archetypes).toHaveLength(1);
    expect(d.archetypes[0]!.provenance.confidence).toBe('medium');
  });

  it('NUNCA "high", nem com as três fontes citando — high exige revisão humana', () => {
    const claims = {
      ...base,
      teams: [
        time('t', ['xingqiu', 'bennett'], { citedBy: ['icy-veins', 'game8', 'genshin-builds'] }),
      ],
    };
    const d = buildArchetypeDrafts({ claims, ...base });
    expect(d.archetypes[0]!.provenance.confidence).not.toBe('high');
    // ... e `validateMeta` recusaria a combinação se algum dia saísse.
    expect(
      validateMeta({
        profiles: [],
        archetypes: [{
          ...d.archetypes[0]!,
          provenance: { authoredBy: 'researched', confidence: 'high' },
        }],
      }).join(' '),
    ).toMatch(/"high" é proibido/);
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

describe('extractArchetypes — membro que não resolve derruba o TIME inteiro (achado Critical)', () => {
  it('"Childe" não resolve, e o time some inteiro — não vira um trio que ninguém descreveu', async () => {
    const client = {
      async parse() {
        return {
          parsed_output: {
            teams: [
              {
                name: 'Freeze',
                members: [
                  { slug: 'Childe', role: ['sub-dps'] },
                  { slug: 'kaeya', role: ['sub-dps'] },
                  { slug: 'xingqiu', role: ['enabler'] },
                ],
                citedBy: ['icy-veins'],
              },
              {
                name: 'National',
                members: [
                  { slug: 'xiangling', role: ['sub-dps'] },
                  { slug: 'bennett', role: ['buffer'] },
                  { slug: 'xingqiu', role: ['sub-dps'] },
                ],
                citedBy: ['game8'],
              },
            ],
          },
        };
      },
    };

    const { claims, refused } = await extractArchetypes('xingqiu', 'texto da pesquisa', { client });

    // O time do "Childe" some por inteiro — não vira um trio válido sem ele.
    expect(claims.teams.map((t) => t.label)).toEqual(['National']);
    expect(claims.teams[0]!.members.map((m) => m.slug)).toEqual(['xiangling', 'bennett', 'xingqiu']);

    // ... e a recusa nomeia quem faltou.
    expect(refused).toHaveLength(1);
    expect(refused[0]!.id).toBe('freeze');
    expect(refused[0]!.because.join(' ')).toMatch(/Childe/);
  });

  it('nome que não resolve é reportado via onUnresolved, mesmo derrubando o time', async () => {
    const client = {
      async parse() {
        return {
          parsed_output: {
            teams: [{
              name: 'Freeze',
              members: [
                { slug: 'Childe', role: ['sub-dps'] },
                { slug: 'kaeya', role: ['sub-dps'] },
              ],
              citedBy: ['icy-veins'],
            }],
          },
        };
      },
    };

    const reports: { source: string; names: readonly string[] }[] = [];
    await extractArchetypes('xingqiu', 'texto', {
      client,
      onUnresolved: (source, names) => reports.push({ source, names }),
    });

    expect(reports).toEqual([{ source: 'icy-veins', names: ['Childe'] }]);
  });
});

describe('archetypeCompositionKey — recusa opinar sobre arquétipo curado ambíguo', () => {
  const raw = readRawMeta();
  const byId = (id: string) => raw.archetypes.find((a) => a.id === id)!;

  it('slot flex (kind: element) → null, nunca uma chave inventada', () => {
    const freeze = byId('freeze'); // tem slots kind: 'element'
    expect(freeze.slots.some((s) => s.requires.kind === 'element')).toBe(true);
    expect(archetypeCompositionKey(freeze)).toBeNull();
  });

  it('slot character com MÚLTIPLAS alternativas (mono-geo.json) → null', () => {
    const monoGeo = byId('mono-geo'); // último slot: anyOf de 4 nomes (OR, não 4 membros)
    const multiSlot = monoGeo.slots.find((s) => s.requires.kind === 'character' && s.requires.anyOf.length > 1);
    expect(multiSlot).toBeDefined();
    expect(archetypeCompositionKey(monoGeo)).toBeNull();
  });

  it('composição de slots nomeados de um membro só — a chave bate independente da ordem', () => {
    const nationalLike = {
      ...byId('national'),
      slots: [
        { role: ['sub-dps'], requires: { kind: 'character' as const, anyOf: ['xiangling'] }, substitutable: false },
        { role: ['buffer'], requires: { kind: 'character' as const, anyOf: ['bennett'] }, substitutable: false },
        { role: ['sub-dps'], requires: { kind: 'character' as const, anyOf: ['xingqiu'] }, substitutable: false },
      ],
    };
    const reordered = { ...nationalLike, slots: [...nationalLike.slots].reverse() };
    expect(archetypeCompositionKey(nationalLike)).not.toBeNull();
    expect(archetypeCompositionKey(reordered)).toBe(archetypeCompositionKey(nationalLike));
  });
});
