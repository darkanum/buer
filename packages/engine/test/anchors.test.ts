import { describe, it, expect } from 'vitest';
import { loadMeta } from '@buer/meta';
import { resolveCharacter } from '@buer/meta';
import type { CharacterKey, StatKey } from '@buer/core';

const bank = loadMeta();
const profileOf = (slug: string) => bank.profiles.get(resolveCharacter(slug)!)!;
const allMainStats = (slug: string): StatKey[] =>
  profileOf(slug).variants.flatMap((v) => [...v.mainStats.sands, ...v.mainStats.goblet, ...v.mainStats.circlet]);

/**
 * Casos-âncora: afirmações escritas à mão do que o sistema NUNCA pode dizer.
 * Não provam que um veredito está certo — provam que erros que sabemos
 * reconhecer não passam. Falsificação, não verificação (spec §12).
 *
 * REGRA DE MANUTENÇÃO: toda ficha nova entra aqui com pelo menos uma âncora
 * sobre o que ela NÃO pode recomendar. É o preço de admitir uma ficha no banco.
 */
describe('casos-âncora do banco curado', () => {
  it('personagem que escala com DEF nunca recebe main-stat de ATQ%', () => {
    for (const slug of ['noelle', 'gorou']) {
      const defScaling = profileOf(slug).variants.filter((v) => v.scalesOn === 'def');
      expect(defScaling.length).toBeGreaterThan(0);
      for (const variant of defScaling) {
        expect([...variant.mainStats.sands, ...variant.mainStats.goblet]).not.toContain('atk_');
      }
    }
  });

  it('personagem que escala com HP nunca prioriza ATQ% em substats', () => {
    for (const variant of profileOf('chevreuse').variants.filter((v) => v.scalesOn === 'hp')) {
      expect(variant.substats.indexOf('atk_' as StatKey)).toBe(-1);
    }
  });

  it('Sucrose, que escala com maestria, tem maestria como main-stat', () => {
    expect(allMainStats('sucrose')).toContain('eleMas');
  });

  it('todo alvo hard de ER está entre 100 e 300 — fora disso é erro de autoria', () => {
    for (const profile of bank.profiles.values()) {
      for (const variant of profile.variants) {
        for (const target of variant.targets) {
          if (target.kind !== 'min' || target.stat !== 'enerRech_') continue;
          expect(target.value).toBeGreaterThanOrEqual(100);
          expect(target.value).toBeLessThanOrEqual(300);
        }
      }
    }
  });

  it('todo why explica o número, não repete o nome do stat', () => {
    for (const profile of bank.profiles.values()) {
      for (const variant of profile.variants) {
        for (const target of variant.targets) {
          expect(target.why.length).toBeGreaterThan(30);
        }
      }
    }
  });

  it('nenhuma variante lista o mesmo set em duas opções de rank diferente', () => {
    for (const profile of bank.profiles.values()) {
      for (const variant of profile.variants) {
        const fourPc = variant.sets.filter((s) => s.kind === '4pc').map((s) => s.sets[0]);
        expect(new Set(fourPc).size).toBe(fourPc.length);
      }
    }
  });

  it('toda variante declara ao menos um papel e ao menos uma opção de set', () => {
    for (const profile of bank.profiles.values()) {
      for (const variant of profile.variants) {
        expect(variant.roles.length).toBeGreaterThan(0);
        expect(variant.sets.length).toBeGreaterThan(0);
      }
    }
  });

  it('todo arquétipo meta tem ao menos um slot flex — senão não serve a rosters diferentes', () => {
    for (const archetype of bank.archetypes.filter((a) => a.strength === 'meta')) {
      expect(archetype.slots.some((s) => s.substitutable)).toBe(true);
    }
  });

  it('nenhum arquétipo exige constelação acima de 6 nem refino acima de 5', () => {
    for (const archetype of bank.archetypes) {
      for (const slot of archetype.slots) {
        if (slot.minConstellation !== undefined) expect(slot.minConstellation).toBeLessThanOrEqual(6);
        if (slot.minRefinement !== undefined) expect(slot.minRefinement).toBeLessThanOrEqual(5);
      }
    }
  });

  it('toda ficha declara data de autoria e patch de validade', () => {
    for (const profile of bank.profiles.values()) {
      expect(profile.provenance.authoredAt).toMatch(/^\d{4}-\d{2}-\d{2}/);
      expect(profile.provenance.validatedForVersion).toMatch(/^\d+\.\d+$/);
    }
  });
});
