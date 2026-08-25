import { describe, it, expect } from 'vitest';
import { buildDraft } from '../scripts/research/write.js';
import type { CharacterClaims, ReconcileResult } from '../scripts/research/claims.js';

const claims: CharacterClaims = {
  character: 'xiangling',
  claims: [
    { source: 'icy-veins', url: 'https://icy-veins.com/x', erWhy: 'o Pyronado custa 80 de energia' },
    { source: 'game8', url: 'https://game8.co/x', erWhy: 'razão da segunda fonte' },
  ],
};

const full: ReconcileResult = {
  agreed: {
    sets: ['emblem-of-severed-fate'],
    mainStats: { sands: ['enerRech_'], goblet: ['pyro_dmg_'], circlet: ['critRate_'] },
    substats: ['critRate_', 'critDMG_'],
    weapons: ['the-catch'],
    erThreshold: 200,
    roles: ['sub-dps'],
    scalesOn: 'atk',
  },
  divergences: [],
  confidence: 'medium',
  sources: ['https://icy-veins.com/x', 'https://game8.co/x'],
};

const base = { character: 'xiangling', claims, gameVersion: '7.0', authoredAt: '2026-08-25' };

describe('buildDraft', () => {
  it('monta a ficha com authoredBy researched e a confiança da reconciliação', () => {
    const d = buildDraft({ ...base, reconciled: full });
    expect(d.profile!.provenance.authoredBy).toBe('researched');
    expect(d.profile!.provenance.confidence).toBe('medium');
    expect(d.profile!.provenance.sources).toEqual(full.sources);
    expect(d.profile!.provenance.authoredAt).toBe('2026-08-25');
  });

  it('NUNCA produz confidence high — isso exige humano', () => {
    const d = buildDraft({ ...base, reconciled: { ...full, confidence: 'medium' } });
    expect(d.profile!.provenance.confidence).not.toBe('high');
  });

  it('o alvo de ER carrega o why da fonte de MAIOR preferência que tiver um', () => {
    const d = buildDraft({ ...base, reconciled: full });
    const target = d.profile!.variants[0]!.targets.find((t) => t.kind === 'min')!;
    expect(target.value).toBe(200);
    expect(target.why).toContain('Pyronado'); // icy-veins vence game8
  });

  it('sem erThreshold, a variante sai sem alvo — não inventa um', () => {
    const semEr = { ...full, agreed: { ...full.agreed, erThreshold: undefined } };
    const d = buildDraft({ ...base, reconciled: semEr });
    expect(d.profile!.variants[0]!.targets).toEqual([]);
  });

  it('com erThreshold mas sem why em fonte nenhuma, RECUSA o alvo em vez de gerar prosa', () => {
    const semWhy: CharacterClaims = { character: 'xiangling', claims: [{ source: 'game8', url: 'u' }] };
    const d = buildDraft({ ...base, claims: semWhy, reconciled: full });
    expect(d.profile!.variants[0]!.targets).toEqual([]);
    expect(d.notes).toMatch(/sem justificativa/i);
  });

  it('divergências vão para notes, nomeando o campo e as fontes', () => {
    const comDiv: ReconcileResult = {
      ...full,
      confidence: 'low',
      divergences: [{ field: 'sets', kind: 'alternatives', bySource: { 'icy-veins': '["a"]', game8: '["b"]' } }],
    };
    const d = buildDraft({ ...base, reconciled: comDiv });
    expect(d.notes).toContain('sets');
    expect(d.notes).toContain('icy-veins');
    expect(d.profile!.variants[0]!.notes).toContain('sets');
  });

  it('RECUSA quando falta conjunto — ficha sem set quebra os casos-âncora', () => {
    const semSets = { ...full, agreed: { ...full.agreed, sets: undefined } };
    const d = buildDraft({ ...base, reconciled: semSets });
    expect(d.profile).toBeNull();
    expect(d.refusedBecause.join(' ')).toMatch(/conjunto/i);
  });

  it('RECUSA quando falta papel', () => {
    const semRoles = { ...full, agreed: { ...full.agreed, roles: undefined } };
    const d = buildDraft({ ...base, reconciled: semRoles });
    expect(d.profile).toBeNull();
    expect(d.refusedBecause.join(' ')).toMatch(/papel/i);
  });

  it('RECUSA quando falta scalesOn', () => {
    const sem = { ...full, agreed: { ...full.agreed, scalesOn: undefined } };
    expect(buildDraft({ ...base, reconciled: sem }).profile).toBeNull();
  });

  it('RECUSA quando nenhum slot de main-stat resolveu', () => {
    const sem = { ...full, agreed: { ...full.agreed, mainStats: undefined } };
    expect(buildDraft({ ...base, reconciled: sem }).profile).toBeNull();
  });

  it('a ficha montada passa no validateMeta do próprio pacote', async () => {
    const { validateMeta } = await import('../src/validate.js');
    const d = buildDraft({ ...base, reconciled: full });
    expect(validateMeta({ profiles: [d.profile!], archetypes: [] })).toEqual([]);
  });
});
