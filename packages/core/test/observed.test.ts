import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { extractObservedStats } from '../src/observed.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const raw = JSON.parse(
  readFileSync(path.join(HERE, 'fixtures', 'real-account.scrubbed.json'), 'utf8'),
) as { detail: { list: unknown[] } };

describe('extractObservedStats', () => {
  it('lê os stats finais do primeiro personagem da conta real', () => {
    const stats = extractObservedStats(raw.detail.list[0]);

    // 2000/2001/2002 são HP/ATK/DEF FINAIS — os ids que faltavam na tabela.
    expect(stats.hp).toBe(19884);
    expect(stats.atk).toBe(2781);
    expect(stats.def).toBe(922);
    // Percentuais chegam como "78.6%" e viram 78.6, não 0.786.
    expect(stats.critRate_).toBeCloseTo(78.6, 5);
    expect(stats.critDMG_).toBeCloseTo(178.8, 5);
    expect(stats.enerRech_).toBeCloseTo(100.0, 5);
    expect(stats.eleMas).toBe(112);
  });

  it('não lança em nenhum dos 63 personagens reais e sempre acha atk e critRate_', () => {
    for (const entry of raw.detail.list) {
      const stats = extractObservedStats(entry);
      expect(typeof stats.atk).toBe('number');
      expect(typeof stats.critRate_).toBe('number');
    }
  });

  it('ignora id sem StatKey equivalente em vez de lançar (RES elemental, stamina)', () => {
    const stats = extractObservedStats({
      selected_properties: [
        { property_type: 2001, final: '1000' },
        { property_type: 50, final: '10.0%' },      // RES Pyro — sem StatKey
        { property_type: 999999, final: '240' },     // Stamina — sem StatKey
      ],
    });
    expect(stats.atk).toBe(1000);
    expect(Object.keys(stats)).toEqual(['atk']);
  });

  it('devolve objeto vazio para entrada sem bloco de propriedades', () => {
    expect(extractObservedStats({})).toEqual({});
    expect(extractObservedStats(null)).toEqual({});
  });
});
