import { describe, it, expect } from 'vitest';
import { normalizeClaim, buildCatalogs, extractClaims } from '../scripts/research/extract.js';

const catalogs = buildCatalogs();

describe('normalizeClaim — nome humano vira slug do catálogo', () => {
  it('resolve conjunto e arma escritos como a fonte escreve', () => {
    const { claim, unresolved } = normalizeClaim(
      {
        source: 'icy-veins', url: 'https://icy-veins.com/x',
        sets: ['Emblem of Severed Fate'],
        weapons: ['The Catch'],
      },
      catalogs,
    );
    expect(claim.sets).toEqual(['emblem-of-severed-fate']);
    expect(claim.weapons).toEqual(['the-catch']);
    expect(unresolved).toEqual([]);
  });

  it('nome que não existe no catálogo é DESCARTADO e reportado, nunca adivinhado', () => {
    const { claim, unresolved } = normalizeClaim(
      { source: 'game8', url: 'https://game8.co/x', sets: ['Conjunto Que Não Existe'] },
      catalogs,
    );
    expect(claim.sets).toBeUndefined();
    expect(unresolved).toContain('Conjunto Que Não Existe');
  });

  it('descarta só o item inválido, preservando os que resolvem', () => {
    const { claim, unresolved } = normalizeClaim(
      {
        source: 'game8', url: 'https://game8.co/x',
        weapons: ['The Catch', 'Arma Inventada', "Dragon's Bane"],
      },
      catalogs,
    );
    expect(claim.weapons).toEqual(['the-catch', 'dragon-s-bane']);
    expect(unresolved).toEqual(['Arma Inventada']);
  });

  it('normaliza main-stat de nome humano para StatKey', () => {
    const { claim } = normalizeClaim(
      {
        source: 'icy-veins', url: 'u',
        mainStats: { sands: ['Energy Recharge'], goblet: ['Pyro DMG Bonus'], circlet: ['CRIT Rate'] },
      },
      catalogs,
    );
    expect(claim.mainStats?.sands).toEqual(['enerRech_']);
    expect(claim.mainStats?.goblet).toEqual(['pyro_dmg_']);
    expect(claim.mainStats?.circlet).toEqual(['critRate_']);
  });

  it('papel fora do vocabulário fechado é descartado', () => {
    const { claim, unresolved } = normalizeClaim(
      { source: 'game8', url: 'u', roles: ['sub-dps', 'carry'] },
      catalogs,
    );
    expect(claim.roles).toEqual(['sub-dps']);
    expect(unresolved).toContain('carry');
  });

  it('campo ausente continua ausente — normalizar não inventa', () => {
    const { claim } = normalizeClaim({ source: 'game8', url: 'u' }, catalogs);
    expect(claim.sets).toBeUndefined();
    expect(claim.erThreshold).toBeUndefined();
    expect(claim.mainStats).toBeUndefined();
  });

  it('preserva erWhy e erThreshold como vieram', () => {
    const { claim } = normalizeClaim(
      { source: 'icy-veins', url: 'u', erThreshold: 200, erWhy: 'o burst custa 80 de energia' },
      catalogs,
    );
    expect(claim.erThreshold).toBe(200);
    expect(claim.erWhy).toContain('80 de energia');
  });
});

describe('extractClaims', () => {
  it('devolve um claim por fonte, normalizado', async () => {
    const client = {
      async parse() {
        return {
          parsed_output: {
            claims: [
              { source: 'icy-veins', url: 'https://icy-veins.com/x', sets: ['Emblem of Severed Fate'] },
              { source: 'game8', url: 'https://game8.co/x', sets: ['Emblem of Severed Fate'] },
            ],
          },
        };
      },
    };
    const out = await extractClaims('xiangling', 'texto da pesquisa', { client });
    expect(out.character).toBe('xiangling');
    expect(out.claims).toHaveLength(2);
    expect(out.claims[0]!.sets).toEqual(['emblem-of-severed-fate']);
  });

  it('saída não parseável lança com mensagem em português, em vez de devolver vazio', async () => {
    const client = { async parse() { return { parsed_output: null }; } };
    await expect(extractClaims('xiangling', 'texto', { client })).rejects.toThrow(/não foi possível estruturar/i);
  });
});
