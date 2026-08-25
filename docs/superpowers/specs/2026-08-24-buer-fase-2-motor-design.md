# Buer — Fase 2: o motor de análise (design)

**Data:** 2026-08-24
**Escopo:** preencher o esqueleto de interfaces do motor com regras de meta reais.
**Spec-mãe:** `docs/superpowers/specs/2026-08-24-onewash-design.md` — a §6 daquele
documento define os contratos que este design implementa.

**Convenção de referência:** `F1§6.4` aponta para a spec de Fase 1; `§6.4` sem prefixo
aponta para uma seção **deste** documento. Os dois documentos têm uma §6, então o prefixo
não é decorativo.

---

## 1. Objetivo

Dado o roster real de um jogador, responder três perguntas encadeadas, **nessa ordem**:

1. Com os personagens que ele tem, **quais times** este personagem consegue formar?
2. Dentro de cada time, **qual é o alvo de build** e quanto a build atual se afasta dele?
3. **O que adquirir** para destravar os times que faltam um slot?

A ordem importa e é a decisão estruturante deste design: **o time é a entrada, não a
consequência.** Xiangling em Vaporize e Xiangling em Overload querem ER, ampulheta e às
vezes set diferentes. Julgar a build antes de saber o time é julgar contra um alvo
inventado. Não existe "a nota da build" de um personagem — existe a nota *dentro de cada
time*, e a diferença entre elas é a informação útil.

### 1.1 Dentro do escopo

- Pacote `@buer/meta`: dado curado versionado (fichas de personagem, arquétipos de time).
- Implementações curadas em `@buer/engine`: `CuratedBuildEvaluator`,
  `CuratedTeamEvaluator`, `CuratedRosterAdvisor`, `EvaluatorRegistry`.
- Preservação dos stats observados no normalizador de `@buer/core`.
- Pipeline offline de autoria assistida (pesquisa em lote → fichas revisáveis).
- Comando `analyze` na CLI, lendo extração crua.
- Suíte de validação sobre os 63 personagens reais.

### 1.2 Explicitamente fora do escopo

| Fora | Por quê |
|---|---|
| Avaliador `analytic` e tabelas de scaling | Segundo ciclo do gi-data. A Fase 2 usa os stats que o HoYoLAB já entrega. |
| `BuildSearcher` / otimizador de artefatos | Exige pontuar build hipotética. Fase 3. |
| Comparar duas builds hipotéticas | Idem. O `StatResolver` (§6.1) é a costura que torna isso um plug-in, não uma reescrita. |
| Telas web | Postgres provisionado e OAuth são pendentes conscientes da Fase 1. A CLI desbloqueia a Fase 2. |
| Geração combinatória de times | Decisão do brainstorm: só arquétipos curados. Ver §14.2. |
| Validação contra clears de Abyss/Theater | Não há fonte de dado, e exigiria simulação. Ver §12. |

---

## 2. Registro de decisões

| # | Decisão | Alternativa rejeitada | Razão |
|---|---|---|---|
| D1 | Estreia com o avaliador `curated`; `analytic` fica para a Fase 3 | Começar por cálculo de dano | O HoYoLAB já entrega os stats finais da build equipada. Cálculo só é necessário para build *contrafactual*. |
| D2 | Ficha curada por personagem, com **variantes nomeadas** | Ficha de alvo único; DSL de regras condicionais | Alvo único produz falso-negativo em personagem com build múltipla (Raiden battery vs hypercarry). DSL reintroduz inferência de condicional, que a F1§6 proibiu. |
| D3 | O time dirige a variante e os alvos | Diagnóstico independente de time | Correção do usuário durante o brainstorm. Os alvos mudam por time; julgar sem time é inventar alvo. |
| D4 | Só arquétipos curados; sem geração combinatória | Gerar times por regra e reconhecer os conhecidos | Escolha do usuário. Custo aceito: personagem fora do banco não recebe time nem alvo (§14.2). |
| D5 | Fichas nascem de pipeline de pesquisa em lote, revisado | Autoria 100% manual; scraping em runtime | 120 personagens no catálogo. Runtime quebraria `datasetSha`/reprodutibilidade da F1§6.4. |
| D6 | O avaliador é um **linter**, não uma nota | Score 0-100 com pesos | Peso mágico sem calibração foi o risco já registrado no STATUS. Achados são explicáveis; nota não é. |
| D7 | Escopo entrega motor + CLI, sem telas | Incluir web | Web depende de Neon e OAuth, ambos fora do controle desta fase. |

---

## 3. Arquitetura

### 3.1 Pacotes

**`@buer/meta` (novo).** Dado curado puro, lógica zero: fichas de personagem, arquétipos
de time, presets de inimigo, pesos de pontuação. JSON versionado + loaders tipados +
validação de schema. A mesma forma do `@buer/gi-data`.

Separado do `gi-data` de propósito, porque a proveniência é de natureza diferente:
`gi-data` é **derivado** de fonte externa e regenerável por `sync` — se apagar, o script
reconstrói. `meta` é **opinião**, com autor, fonte e patch de validade — se apagar,
perdeu-se trabalho humano. Misturados, o `sync` do gi-data poderia sobrescrever curadoria.

**`@buer/engine` (existe, esqueleto).** Ganha as implementações curadas e o registry. O
`null-evaluator` e a `contract-suite` permanecem; a suíte passa a rodar contra as
implementações reais, que é para isso que ela existe.

**`@buer/core`.** Mudança pequena: o normalizador passa a preservar os stats observados
(§4.1).

**`apps/cli`.** Ganha o comando `analyze` (§11).

**Pipeline de autoria:** `packages/meta/scripts/` — ferramenta de build, nunca runtime,
exatamente como `gi-data/scripts/sync.ts`.

### 3.2 Dependências

```
@buer/gi-data (dado de jogo)  ─┐
                               ├─→ @buer/meta ─→ @buer/engine ─→ apps/cli
@buer/core (tipos, normalize) ─┘                      ↑
                                 @buer/core ──────────┘
```

Sem ciclos. `meta` depende de `gi-data` apenas para validar que todo slug citado por uma
ficha existe no catálogo — a defesa contra ficha apontando para personagem, set ou arma
inexistente.

---

## 4. Mudanças de contrato na F1§6

### 4.1 Stats observados

Os stats finais do HoYoLAB (`selected_properties`, `base_properties`, `extra_properties`,
`element_properties`) são função do **conjunto equipado**, não do personagem. Colocá-los
em `CharacterInstance` seria erro de categoria.

```ts
export type ObservedStats = Readonly<Partial<Record<StatKey, number>>>;

// Roster ganha um mapa irmão — CharacterInstance não muda
export interface Roster {
  // ...
  readonly observedStats: ReadonlyMap<CharacterKey, ObservedStats>;
}

// Build ganha o campo, opcional
export interface Build {
  // ...
  readonly observedStats?: ObservedStats;
}
```

A propriedade comprada vale mais que a economia: **stats observados só existem para a
build capturada.** Uma build hipotética não tem como preencher o campo, e o tipo diz isso.
`CuratedBuildEvaluator.canHandle()` devolve `ok: false` quando o campo falta, usando a
negociação que a F1§6.4 já desenhou.

Trabalho correspondente em `@buer/core`: `normalize.ts` hoje descarta esses blocos
(confirmado — não há referência a eles no pacote). Talentos e constelação já sobrevivem
(`normalize.ts:65,72`).

### 4.2 `ArchetypeSlot` ganha endereçamento de variante

```ts
export interface ArchetypeSlot {
  // ... o que a F1§6.6 já define
  readonly variant?: string;                          // qual variante o slot exige
  readonly targetOverrides?: readonly StatTarget[];   // StatTarget: §5.2
}
```

`targetOverrides` generaliza o `erThresholds` que a F1§6.6 já previa: um arquétipo de
rotação longa pode exigir ER 200 onde a ficha genérica pede 180. Override é **por alvo**,
não substituição da ficha — a ficha continua sendo a base.

### 4.3 `TeamArchetype` ganha força curada e tags

```ts
export interface TeamArchetype {
  // ... o que a F1§6.6 já define
  readonly strength: 'meta' | 'strong' | 'niche';
  readonly tags: readonly string[];        // 'abyss' | 'overworld' | 'f2p' | 'no-5star'
  readonly slots: readonly ArchetypeSlot[];   // 2..4 — duo e trio são times válidos
}
```

`strength` é a resposta ao risco registrado no STATUS (*score de time aberto é peso mágico
sem calibração*): em vez de uma fórmula que decide que Hyperbloom vale 87 e Overload 72, a
força relativa é **dado autoral com fonte**, e o computado entra só como desempate.

---

## 5. `@buer/meta` — o dado curado

### 5.1 Ficha de personagem

Um arquivo por personagem em `packages/meta/data/characters/<slug>.json`. Um arquivo por
personagem — e não um JSON gigante — por três razões práticas: diff revisável, histórico
git por personagem, e o pipeline em lote regenerando 120 fichas não gera conflito de merge.

```ts
export interface CharacterProfile {
  readonly schemaVersion: 1;
  readonly character: CharacterKey;               // slug do gi-data
  readonly variants: readonly BuildVariant[];     // >= 1; a ordem é prioridade de desempate
  readonly provenance: MetaProvenance;
}

export interface BuildVariant {
  readonly id: string;                     // 'hypercarry', 'battery-er' — estável, referenciável
  readonly label: string;
  readonly roles: readonly RoleTag[];      // vocabulário fechado, §5.3
  readonly scalesOn: 'atk' | 'hp' | 'def' | 'eleMas';
  readonly sets: readonly SetOption[];          // ordenado, rank 1 = melhor
  readonly mainStats: Readonly<Record<'sands' | 'goblet' | 'circlet', readonly StatKey[]>>;
  readonly substats: readonly StatKey[];        // prioridade ordenada
  readonly weapons: readonly WeaponOption[];    // ordenado
  readonly targets: readonly StatTarget[];
  readonly notes?: string;
}

export interface SetOption {
  readonly kind: '4pc' | '2+2';
  readonly sets: readonly ArtifactSetKey[];   // 1 elemento para 4pc, 2 para 2+2
  readonly rank: number;                       // 1 = melhor
  readonly condition?: string;                 // prosa — EXIBIDA, jamais avaliada
}

export interface WeaponOption {
  readonly weapon: WeaponKey;
  readonly rank: number;
  readonly minRefinement?: 1 | 2 | 3 | 4 | 5;
}
```

Flor e pluma não aparecem em `mainStats` porque são fixas no jogo. Declará-las seria dado
morto que alguém um dia preencheria errado.

**`SetOption.condition` é texto, nunca expressão.** Esta é a linha que mantém o design fora
da abordagem de DSL. A F1§6.3 já decidiu que condicional é `ConditionalState` **declarado,
nunca inferido**; `condition` aqui é prosa que entra na `Explanation` para o humano
decidir. No minuto em que virar expressão avaliável, o sistema vira um interpretador de
regras sem ter escolhido ser um.

### 5.2 Alvos

Os alvos são a única parte da ficha que produz número. Tudo o mais é comparação de
igualdade ou de posição em lista ordenada.

```ts
export type StatTarget =
  | { readonly kind: 'min';   readonly stat: StatKey;
      readonly value: number; readonly hard: boolean; readonly why: string }
  | { readonly kind: 'range'; readonly stat: StatKey;
      readonly min: number; readonly max: number; readonly why: string }
  | { readonly kind: 'ratio'; readonly numerator: StatKey; readonly denominator: StatKey;
      readonly min: number; readonly max: number; readonly why: string };
```

Três formas cobrem o necessário: `min` em `enerRech_` é o limiar de ER; `ratio` de
`critDMG_`/`critRate_` entre 1.5 e 2.5 é a regra 1:2; `min` em `eleMas` cobre dendro e
Nilou. Todo alvo carrega `why` obrigatório — a explicação nunca diz "ER baixo", diz "ER
140; o burst precisa de 180 para sair toda rotação".

### 5.3 Proveniência e vocabulário

```ts
export interface MetaProvenance {
  readonly authoredBy: 'human' | 'researched' | 'researched-reviewed';
  readonly sources: readonly string[];        // URLs
  readonly authoredAt: string;                // ISO 8601
  readonly validatedForVersion: GameVersion;
  readonly confidence: 'high' | 'medium' | 'low';
}
```

`researched` sem revisão → `confidence: 'low'`, e isso **propaga** para o
`Provenance.confidence` do `Score` da F1§6.4 e aparece na saída. Uma ficha não revisada nunca
se passa por curadoria.

`RoleTag` é vocabulário **fechado**, porque o `roleCoverage` do `TeamAssessment` mapeia
sobre ele:

```
main-dps · sub-dps · buffer · debuffer · healer · shielder · battery · driver · enabler
```

### 5.4 Arquétipos e slots flex

`packages/meta/data/archetypes/<id>.json`, um por arquétipo.

`ArchetypeSlot.substitutable`, que a F1§6.6 já previa, ganha semântica concreta:

- **Slot fixo** (`substitutable: false`) — casa por `requires`: personagem nomeado em
  `anyOf`, ou elemento + papel.
- **Slot flex** (`substitutable: true`) — casa com **qualquer personagem do roster cuja
  ficha declare um dos `role` do slot**.

Um arquétipo é autorado nomeando só o núcleo — "Nilou + um dendro que aplique off-field" —
e os slots restantes resolvem contra o roster de cada jogador. O banco fica muito menor que
"uma linha por composição possível" e continua inteiramente curado: quem decidiu que aquele
slot é flex foi um humano. É também o que faz o mesmo arquétipo produzir times diferentes
para jogadores diferentes.

### 5.5 Integridade

`@buer/meta` roda testes que **falham alto**, na mesma disciplina do `sync.ts` do gi-data:

- todo slug de personagem, set e arma citado existe no catálogo do `gi-data`;
- `variant.id` único dentro da ficha; `archetype.id` único no banco;
- todo `RoleTag` dentro do vocabulário fechado;
- `mainStats` só com stat que o slot aceita (cruzado com `slot-main.json`);
- nenhum `rank` duplicado dentro de `sets` ou `weapons`;
- todo `ArchetypeSlot.variant` existe na ficha do personagem que o slot nomeia;
- **proibido** `confidence: 'high'` com `authoredBy: 'researched'`.

Ficha quebrada derruba o build; nunca vira veredito errado em produção.

---

## 6. O motor curado

### 6.1 `StatResolver` — a costura da Fase 3

O avaliador **nunca** lê `build.observedStats` diretamente. Lê stats por uma função só:

```ts
export interface StatResolver {
  readonly id: string;
  resolve(build: Build): Promise<ObservedStats | null>;   // null = não sei
}
```

Fase 2 entrega `ObservedStatResolver` (lê da captura). Fase 3 entrega
`ComputedStatResolver` (curvas + ascensão + arma + artefatos + bônus de set). **Mesma
interface, mesmas fichas, mesmo avaliador.** Comparar builds hipotéticas vira trocar o
resolver, não reescrever o motor — que é exatamente a armadilha em que o Genshin Optimizer
se prendeu ao acoplar solver e motor de fórmula.

Duas travas para o requisito não erodir:

1. Nenhum campo obrigatório de `Build` pode ser obtenível só de captura. Build hipotética
   já é construtível hoje (personagem + arma + 5 peças); falta apenas *pontuar*.
2. Um teste na `contract-suite`, escrito na Fase 2: build sem `observedStats` →
   `canHandle` devolve `ok: false` com `reasons`, nunca crash. Quando a Fase 3 plugar o
   resolver computado, esse mesmo teste vira a verificação de que a troca funcionou.

### 6.2 As cinco verificações

O `CuratedBuildEvaluator` produz **achados**, não uma nota. Cada achado tem status, causa
e ação.

| # | Verifica | Contra | Fonte |
|---|---|---|---|
| 1 | Set equipado (4pc / 2+2) | `variant.sets` | peças equipadas |
| 2 | Main-stats de ampulheta, cálice e capacete | `variant.mainStats[slot]` | peças equipadas |
| 3 | Alvos numéricos (ER, razão de crit, EM) | `targets` + `targetOverrides` | `StatResolver` |
| 4 | Arma e refino | `variant.weapons`, `minRefinement` | arma equipada |
| 5 | Eficiência de substats | `variant.substats` | rolls reconstruídos |

Cada uma devolve `on-target` | `acceptable` | `off-target` | `blocking`. `blocking` é
reservado a alvo `hard` violado — na prática, ER abaixo do limiar, que significa que o
burst não sai toda rotação.

A verificação 5 aproveita o trabalho mais difícil da Fase 1: os tiers de substat
reconstruídos (`rolls = times + 1`) permitem medir **quantos rolls foram para as stats que
a variante quer, contra o total investido**. É honesto e não precisa de tabela de scaling.

**Ressalva herdada do STATUS:** faltam as tabelas de tier 3★/4★, então ~10,7% dos substats
degradam para `source: 'reconstructed'` best-effort. A verificação 5 roda com confiança
plena só em peça 5★; em 3★/4★ reporta com ressalva visível.

### 6.3 Como os achados viram `Score`

A F1§6.4 exige `Score.value: number`, então:

- Qualquer achado `blocking` **domina**: o valor fica abaixo de toda build sem bloqueio,
  independentemente do resto. Não se compensa ER insuficiente com crit bom.
- Sem bloqueio, o valor é a soma das contribuições das cinco verificações, e
  `Score.breakdown` (já no contrato) carrega **cada contribuição separada**. Nada é somado
  em segredo.
- Os pesos vivem em `packages/meta/data/scoring.json`, versionados: ajustar calibração é um
  diff revisável, não mudança de código. Entram em `Provenance.assumptions`.
- Alvos `hard` violados também saem como `Score.violations` (`ConstraintViolation[]`).

Capacidades declaradas: `kind: 'curated'`, `output: 'ordinal'`, `providesBounds: false`,
`supportsAggregates: ['sum']`, `modelsSnapshot: false`, `modelsAuraAndIcd: false`,
`deterministic: true`.

### 6.4 Seleção de variante

Este é o modo de falha da abordagem escolhida, então a regra é explícita e ordenada:

1. Usuário fixou uma variante → usa essa.
2. Há contexto de time e um arquétipo casou → usa a variante que o slot nomeia.
3. Senão → pontua a build equipada contra **todas** as variantes e escolhe a de maior nota.
4. Empate → a primeira na ordem de `variants`.

A regra 3 é a que importa: julga-se a pessoa pela build que ela **mais parece estar
tentando fazer**. Quem montou um Raiden battery legítimo não é reprovado por não ser
hypercarry. E a `Explanation` **sempre** nomeia a variante escolhida e diz como trocar —
senão o usuário recebe uma nota sem saber contra o quê.

### 6.5 Degradação

| Falta | Resposta |
|---|---|
| `observedStats` | `canHandle` → `ok: false` com `reasons`. Nunca crash. |
| Ficha do personagem | Sem veredito. Só fatos afirmáveis: stats, talentos, o que está equipado. |
| Arquétipo cita variante inexistente | Falha no **build** do `@buer/meta`, não em runtime. |
| Roster `showcase-only` / `partial` | Propaga para `Provenance.rosterCompleteness`; time bloqueado vira "talvez você tenha, não consigo ver". |

---

## 7. Times: matching e assessment

### 7.1 O algoritmo

Para o personagem X:

1. **Filtra** os arquétipos com ao menos um slot que X pode ocupar.
2. **Resolve a atribuição** dos slots restantes contra o roster do jogador. Isso é
   **matching bipartido**, não escolha slot-a-slot: um personagem ocupa um só slot, e o
   guloso erra quando um personagem serve a dois. Com ≤4 slots e ≤120 candidatos o exato é
   barato — a F1§6.5 já marcou a distinção (`TeamSearcher.strategy: 'assignment'`).
3. **Classifica:**
   - todos os slots preenchidos → **time jogável**;
   - exatamente um slot vazio → **time bloqueado** → candidato de aquisição (§8);
   - dois ou mais vazios → não exibe (longe demais para ser conselho).
4. **Ordena os jogáveis:** `strength` curado primeiro; empate desfeito por quanto as builds
   reais cumprem os alvos duros daquele time; empate persistente pela ordem declarada. A
   saída diz **qual critério decidiu** — nunca um número sem origem.

### 7.2 O que se afirma sem meta nenhuma

Três coisas são regra de jogo, não opinião, e entram com confiança alta em qualquer time:

- **Reações disponíveis** (`ReactionAvailability`) — dos elementos dos slots preenchidos.
- **Ressonância elemental** (`ResonanceEffect`) — da contagem de elementos.
- **Viabilidade de energia** (`energyFeasibility`) — ER exigido vem de
  `erThresholds`/`targetOverrides`; ER real vem do `StatResolver`. É comparação de dois
  números conhecidos, e é provavelmente o conselho mais acionável da saída.

`TeamAssessment.score` continua existindo, com `unit: 'score'`, `output: 'ordinal'` e
proveniência dizendo que veio de curadoria mais desempate — não de simulação.

### 7.3 A explicação de um time

Nomeia: o arquétipo casado e sua confiança, quem foi para cada slot (e por quê, no caso dos
flex), contra qual variante cada personagem está sendo julgado, e o que está fora do alvo.
É a `Explanation` da F1§6.4 com `citations` apontando para as `sources` do arquétipo.

---

## 8. Aquisição

Princípio herdado da F1§6.6: *aquisição é valor marginal contra gap analysis, não tier list*.
Sob a decisão D4, isso fica mais fácil e mais honesto, porque o banco de arquétipos já é a
definição do que existe para destravar.

### 8.1 Candidatos, no escopo de um personagem

Os **times bloqueados** de §7.1 são a fonte:

- **Slot fixo vazio** (`requires.anyOf`) → `{ kind: 'newCharacter', character }`. Se o
  jogador **tem** o personagem mas abaixo de `minConstellation`/`minRefinement`, o eixo
  muda para `{ kind: 'constellation' }` ou `{ kind: 'refinement' }` — mesmo bloqueio,
  aquisição muito mais barata. Vale dizer isso alto.
- **Slot flex vazio** (`requires.element` + papel) → o candidato não é uma pessoa, é uma
  lacuna: `CoverageGap` com elemento e papéis, acompanhada da enumeração dos personagens do
  catálogo cuja ficha declara aquele papel e elemento. Enumeração de fato, não recomendação.
- **Arma** → `{ kind: 'newWeapon' }` quando a equipada está fora da lista da variante e
  existe uma de rank melhor.

### 8.2 Ordenação

Dois fatos contáveis, nessa ordem:

1. **Quantos arquétipos o candidato desbloqueia** — contagem sobre o banco cruzado com o
   roster real, não opinião.
2. **A força curada desses arquétipos** (`meta` > `strong` > `niche`).

Nada mais entra. Um número somando "potencial de dano" seria exatamente a tier list que a
F1§6.6 proibiu.

### 8.3 `redundancyWith` — a função que diz "não compra"

Recebe os personagens que o jogador **já tem** e que cobrem o mesmo papel e elemento nos
mesmos arquétipos. É a única parte do sistema que ativamente desaconselha gastar, e por isso
é a que constrói confiança: *"desbloqueia 3 times, mas os 3 você já joga com o que tem"* é
melhor que qualquer ranking.

### 8.4 O que a Fase 2 não entrega

- **`improves[].delta` fica vazio.** Estimar "quanto melhora" exige pontuar a build
  hipotética do personagem novo — o que o `ObservedStatResolver` não faz. A Fase 2 responde
  *o que destrava* e *o que não vale*; **não** responde *quanto rende*. A Fase 3 preenche
  sem tocar nisto.
- **Disponibilidade de gacha** (limitado, padrão, evento, loja) não está no gi-data. O motor
  nunca diz "farme agora"; diz o que destravaria. Declarado em `Provenance.assumptions`.

### 8.5 Visão de conta

A mesma máquina sobre o roster inteiro produz o `AcquisitionAdvice` completo e os
`CoverageGap` com `severity` derivada do banco: `critical` quando bloqueia arquétipo
`meta`, `notable` para `strong`, `minor` para `niche`.

---

## 9. Do gap para a ação

- **Set errado ou main-stat errada** → entrada em `FarmPlan.targets` (set, slot, main-stat,
  delta esperado como `Interval`, domínio). Probabilidades de drop **não estão no dado de
  jogo** — vão declaradas em `FarmPlan.assumptions`, como a F1§6.7 já mandou.
- **ER curto, crit desbalanceado** → conselho de prioridade de substat ou troca de
  ampulheta.
- **Troca por dominância** → `EquipPlan`.

### 9.1 Troca por dominância

Se uma peça **não equipada** do inventário é melhor em **todos** os critérios declarados —
mesmo set, main-stat igual ou melhor na lista ordenada, mais rolls nas substats
prioritárias, nível igual ou maior — trocar é defensável sem calcular dano. É comparação
lexicográfica nos critérios da ficha, não simulação.

Os limites são rígidos, e são o que a mantém honesta:

- só peça **não equipada** — a política default da F1§6.5 é `allowStealingFrom: []`;
- só quando domina em **todos** os critérios; empate parcial não gera sugestão, porque
  desempatar exige justamente o cálculo de dano que a Fase 2 não tem;
- nunca "essa peça é 3% melhor" — a Fase 2 não sabe disso e não vai fingir que sabe.

---

## 10. Pipeline de autoria assistida

Três comandos em `packages/meta/scripts/`, todos offline, nenhum em runtime:

| Comando | Faz |
|---|---|
| `meta:gaps` | Cruza o catálogo do `gi-data` com `data/`: personagens sem ficha, personagens em nenhum arquétipo, fichas com `validatedForVersion` atrasado. É o **gatilho de patch novo**: quando o `sync` do gi-data traz personagem novo, ele aparece aqui. |
| `meta:research:characters` | Pesquisa em lote sobre os alvos; escreve rascunhos de `CharacterProfile`. |
| `meta:research:archetypes` | Idem para `TeamArchetype`. |

A pesquisa é a API da Anthropic com busca web e saída estruturada validada contra o schema
— não um scraper. O script enumera alvos, segura o template de prompt, valida, escreve um
arquivo por personagem e emite checklist de revisão.

Duas honestidades:

- **Custa dinheiro e exige chave de API.** É custo de autoria, pago em lote e raramente —
  não custo por usuário.
- **A rodada do pipeline não é reproduzível; a ficha commitada é.** LLM varia entre
  execuções. O artefato reproduzível e auditável é o JSON no git, com `sources` e
  `authoredAt`. Por isso a revisão humana é o portão, não a re-execução.

O portão é um diff de uma linha: rascunho nasce `authoredBy: 'researched'` +
`confidence: 'low'`; revisar promove para `'researched-reviewed'` + `'high'`. O teste de
§5.5 impede promover por acidente.

---

## 11. CLI

```
pnpm --filter @buer/cli run start:dev analyze --from extracao.json --character xiangling
pnpm --filter @buer/cli run start:dev analyze --from extracao.json --account
```

Flags: `--variant <id>` fixa variante; `--json` saída de máquina; `--character <slug>` ou
`--account`.

Lê do arquivo de extração crua (o `--raw-out` que a Fase 1 já produz), **não do banco**. É
deliberado: Postgres provisionado e OAuth são pendentes da Fase 1, e a Fase 2 não pode ficar
refém deles. Quando o banco existir, a mesma função recebe um snapshot — a leitura é um
adaptador, não o motor.

---

## 12. Validação

A resposta desconfortável primeiro: **não dá para validar que uma build sugerida é "boa" na
Fase 2.** A saída é ordinal, não há verdade-fundamental disponível, e validar contra clears
de Abyss/Theater exigiria simulação e um dado que não temos. Prometer isso seria mentira.

O que dá para validar é o oposto: **que o sistema nunca diz algo que sabemos ser errado.**
Falsificação, não verificação — a mesma postura do contrato de produto que a F1§6.4 já
escreveu (*isto é comparação, não previsão*).

Cinco camadas, da mecânica para a que exige julgamento:

1. **Contrato** — a `contract-suite` existente, agora contra as implementações reais.
   Inclui o teste que blinda a Fase 3 (§6.1).
2. **Integridade do dado** — §5.5. Falha o build.
3. **Invariantes sobre os 63 reais** — roda o analisador na conta inteira e afirma
   propriedades, não notas: nenhum crash; nenhum veredito sem explicação; toda variante
   escolhida é nomeada na explicação; nenhum achado `blocking` sem `why`; todo personagem
   com ficha e arquétipo recebe um time ou um motivo explícito de não ter.
4. **Golden file** — o relatório completo sobre os 63 fica commitado. Mudar ficha, peso ou
   avaliador vira um diff revisável de vereditos. Não prova que o veredito está certo;
   prova que se **percebe** quando ele muda. É a rede que mais segura regressão.
5. **Casos-âncora** — 15 a 25 afirmações escritas à mão do que **não pode** acontecer.
   Exemplos: Nilou nunca recebe alvo de ATK%; Raiden C0 com ER 140 em time nacional sai
   `blocking`; personagem com set rank 1, main-stats corretas e crit em faixa sai com zero
   achado fora do alvo; nenhum candidato de aquisição com `redundancyWith` não-vazio
   aparece no topo da lista.

A camada 5 é a única que exige autoria humana. As outras quatro rodam sozinhas. E é a 5 que
pega o erro que importa — o palpite plausível e errado.

O corpus de calibração é a conta real já validada: 63 personagens, 20 de 5★ e 43 de 4★, 17
no nível 90, cobrindo os 7 elementos. É corpus de teste, **não** fonte de ficha: fichas
descrevem o personagem, não a conta de ninguém.

---

## 13. Ordem de construção

TDD. A ordem é ditada pelas dependências:

1. Tipos e schema do `@buer/meta` + testes de integridade.
2. `observedStats` no `core` e nos tipos da F1§6 + `StatResolver` + `ObservedStatResolver`.
3. `CuratedBuildEvaluator` e as cinco verificações.
4. Matching de arquétipo e `CuratedTeamEvaluator`.
5. `CuratedRosterAdvisor` e aquisição.
6. CLI `analyze` e golden file.
7. Pipeline de autoria e a primeira leva de fichas em lote.

**Sequenciamento:** os passos 3 a 6 precisam de fichas reais para ter o que testar. Escrever
à mão 8 a 10 fichas e 4 a 5 arquétipos cobrindo os personagens investidos da conta de
calibração **antes** de soltar o pipeline em lote sobre os 120. Escrever as primeiras à mão
é o que ensina qual deve ser o prompt do pipeline.

---

## 14. Riscos conhecidos

### 14.1 Seleção errada de variante

O modo de falha da decisão D2. Mitigação: regra ordenada e explícita (§6.4), variante
sempre nomeada na explicação, e a opção de fixar outra. Não elimina o risco — o torna
visível e corrigível pelo usuário.

### 14.2 Personagem sem cobertura de arquétipo

Custo aceito da decisão D4. Personagem fora do banco não recebe time e, como o time dirige o
alvo, também não recebe veredito de build — cai no caminho degenerado: ficha, seleção por
melhor casamento (regra 3 de §6.4), e a saída diz "ainda sem time curado para este
personagem". Nunca inventa time. Mitigação real: o pipeline de §10 autora **arquétipos**,
não só fichas — "curado" significa "veio de registro autoral com fonte e patch", não
"digitado à mão".

### 14.3 Ficha pesquisada plausível e errada

O erro mais perigoso do sistema, porque tem cara de curadoria. Três defesas: `confidence`
propagando até a saída, o teste que proíbe `high` sem revisão (§5.5), e os casos-âncora
(§12, camada 5).

### 14.4 Pesos de pontuação sem calibração

Mitigado por design: o avaliador é linter, `breakdown` expõe cada contribuição, e os pesos
são dado versionado, não código. Continua sendo julgamento — mas julgamento auditável.

### 14.5 `asc` sempre 0 (herdado da Fase 1)

O payload do HoYoLAB não expõe `base.promote_level` do personagem, só o da arma. Não afeta
a Fase 2, que usa stats observados. **Afeta a Fase 3**: o `ComputedStatResolver` precisa da
ascensão para calcular stats base. Fica registrado aqui para não ser redescoberto tarde.

### 14.6 Substats 3★/4★ best-effort (herdado da Fase 1)

~10,7% dos substats sem tabela de tier exata. Afeta só a verificação 5, que reporta com
ressalva em peça não-5★ (§6.2).
