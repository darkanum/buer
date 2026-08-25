// packages/meta/scripts/research/archetype.ts
//
// Pesquisa e montagem de times.
//
// A diferença conceitual em relação à ficha de personagem: um personagem NÃO
// tem um time, tem vários. Fontes descrevendo composições diferentes não estão
// se contradizendo — cada uma é uma opção, e todas vão para o banco. Resolver
// isso por "maioria" descartaria justamente o que o usuário quer ver.
//
// Quem ordena a lista para o usuário é o MOTOR: força curada primeiro, depois
// quanto as builds DAQUELE jogador cumprem os alvos daquele time (spec §7.1).
// O ranking é por conta, não global.
//
// ESCOPO MENOR de propósito: só slots NOMEADOS. Decidir que um slot é flex, e
// quais elementos ele tolera, foi o julgamento que colocou geo dentro de um
// Hyperbloom na revisão final da Fase 2. Slot nomeado errado é visível na hora;
// slot flex mal autorado é silencioso.

import { z } from 'zod';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { ROLE_TAGS } from '@buer/core';
import type { RawTeamArchetype } from '../../src/types.js';
import { characterCatalog } from '../catalog.js';
import { MODEL, SOURCE_DOMAINS } from './client.js';
import { SOURCE_IDS, type SourceId } from './claims.js';
import { runResearchLoop, type SearchDeps, type ResearchOutput } from './search.js';
import type { ExtractClient, ExtractDeps } from './extract.js';

/** Da mais conservadora para a mais forte. Empate resolve para a primeira. */
const STRENGTH_ORDER = ['niche', 'strong', 'meta'] as const;
const STRENGTHS = new Set<string>(STRENGTH_ORDER);

export interface TeamOption {
  readonly id: string;
  readonly label: string;
  readonly members: readonly { readonly slug: string; readonly role: readonly string[] }[];
  readonly strength?: string;
  readonly citedBy: readonly SourceId[];
}

/**
 * `sources` foi removido daqui: era montado a partir de um mapa fixo de
 * URL-base por fonte e não tinha leitor nenhum — quem preenche a proveniência
 * do arquétipo é `ArchetypeDraftDeps.consultedUrls`, com as URLs que a busca
 * de fato consultou.
 */
export interface ArchetypeClaims { readonly subject: string; readonly teams: readonly TeamOption[] }

export interface ArchetypeDraftDeps {
  readonly claims: ArchetypeClaims;
  readonly subject: string;
  readonly gameVersion: string;
  /** As URLs que a busca web DE FATO consultou (`ResearchOutput.urls`). */
  readonly consultedUrls: readonly string[];
  /** A pesquisa saiu cortada por esgotar `maxResumes`. Vira tag no arquivo. */
  readonly truncated: boolean;
}

/** Forma compartilhada de recusa: por que um time não virou arquétipo. */
export interface ArchetypeRefusal {
  readonly id: string;
  readonly because: readonly string[];
}

export interface ArchetypeDraftResult {
  readonly archetypes: readonly RawTeamArchetype[];
  readonly refused: readonly ArchetypeRefusal[];
}

export function buildArchetypePrompt(subject: string): string {
  return [
    `Pesquise **todos os times** em que o personagem "${subject}" de Genshin Impact é usado,`,
    'nestes três sites e SOMENTE neles:',
    '',
    ...SOURCE_DOMAINS.map((d, i) => `${i + 1}. ${d}`),
    '',
    'Não escolha o melhor time. Liste **cada time** que as fontes descrevem — se uma fonte mostra',
    'uma composição e outra mostra outra, as duas interessam. Elas são opções diferentes, não',
    'versões concorrentes da mesma resposta.',
    '',
    'Para cada time, relate:',
    '- um nome curto pelo qual ele é conhecido (ex.: "National", "Hyperbloom", "Freeze");',
    '- os personagens que o compõem — de 2 a 4, incluindo obrigatoriamente o próprio ' + subject + ';',
    '- o papel de cada membro (main dps, sub dps, buffer, debuffer, healer, shielder, battery, driver, enabler);',
    '- se a fonte trata o time como referência do meta, forte, ou de nicho;',
    '- **quais das três fontes** descrevem esse time, e a URL de cada uma.',
    '',
    'REGRA QUE NÃO PODE SER QUEBRADA: não invente membro nem papel. Se as fontes não deixam claro o',
    'papel de alguém, **omita o papel** dessa pessoa em vez de deduzir pelo elemento ou pela classe.',
  ].join('\n');
}

/**
 * O domínio de cada fonte. Escrito por extenso, e não derivado de
 * `SOURCE_DOMAINS` por índice: duas listas paralelas casadas por posição são
 * exatamente o tipo de acoplamento que quebra em silêncio quando alguém
 * reordena uma delas.
 */
const DOMAIN_BY_SOURCE: Readonly<Record<SourceId, string>> = {
  'icy-veins': 'icy-veins.com',
  game8: 'game8.co',
  'genshin-builds': 'genshin-builds.com',
};

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * As URLs consultadas que pertencem às fontes que descreveram ESTE time.
 *
 * Antes, a lista inteira de URLs consultadas era carimbada igual em TODOS os
 * arquétipos do alvo — inclusive num time que uma única fonte descreveu, que
 * saía citando as três. As `tags` (`citado-por:*`) já estavam certas por
 * time; `sources`, que é a proveniência de verdade e vira
 * `explanation.citations` no motor, não estava.
 *
 * Uma fonte que citou o time mas cuja URL não aparece entre as consultadas
 * simplesmente não contribui com URL nenhuma — a tag `citado-por:` continua
 * registrando que ela citou, e `sources` continua afirmando só acesso.
 */
function sourcesFor(citedBy: readonly SourceId[], consultedUrls: readonly string[]): string[] {
  const domains = citedBy.map((s) => DOMAIN_BY_SOURCE[s]);
  return consultedUrls.filter((url) => {
    const host = hostOf(url);
    if (host === null) return false;
    return domains.some((d) => host === d || host.endsWith(`.${d}`));
  });
}

/** Identidade de uma composição: o CONJUNTO de membros, sem ordem. */
function compositionKey(team: TeamOption): string {
  return [...team.members.map((m) => m.slug)].sort().join('|');
}

/**
 * A mesma identidade de composição, mas para um `RawTeamArchetype` já
 * montado (gravado ou recém-rascunhado) — usada pelo lote de CLI para
 * reconhecer que dois alvos diferentes redescobriram o mesmo time (achado
 * Important da revisão: "composições idênticas se fundem" hoje só vale
 * DENTRO de uma chamada de `buildArchetypeDrafts`; o lote precisa da mesma
 * regra ENTRE alvos).
 *
 * Devolve `null` — "não sei dizer" — quando o arquétipo tem QUALQUER slot
 * `kind: 'element'` (flex) ou QUALQUER slot `character` cujo `anyOf` lista
 * mais de um nome (alternativas OR para um papel, não membros simultâneos).
 * Essa premissa vale para os rascunhos que ESTE pipeline produz — sempre
 * slot nomeado de um membro só —, mas `archetypeCompositionKey` também é
 * chamada sobre `knownArchetypes`, isto é, o banco CURADO já em disco, onde
 * a premissa é falsa: os arquétipos existentes têm slot flex e slot com
 * várias alternativas (ex.: `data/archetypes/mono-geo.json`). Achatar esses
 * casos como se fossem membros simultâneos inventaria uma composição — e um
 * rascunho novo, genuinamente diferente, poderia colidir com essa chave
 * inventada e ser descartado como "já conhecido" sem nunca ser gravado, sem
 * erro visível além de uma linha de progresso. Um `null` aqui faz a dedupe
 * (achado Important #3) PULAR o arquétipo em vez de adivinhar sua
 * composição — na pior das hipóteses um rascunho legítimo é gravado de novo
 * e o humano revisa um arquivo a mais; na outra direção, um rascunho
 * legítimo sumiria em silêncio.
 */
export function archetypeCompositionKey(archetype: RawTeamArchetype): string | null {
  const members: string[] = [];
  for (const slot of archetype.slots) {
    if (slot.requires.kind !== 'character' || slot.requires.anyOf.length !== 1) return null;
    members.push(slot.requires.anyOf[0]!);
  }
  return members.sort().join('|');
}

function mostConservativeStrength(teams: readonly TeamOption[]): string {
  const declared = teams
    .map((t) => t.strength)
    .filter((s): s is string => s !== undefined && STRENGTHS.has(s));
  if (declared.length === 0) return 'niche';
  // Superestimar um time é conselho errado; subestimar é conselho tímido.
  // A segunda falha é recuperável, a primeira não.
  return STRENGTH_ORDER.find((s) => declared.includes(s)) ?? 'niche';
}

export function buildArchetypeDrafts(deps: ArchetypeDraftDeps): ArchetypeDraftResult {
  const archetypes: RawTeamArchetype[] = [];
  const refused: { id: string; because: readonly string[] }[] = [];

  // Fontes diferentes descrevendo a mesma composição são o MESMO time, ainda
  // que a tenham nomeado diferente ou listado em outra ordem.
  const grouped = new Map<string, TeamOption[]>();
  for (const team of deps.claims.teams) {
    const key = compositionKey(team);
    grouped.set(key, [...(grouped.get(key) ?? []), team]);
  }

  for (const variants of grouped.values()) {
    const primary = variants[0]!;
    const because: string[] = [];

    if (primary.members.length < 2 || primary.members.length > 4) {
      because.push(`um time tem de 2 a 4 membros; a pesquisa deu ${primary.members.length}`);
    }
    if (primary.members.some((m) => m.role.length === 0)) {
      because.push('algum membro voltou sem papel — o slot não teria como casar');
    }
    if (!primary.members.some((m) => m.slug === deps.subject)) {
      because.push(`o time não inclui "${deps.subject}", que é o personagem pesquisado`);
    }

    if (because.length > 0) {
      refused.push({ id: primary.id, because });
      continue;
    }

    const citedBy = [...new Set(variants.flatMap((v) => v.citedBy))];

    archetypes.push({
      schemaVersion: 1,
      id: primary.id,
      label: primary.label,
      gameVersionAdded: deps.gameVersion,
      strength: mostConservativeStrength(variants),
      // Proveniência de MÁQUINA, declarada como tal. `authoredBy` é sempre
      // 'researched' e a confiança sai da mesma pergunta que a da ficha
      // responde — quantas fontes INDEPENDENTES sustentam isto —, nunca do
      // quanto o time parece bom nem do quanto o jogador consegue preenchê-lo.
      // 'high' é inalcançável por aqui de propósito: exige revisão humana, e
      // `validateMeta` recusa a combinação.
      provenance: {
        authoredBy: 'researched',
        confidence: citedBy.length >= 2 ? 'medium' : 'low',
      },
      // A citação vira tag em vez de virar força: quantas fontes mencionam um
      // time é fato verificável; o quanto ele é bom é julgamento, e misturar os
      // dois faria um número contável se passar por opinião curada.
      tags: [
        ...citedBy.map((s) => `citado-por:${s}`),
        // A ressalva viaja NO ARQUIVO, não só na saída do lote: quem abrir
        // este arquétipo daqui a um mês precisa ver que a pesquisa que o
        // gerou saiu cortada.
        ...(deps.truncated ? ['pesquisa-truncada'] : []),
      ],
      sources: sourcesFor(citedBy, deps.consultedUrls),
      slots: primary.members.map((m) => ({
        role: [...m.role],
        requires: { kind: 'character' as const, anyOf: [m.slug] },
        substitutable: false,
      })),
    });
  }

  return { archetypes, refused };
}

// ---------------------------------------------------------------------------
// Pesquisa (primeira chamada de API) — o laço mora em search.ts.
//
// Era cópia literal de `researchCharacter`: 45 linhas diferindo só no prompt,
// com o mesmo tratamento de `pause_turn`, a mesma soma de `usage` e o mesmo
// cast. Manter as duas significaria corrigir o laço duas vezes — e a correção
// do sinal de truncamento é exatamente o caso em que metade do pipeline
// ficaria com o defeito.
// ---------------------------------------------------------------------------

export function researchArchetypes(subject: string, deps: SearchDeps): Promise<ResearchOutput> {
  return runResearchLoop(buildArchetypePrompt(subject), deps);
}

// ---------------------------------------------------------------------------
// Extração (segunda chamada de API) — prosa da pesquisa -> TeamOption[]
// tipado. Mesmo princípio de extract.ts: nome de personagem que não resolve
// no catálogo é DESCARTADO e reportado via `onUnresolved`, nunca aproximado.
// ---------------------------------------------------------------------------

const RawTeamMemberSchema = z.object({
  slug: z.string(),
  role: z.array(z.string()).optional(),
});

const RawTeamSchema = z.object({
  name: z.string(),
  members: z.array(RawTeamMemberSchema),
  strength: z.string().optional(),
  citedBy: z.array(z.enum(SOURCE_IDS)),
});

const TeamsSchema = z.object({ teams: z.array(RawTeamSchema) });

/** "Xiangling" e "xiangling" precisam bater na mesma entrada do catálogo. */
function fold(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Nome dobrado -> slug canônico do catálogo de personagens do gi-data. */
function buildCharacterCatalog(): ReadonlyMap<string, string> {
  const catalog = new Map<string, string>();
  for (const entry of Object.values(characterCatalog())) catalog.set(fold(entry.slug), entry.slug);
  return catalog;
}

const ROLE_SET = new Set<string>(ROLE_TAGS);

export interface ExtractArchetypesResult {
  readonly claims: ArchetypeClaims;
  /**
   * Times inteiros descartados NESTA extração — hoje só por membro cujo nome
   * não resolveu no catálogo de personagens. Achado Critical da revisão: um
   * membro que não resolve muda a IDENTIDADE do time (`compositionKey` é o
   * conjunto de membros), não é um item de lista opcional como conjunto ou
   * arma — remontar o time sem quem faltou gravaria uma composição que
   * nenhuma fonte descreveu. Por isso o time inteiro sai daqui, nunca
   * encolhido.
   */
  readonly refused: readonly ArchetypeRefusal[];
  readonly usage: { readonly inputTokens: number; readonly outputTokens: number };
}

/**
 * A extração é a SEGUNDA chamada de API do pipeline de times, assim como em
 * extract.ts. `usage` viaja junto do resultado pelo mesmo motivo de lá: sem
 * ele, o lote (research-archetypes.ts) contaria só metade do custo real.
 */
export async function extractArchetypes(
  subject: string,
  researchText: string,
  deps: ExtractDeps,
): Promise<ExtractArchetypesResult> {
  const response = await (deps.client as ExtractClient).parse({
    model: deps.model ?? MODEL,
    max_tokens: 16000,
    output_config: { format: zodOutputFormat(TeamsSchema), effort: 'high' },
    messages: [
      {
        role: 'user',
        content: [
          `Estruture o relatório de pesquisa abaixo sobre os times do personagem "${subject}".`,
          '',
          'Um item por time. Cada membro precisa vir com "slug" (o nome do personagem) e "role"',
          '(o papel dele NESSE time). Se o relatório não deixa claro o papel de alguém, omita "role"',
          'para essa pessoa em vez de supor.',
          '',
          '--- RELATÓRIO ---',
          researchText,
        ].join('\n'),
      },
    ],
  });

  const parsed = TeamsSchema.safeParse(response.parsed_output);
  if (!parsed.success) {
    throw new Error(`não foi possível estruturar a pesquisa de times de "${subject}": saída fora do schema`);
  }

  const catalog = buildCharacterCatalog();
  const teams: TeamOption[] = [];
  const refused: ArchetypeRefusal[] = [];

  for (const raw of parsed.data.teams) {
    const id = fold(raw.name);
    const missingMembers: string[] = [];
    const unresolvedRoles: string[] = [];
    const members: { slug: string; role: readonly string[] }[] = [];

    for (const m of raw.members) {
      const slug = catalog.get(fold(m.slug));
      if (slug === undefined) {
        // Não remonta sem quem faltou — o membro que não resolve é motivo
        // para descartar o TIME, não só o nome dele. Ver comentário de
        // `ExtractArchetypesResult.refused`.
        missingMembers.push(m.slug);
        continue;
      }
      const role = (m.role ?? []).filter((r) => {
        const known = ROLE_SET.has(r);
        if (!known) unresolvedRoles.push(`papel "${r}" de ${m.slug}`);
        return known;
      });
      members.push({ slug, role });
    }

    // Relata os dois tipos de descarte via `onUnresolved` — inclusive o
    // membro que vai derrubar o time inteiro: é o achado Important #2 da
    // revisão (a CLI precisa mostrar o que foi jogado fora, não só recusar
    // em silêncio).
    const unresolvedNames = [...missingMembers, ...unresolvedRoles];
    if (unresolvedNames.length > 0) {
      for (const source of raw.citedBy) deps.onUnresolved?.(source, unresolvedNames);
    }

    if (missingMembers.length > 0) {
      refused.push({
        id,
        because: [
          `personagem${missingMembers.length > 1 ? 's' : ''} "${missingMembers.join('", "')}" ` +
            `não existe${missingMembers.length > 1 ? 'm' : ''} no catálogo do gi-data — ` +
            'o time foi descartado inteiro, não remontado sem quem faltou',
        ],
      });
      continue;
    }

    teams.push({
      id,
      label: raw.name,
      members,
      ...(raw.strength === undefined ? {} : { strength: raw.strength }),
      citedBy: raw.citedBy,
    });
  }

  const claims: ArchetypeClaims = { subject, teams };

  return {
    claims,
    refused,
    usage: {
      inputTokens: response.usage?.input_tokens ?? 0,
      outputTokens: response.usage?.output_tokens ?? 0,
    },
  };
}
