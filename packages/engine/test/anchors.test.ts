import { describe, it, expect } from 'vitest';
import { loadMeta } from '@buer/meta';
import { resolveCharacter } from '@buer/meta';
import type { ArchetypeSlotData, TeamArchetypeData } from '@buer/meta';
import { loadCharacters } from '@buer/gi-data';
import { parseCharKey } from '@buer/core';
import type { CharacterKey, Element, StatKey } from '@buer/core';

const bank = loadMeta();
const profileOf = (slug: string) => bank.profiles.get(resolveCharacter(slug)!)!;
const allMainStats = (slug: string): StatKey[] =>
  profileOf(slug).variants.flatMap((v) => [...v.mainStats.sands, ...v.mainStats.goblet, ...v.mainStats.circlet]);

const CHARACTERS = loadCharacters();
const ELEMENTS: readonly Element[] = ['pyro', 'hydro', 'cryo', 'electro', 'anemo', 'geo', 'dendro'];

/** Elemento de QUALQUER personagem do catálogo. Traveler carrega o elemento na própria chave. */
function elementOf(key: CharacterKey): Element | undefined {
  const parsed = parseCharKey(key);
  if (parsed.element) return parsed.element;
  return CHARACTERS[parsed.avatarId]?.element as Element | undefined;
}

/**
 * Elementos que CONTRADIZEM o arquétipo — não "subótimos", contrários: pôr um
 * deles no time desliga a reação que define a composição. Autoria humana, na
 * mesma disciplina das outras âncoras.
 *
 * `mono-<elemento>` é derivado do próprio id: um time mono só admite o seu
 * elemento, por definição. O resto é tabela nomeada:
 *
 * - família bloom (`bloom`/`hyperbloom`/`burgeon`): GEO cristaliza a aura de
 *   hydro/dendro e suprime os núcleos — o time deixa de fazer o que se propõe.
 *   `hyperbloom` some ainda PYRO (converte os núcleos em burgeon, que é outro
 *   arquétipo) e CRYO (congela a aura de hydro e trava a floração).
 * - `freeze`: PYRO derrete a aura de cryo e desfaz o congelamento.
 * - `overload-chevreuse`: o passivo da Chevreuse só liga com o time inteiro
 *   pyro/electro — qualquer outro elemento apaga o buff que dá nome ao time.
 */
const ANTAGONISTIC_BY_ARCHETYPE: Readonly<Record<string, readonly Element[]>> = {
  bloom: ['geo'],
  hyperbloom: ['geo', 'pyro', 'cryo'],
  burgeon: ['geo'],
  freeze: ['pyro'],
  'overload-chevreuse': ['hydro', 'cryo', 'anemo', 'geo', 'dendro'],
};

function antagonisticElements(archetype: TeamArchetypeData): ReadonlySet<Element> {
  const mono = /^mono-([a-z]+)$/.exec(archetype.id);
  if (mono) return new Set(ELEMENTS.filter((e) => e !== mono[1]));
  return new Set(ANTAGONISTIC_BY_ARCHETYPE[archetype.id] ?? []);
}

/**
 * Que elementos este slot consegue ADMITIR. Espelha `candidatesFor`
 * (engine/team/matching.ts) de propósito, sem roster: slot de elemento admite
 * um só; slot fixo admite os elementos dos nomes; slot flex admite, ALÉM
 * disso, todo personagem com ficha que declare um dos papéis do slot — que é
 * exatamente por onde um elemento antagônico entra sem ninguém autorizar.
 */
function admissibleElements(slot: ArchetypeSlotData): ReadonlySet<Element> {
  if (slot.requires.kind === 'element') return new Set([slot.requires.element as Element]);

  const out = new Set<Element>();
  for (const named of slot.requires.anyOf) {
    const element = elementOf(named);
    if (element) out.add(element);
  }
  if (!slot.substitutable) return out;

  const wanted = new Set<string>(slot.role);
  for (const profile of bank.profiles.values()) {
    if (!profile.variants.some((v) => v.roles.some((r) => wanted.has(r)))) continue;
    const element = elementOf(profile.character);
    if (element) out.add(element);
  }
  return out;
}

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

  // -------------------------------------------------------------------------
  // Elemento antagônico: o slot que admite quem CONTRADIZ o arquétipo.
  // -------------------------------------------------------------------------

  it('nenhum slot de arquétipo admite personagem de elemento antagônico ao arquétipo', () => {
    for (const archetype of bank.archetypes) {
      const forbidden = antagonisticElements(archetype);
      if (forbidden.size === 0) continue;
      for (const [index, slot] of archetype.slots.entries()) {
        const admitted = [...admissibleElements(slot)].filter((e) => forbidden.has(e)).sort();
        expect(
          admitted,
          `${archetype.id}, slot ${index + 1} (${slot.role.join('/')}) admite elemento contrário ao arquétipo`,
        ).toEqual([]);
      }
    }
  });

  it('arquétipo da família bloom não admite geo em slot nenhum — cristalizar suprime os núcleos', () => {
    const bloomLike = bank.archetypes.filter((a) => /bloom|burgeon/.test(a.id));
    expect(bloomLike.length).toBeGreaterThan(0);
    for (const archetype of bloomLike) {
      for (const [index, slot] of archetype.slots.entries()) {
        expect([...admissibleElements(slot)], `${archetype.id}, slot ${index + 1}`).not.toContain('geo');
      }
    }
  });

  it('arquétipo mono-elemento não admite outro elemento, nem no slot flex', () => {
    const monos = bank.archetypes.filter((a) => a.id.startsWith('mono-'));
    expect(monos.length).toBeGreaterThan(0);
    for (const archetype of monos) {
      const own = archetype.id.slice('mono-'.length);
      for (const [index, slot] of archetype.slots.entries()) {
        expect([...admissibleElements(slot)].sort(), `${archetype.id}, slot ${index + 1}`).toEqual([own]);
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
