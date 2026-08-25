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
import type Anthropic from '@anthropic-ai/sdk';
import { loadCharacters } from '@buer/gi-data';
import { ROLE_TAGS } from '@buer/core';
import type { RawTeamArchetype } from '../../src/types.js';
import { MODEL, SOURCE_DOMAINS } from './client.js';
import { SOURCE_IDS, type SourceId } from './claims.js';
import type { SearchDeps, ResearchOutput } from './search.js';
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

export interface ArchetypeClaims { readonly subject: string; readonly teams: readonly TeamOption[]; readonly sources: readonly string[] }

export interface ArchetypeDraftDeps {
  readonly claims: ArchetypeClaims;
  readonly subject: string;
  readonly gameVersion: string;
  readonly sources: readonly string[];
}

export interface ArchetypeDraftResult {
  readonly archetypes: readonly RawTeamArchetype[];
  readonly refused: readonly { readonly id: string; readonly because: readonly string[] }[];
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

/** Identidade de uma composição: o CONJUNTO de membros, sem ordem. */
function compositionKey(team: TeamOption): string {
  return [...team.members.map((m) => m.slug)].sort().join('|');
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
      // A citação vira tag em vez de virar força: quantas fontes mencionam um
      // time é fato verificável; o quanto ele é bom é julgamento, e misturar os
      // dois faria um número contável se passar por opinião curada.
      tags: citedBy.map((s) => `citado-por:${s}`),
      sources: [...deps.sources],
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
// Pesquisa (primeira chamada de API) — mesma mecânica de search.ts, prompt
// diferente. `textOf`/`urlsOf` são duplicados de propósito: são helpers de
// poucas linhas, e importar uma função privada de outro módulo já revisado
// (Task 3) acoplaria os dois por um detalhe de implementação que nenhum dos
// dois expõe no contrato público.
// ---------------------------------------------------------------------------

function textOf(message: Anthropic.Message): string {
  return message.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('\n');
}

/**
 * Cuidado real: erro de server tool volta com HTTP 200 e um bloco cujo
 * `content` é um OBJETO de erro, não a lista de resultados. Iterar sem checar
 * `Array.isArray` quebra exatamente no caso em que a busca falhou.
 */
function urlsOf(message: Anthropic.Message): string[] {
  const urls: string[] = [];
  for (const block of message.content as { type: string; content?: unknown }[]) {
    if (block.type !== 'web_search_tool_result') continue;
    if (!Array.isArray(block.content)) continue;
    for (const result of block.content as { type?: string; url?: string }[]) {
      if (typeof result.url === 'string') urls.push(result.url);
    }
  }
  return urls;
}

export async function researchArchetypes(subject: string, deps: SearchDeps): Promise<ResearchOutput> {
  const maxResumes = deps.maxResumes ?? 4;
  const messages: Anthropic.MessageParam[] = [{ role: 'user', content: buildArchetypePrompt(subject) }];

  const texts: string[] = [];
  const urls: string[] = [];
  let inputTokens = 0;
  let outputTokens = 0;

  for (let attempt = 0; attempt <= maxResumes; attempt++) {
    const stream = deps.client.stream({
      model: deps.model ?? MODEL,
      // Streaming com teto alto: a busca web produz turnos longos, e sem
      // streaming isso bate no timeout de HTTP do SDK.
      max_tokens: 64000,
      thinking: { type: 'adaptive' },
      output_config: { effort: 'high' },
      tools: [
        {
          type: 'web_search_20260209',
          name: 'web_search',
          max_uses: deps.maxUses ?? 8,
          allowed_domains: [...SOURCE_DOMAINS],
        },
      ],
      messages,
    } as Anthropic.MessageStreamParams);

    const message = await stream.finalMessage();
    texts.push(textOf(message));
    urls.push(...urlsOf(message));
    inputTokens += message.usage?.input_tokens ?? 0;
    outputTokens += message.usage?.output_tokens ?? 0;

    // A busca web pode pausar um turno longo. O SDK não retoma sozinho: sem
    // este laço a resposta volta truncada, sem erro e sem aviso.
    if (message.stop_reason !== 'pause_turn') break;
    messages.push({ role: 'assistant', content: message.content });
  }

  return {
    text: texts.filter((t) => t !== '').join('\n'),
    urls: [...new Set(urls)],
    usage: { inputTokens, outputTokens },
  };
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
  for (const entry of Object.values(loadCharacters())) catalog.set(fold(entry.slug), entry.slug);
  return catalog;
}

const ROLE_SET = new Set<string>(ROLE_TAGS);

/** citedBy é um SourceId curto; aqui vira a URL-base do domínio correspondente. */
const SOURCE_URL_BY_ID: Readonly<Record<SourceId, string>> = {
  'icy-veins': 'https://icy-veins.com',
  game8: 'https://game8.co',
  'genshin-builds': 'https://genshin-builds.com',
};

export interface ExtractArchetypesResult {
  readonly claims: ArchetypeClaims;
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

  const teams: TeamOption[] = parsed.data.teams.map((raw) => {
    const unresolved: string[] = [];

    const members = raw.members.flatMap((m) => {
      const slug = catalog.get(fold(m.slug));
      if (slug === undefined) {
        unresolved.push(m.slug);
        return [];
      }
      const role = (m.role ?? []).filter((r) => {
        const known = ROLE_SET.has(r);
        if (!known) unresolved.push(`papel "${r}" de ${m.slug}`);
        return known;
      });
      return [{ slug, role }];
    });

    if (unresolved.length > 0) {
      for (const source of raw.citedBy) deps.onUnresolved?.(source, unresolved);
    }

    return {
      id: fold(raw.name),
      label: raw.name,
      members,
      ...(raw.strength === undefined ? {} : { strength: raw.strength }),
      citedBy: raw.citedBy,
    };
  });

  const claims: ArchetypeClaims = {
    subject,
    teams,
    sources: [...new Set(teams.flatMap((t) => t.citedBy))].map((id) => SOURCE_URL_BY_ID[id]),
  };

  return {
    claims,
    usage: {
      inputTokens: response.usage?.input_tokens ?? 0,
      outputTokens: response.usage?.output_tokens ?? 0,
    },
  };
}
