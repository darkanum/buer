import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { loadMeta } from '@buer/meta';
import { rosterFromHoyolab } from '../src/roster/from-hoyolab.js';
import { matchArchetype } from '../src/team/matching.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const raw = JSON.parse(
  readFileSync(path.join(HERE, '..', '..', 'core', 'test', 'fixtures', 'real-account.scrubbed.json'), 'utf8'),
);
const roster = rosterFromHoyolab(raw, { capturedAt: '2026-08-24T00:00:00.000Z', lang: 'pt-br' });
const bank = loadMeta();

describe('cobertura da primeira leva curada', () => {
  it('tem ao menos 10 fichas e 5 arquétipos', () => {
    expect(bank.profiles.size).toBeGreaterThanOrEqual(10);
    expect(bank.archetypes.length).toBeGreaterThanOrEqual(5);
  });

  it('todo arquétipo do banco é jogável OU bloqueado-por-um na conta de calibração', () => {
    // Se um arquétipo sai "too-far" na conta que tem 63 personagens, quase
    // sempre é slot autorado errado (papel que ninguém declara, ou minCons
    // alto demais), não escassez de roster.
    //
    // A exceção é NOMEADA, nunca genérica — a lista abaixo é curta de
    // propósito: qualquer arquétipo NOVO caindo em "too-far" continua
    // derrubando este teste.
    //
    // `mono-geo`: os dois únicos personagens geo com ficha no banco (noelle,
    // gorou) estão fixados nos slots 1 e 2, então os slots 3 (geo sub-dps,
    // flex — flex exige ficha) e 4 (geo buffer/shielder, nomeado — a conta
    // não tem nenhum dos nomes) não têm de onde sair. É lacuna de COBERTURA
    // DO BANCO (spec §14.2), não slot autorado errado: o time de fato não é
    // formável, e dizer que ele está "a um slot" seria a mentira. Sai da
    // lista assim que o banco ganhar uma ficha geo de sub-dps.
    const KNOWN_BANK_GAPS = ['mono-geo'];

    const tooFar = bank.archetypes
      .map((a) => ({ id: a.id, status: matchArchetype(a, roster, bank).status }))
      .filter((x) => x.status === 'too-far');
    expect(tooFar.map((x) => x.id).sort()).toEqual(KNOWN_BANK_GAPS);
  });

  it('todo slot flex do banco casa com pelo menos um personagem com ficha', () => {
    const orphans: string[] = [];
    for (const archetype of bank.archetypes) {
      for (const [index, slot] of archetype.slots.entries()) {
        if (!slot.substitutable) continue;
        const roles = new Set<string>(
          slot.requires.kind === 'element' && slot.requires.withRole.length > 0
            ? slot.requires.withRole
            : slot.role,
        );
        const anyone = [...bank.profiles.values()].some((p) =>
          p.variants.some((v) => v.roles.some((r) => roles.has(r))),
        );
        if (!anyone) orphans.push(`${archetype.id} slot ${index + 1}`);
      }
    }
    expect(orphans).toEqual([]);
  });

  it('nenhuma ficha alega confidence high sem fonte', () => {
    const liars = [...bank.profiles.values()]
      .filter((p) => p.provenance.confidence === 'high' && p.provenance.sources.length === 0)
      .map((p) => String(p.character));
    expect(liars).toEqual([]);
  });
});
