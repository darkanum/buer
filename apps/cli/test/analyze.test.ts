import { describe, it, expect } from 'vitest';
import { readFileSync, writeFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runAnalyze } from '../src/commands/analyze.js';
import { renderReport } from '../src/report.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(HERE, '..', '..', '..', 'packages', 'core', 'test', 'fixtures', 'real-account.scrubbed.json');
const GOLDEN = path.join(HERE, '__golden__', 'analyze-63.json');

/** Bloco de stats onde o HoYoLAB pode reportar um `property_type` (Task 4). */
const STAT_BLOCKS = ['base_properties', 'extra_properties', 'selected_properties', 'element_properties'];

/**
 * Copia a extração real e apaga o stat de Recarga de Energia (`property_type`
 * 23, o id que `@buer/core` mapeia para `enerRech_`) de UM personagem —
 * simula uma captura que não trouxe esse dado para essa build específica
 * (Task 9: `ObservedStatResolver` devolve o resto normalmente, só o ER falta).
 * Escreve num arquivo temporário e devolve o caminho; quem chama apaga.
 */
function fixtureWithoutEnergyRecharge(characterId: number): string {
  const raw = JSON.parse(readFileSync(FIXTURE, 'utf8')) as {
    detail: { list: { base: { id: number }; [block: string]: unknown }[] };
  };
  const entry = raw.detail.list.find((e) => e.base.id === characterId);
  if (!entry) throw new Error(`personagem ${characterId} não está no fixture`);
  for (const block of STAT_BLOCKS) {
    const list = entry[block];
    if (Array.isArray(list)) {
      entry[block] = list.filter((p: { property_type?: number }) => p.property_type !== 23);
    }
  }
  const dir = mkdtempSync(path.join(tmpdir(), 'buer-analyze-test-'));
  const file = path.join(dir, 'sem-er.json');
  writeFileSync(file, JSON.stringify(raw));
  return file;
}

describe('runAnalyze --character', () => {
  it('devolve times e veredito para xiangling', async () => {
    const result = await runAnalyze({ from: FIXTURE, character: 'xiangling' });
    expect(result.scope).toBe('character');
    expect(result.characters).toHaveLength(1);
    const entry = result.characters[0]!;
    expect(entry.slug).toBe('xiangling');
    expect(entry.playableTeams.length).toBeGreaterThan(0);
    expect(entry.playableTeams[0]!.findings.length).toBe(5);
  });

  // ---------------------------------------------------------------------
  // Achado 3 da revisão final: o relatório é texto para humano ler (spec
  // §11, §7.3) e saía com id numérico onde deveria haver nome.
  // ---------------------------------------------------------------------

  it('o relatório nomeia personagens, armas e conjuntos por slug — nunca por id numérico', async () => {
    const result = await runAnalyze({ from: FIXTURE, account: true });
    const text = renderReport(result);

    for (const entry of result.characters) {
      for (const team of [...entry.playableTeams, ...entry.blockedTeams]) {
        for (const member of team.members) {
          if (member !== null) expect(member, `membro de ${team.archetypeId}`).not.toMatch(/^\d+$/);
        }
        for (const energy of team.energy) expect(energy.of).not.toMatch(/^\d+$/);
      }
      for (const a of entry.acquisitions) expect(a.axis).not.toMatch(/:\d+$/);
    }

    // Nenhum id de arma ou de conjunto sobra dentro de um achado: estes SEMPRE
    // têm nome no catálogo, então um id ali é a falha original deste achado.
    for (const entry of result.characters) {
      for (const team of [...entry.playableTeams, ...entry.blockedTeams]) {
        for (const finding of team.findings) {
          expect(finding.summary, `achado ${finding.check}`).not.toMatch(/\b\d{5,}\b/);
        }
      }
    }

    // Na tela inteira, o único id tolerado é o de personagem que o catálogo do
    // gi-data ainda não conhece (patch novo): ali a chave crua é a verdade, e
    // inventar um nome seria o defeito oposto. O relatório já os identifica —
    // são exatamente aqueles cujo `slug` caiu de volta para o `key`.
    const unresolved = new Set(result.characters.filter((c) => c.slug === c.key).map((c) => c.key));
    for (const id of new Set(text.match(/\b1000\d{4}\b/g) ?? [])) {
      expect([...unresolved], `id ${id} na tela sem nenhum nome ao lado`).toContain(id);
    }
  });

  it('as linhas por slot (spec §7.3) chegam ao relatório', async () => {
    const result = await runAnalyze({ from: FIXTURE, character: 'xiangling' });
    const team = result.characters[0]!.playableTeams[0]!;
    expect(team.reasons.length).toBeGreaterThan(0);
    expect(team.reasons.join(' ')).toMatch(/Slot 1/);
    expect(renderReport(result)).toMatch(/Slot 1/);
  });

  it('personagem sem ficha devolve os FATOS e diz que não há veredito', async () => {
    const result = await runAnalyze({ from: FIXTURE, character: 'barbara' });
    const entry = result.characters[0]!;
    expect(entry.playableTeams).toHaveLength(0);
    expect(entry.note).toMatch(/sem ficha|sem time curado/i);
    expect(entry.observed.atk).toBeTypeOf('number');
  });

  it('--variant fixa a variante julgada', async () => {
    const result = await runAnalyze({ from: FIXTURE, character: 'xiangling', variant: 'vaporize' });
    const team = result.characters[0]!.playableTeams[0];
    if (team) expect(team.variantId).toBe('vaporize');
  });

  it('slug desconhecido falha com mensagem útil, não com stack', async () => {
    await expect(runAnalyze({ from: FIXTURE, character: 'nao-existe' })).rejects.toThrow(/nao-existe/);
  });
});

describe('renderReport', () => {
  it('nomeia a variante julgada e traz o why de todo achado bloqueante', async () => {
    const result = await runAnalyze({ from: FIXTURE, character: 'xiangling' });
    const text = renderReport(result);
    expect(text).toMatch(/variante/i);
    for (const entry of result.characters) {
      for (const team of entry.playableTeams) {
        for (const finding of team.findings) {
          if (finding.status === 'blocking') expect(finding.why ?? '').not.toBe('');
        }
      }
    }
  });
});

describe('degradação — ER não medido (spec §6.5, Task 9)', () => {
  it('ER não medido de um COLEGA de time some da lista de energia mas não da explicação', async () => {
    // Bennett (10000032) tem alvo hard de ER (180, ficha "buffer-er") e
    // ocupa o slot fixo de buffer no time National — o mesmo time em que
    // Xiangling joga. Apagar o ER dele simula uma captura que não trouxe
    // esse stat para essa build específica.
    const file = fixtureWithoutEnergyRecharge(10000032);
    try {
      const result = await runAnalyze({ from: file, character: 'xiangling' });
      const entry = result.characters[0]!;
      const national = entry.playableTeams.find((t) => t.archetypeId === 'national');
      expect(national).toBeDefined();

      // A lista `energy` nunca fabrica um zero: o slot do Bennett
      // simplesmente não aparece nela (Task 9).
      expect(national!.energy.some((e) => e.of === 'bennett')).toBe(false);

      // Mas o MOTIVO de ele não aparecer tem que sobreviver até a tela —
      // é exatamente o achado Important daquela revisão: sem isto, a
      // ausência ficava silenciosa (número some, motivo some com ele).
      // Ele viaja em `reasons`, junto das demais linhas por slot da spec §7.3.
      expect(national!.reasons.some((r) => /não pôde ser verificada/.test(r))).toBe(true);

      const text = renderReport(result);
      expect(text).toMatch(/não pôde ser verificada/);
      // E pelo NOME, não pelo id (Achado 3 da revisão final).
      expect(text).toMatch(/bennett/);
    } finally {
      rmSync(path.dirname(file), { recursive: true, force: true });
    }
  });
});

describe('golden file da conta inteira', () => {
  it('o relatório dos 63 personagens não mudou sem revisão', async () => {
    const result = await runAnalyze({ from: FIXTURE, account: true });
    const serialized = JSON.stringify(result, null, 2);

    if (process.env['UPDATE_GOLDEN'] === '1' || !existsSync(GOLDEN)) {
      writeFileSync(GOLDEN, serialized);
    }
    expect(serialized).toBe(readFileSync(GOLDEN, 'utf8'));
  });

  it('invariantes sobre os 63 reais (spec §12, camada 3)', async () => {
    const result = await runAnalyze({ from: FIXTURE, account: true });
    expect(result.characters).toHaveLength(63);

    for (const entry of result.characters) {
      // todo personagem ou tem time, ou tem um motivo explícito de não ter
      const hasTeams = entry.playableTeams.length + entry.blockedTeams.length > 0;
      expect(hasTeams || (entry.note ?? '') !== '').toBe(true);

      for (const team of [...entry.playableTeams, ...entry.blockedTeams]) {
        expect(team.variantId ?? '').not.toBe('');   // variante SEMPRE nomeada
        expect(team.explanation).not.toBe('');       // veredito SEMPRE explicado
        for (const finding of team.findings) {
          expect(finding.summary).not.toBe('');
          if (finding.status === 'blocking') expect(finding.why ?? '').not.toBe('');
        }
      }
    }
  });

  it('lacuna de cobertura (achado Important da revisão): a resposta computada chega à tela', async () => {
    // Nesta conta, 3 dos 5 arquétipos curados ficam "a um slot" de um papel
    // por ELEMENTO que nenhuma ficha ainda cobre (cryo main-dps, geo
    // sub-dps, pyro main-dps) — o CuratedRosterAdvisor já descreve isso em
    // `coverageGaps`, mas antes desta correção `analyze` descartava o
    // campo: a pergunta "o que adquirir" tinha resposta computada e saía
    // muda. Este teste falha se essa resposta voltar a se perder.
    const result = await runAnalyze({ from: FIXTURE, account: true });
    const withGaps = result.characters.filter((e) => e.coverageGaps.length > 0);
    expect(withGaps.length).toBeGreaterThan(0);

    for (const entry of withGaps) {
      for (const gap of entry.coverageGaps) {
        expect(gap.description).not.toBe('');
        expect(gap.blockedArchetypes.length).toBeGreaterThan(0);
        expect(['critical', 'notable', 'minor']).toContain(gap.severity);
      }
    }

    const text = renderReport(result);
    expect(text).toMatch(/lacuna sem candidato nomeado/);
  });
});
