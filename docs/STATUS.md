# Buer — Status & Handoff

**Atualizado:** 2026-08-25
**Branch:** `claude/buer-fase-2-motor-065ad4` (Fase 2) · Fase 1 em `design/onewash-fase-1`, PR https://github.com/darkanum/buer/pull/1
**Local do projeto:** `X:\Projetos\Buer` (é aqui que se trabalha — NÃO em `X:\Projetos\OneWash`, que é de outro projeto)

> Nota de nomenclatura: a branch e os arquivos de spec/plano mantêm o slug antigo `onewash` no nome (renomear quebraria o PR/links); todo o *conteúdo* e o escopo dos pacotes já é `@buer/*`.

---

## O que funciona (verificado)

- **Fase 1 completa** — monorepo pnpm+Turborepo, pacotes `@buer/{core,hoyolab,cookies,db,gi-data,engine}` + `apps/{cli,web}`. ~136 testes verdes, `pnpm -w typecheck` verde, `next build`/`next dev` (via `--webpack`) funcionam. Review de branch inteira limpa (zero blockers).
- **Extração de conta real FUNCIONA** — extração da conta os_usa (63 personagens) validada de verdade. Seleção multi-conta funciona (`--list-accounts`, `--region`, `--uid`).
- **Pipeline de dados provado nos testes** — `normalize` → `writeSnapshot` (dedupe por content-hash, timeline SCD2, rollback atômico) → leitura, tudo contra Postgres real (PGlite) nos testes.
- **Web** sobe; roteamento/auth/API corretos (landing 200, páginas com sessão 307→login, `/api/ingest` com 401/400/409/dedupe, `/api/img` 404, Better Auth vivo).
- **CLI** `login`/`logout`/`whoami` rodam como binário; `sync` roda via `tsx` (`pnpm --filter @buer/cli run start:dev sync ...`).

### Como extrair uma conta (comando de referência)
```
pnpm --filter @buer/cli run start:dev sync --list-accounts --cookie "ltoken_v2=...; ltuid_v2=..."
pnpm --filter @buer/cli run start:dev sync --dry-run --region os_usa --raw-out "extracao.json" --cookie "ltoken_v2=...; ltuid_v2=..."
```
(cookie fica na máquina do usuário; `--raw-out` salva o payload cru mesmo se o normalize falhar.)

---

## Descobertas do Spike 1 (dado real)

- **Esquema de property_type do HoYoLAB = FightProp** (confirmado pelo `property_map` que a própria API devolve): `2=HP, 3=HP%, 5=ATK, 6=ATK%, 8=DEF, 9=DEF%, 20=critRate, 22=critDmg, 23=ER, 26=cura, 28=maestria, 30=físico, 40..46=dano elemental`. Isso **resolve a reconciliação core↔gi-data**: o gi-data estava certo; o subset chutado no core estava errado.
- **Substats planos** (HP/ATK/DEF/EM planos) exibem valor inteiro → a reconstrução de tier com arredondamento de 1 casa quebra; precisa de precisão por-stat (flat=0 casas, %=1 casa).
- **DS é dispensável** nos endpoints de chronicle OS (confirmado — a extração rodou sem DS válido... na verdade com DS default on; o ponto é que funciona).

---

## Recém-feito (Spike 1 → normalizer real-ready)

- **Normalizador roda nos 63 personagens reais** (commit `b4c1293`). Fixture-ouro anonimizada em `packages/core/test/fixtures/real-account.scrubbed.json` (sem UID/nickname reais). Mapa de property FightProp correto via gi-data (`packages/core/src/properties.ts` — a reconciliação core↔gi-data feita), substats planos e decimais por-prop.
  - **Descoberta de correção (dado real):** HoYoLAB manda `times` = rolls APÓS o roll inicial → `rolls = times + 1` (verificado em ~494 substats). Estava errado antes.
  - **Caveats conhecidos (2º ciclo):** faltam tabelas de tier 3★/4★ → ~10,7% dos substats (em gear "fodder" não-5★) degradam pra tier best-effort em vez de exato; `asc` (ascensão do personagem) vem sempre 0 porque o payload não expõe `base.promote_level` do personagem (só o da arma) — lacuna de disponibilidade de dado, não bug.

## Pendente / diferido (decisões conscientes de Fase 1)

- **Ver na tela fim-a-fim:** falta Postgres provisionado (Neon) + OAuth/login + rodar um `sync` real → snapshot no banco → telas.
- **Bundle da CLI** (tsdown, inlinar deps): hoje `sync`/`doctor` só rodam via `tsx`, não via dist compilada.
- **Pipeline de imagens:** retratos são placeholder (falta gi-data expor icon paths + espelhar no R2).
- **Onboarding no site:** precisa do **seletor de conta/região** (mesmo conceito do `--list-accounts` da CLI) — requisito de produto, não opcional.
- **Persistir a conta escolhida** no config da CLI (escolher uma vez).
- Limpezas menores: `db:migrate` inerte (migration roda via SQL direto); `scrub.ts` usar `Object.hasOwn`; `--webpack` é workaround do bug upstream do Turbopack.
- **Segurança:** o `extracao*.json` tem UID/nickname reais — manter fora do git (adicionar ao `.gitignore`).

---

## Fase 2 — o motor de análise (COMPLETA)

**Branch:** `claude/buer-fase-2-motor-065ad4` (29 commits sobre `design/onewash-fase-1`).
**Spec:** `docs/superpowers/specs/2026-08-24-buer-fase-2-motor-design.md` · **Plano:** `docs/superpowers/plans/2026-08-24-buer-fase-2-motor.md`

### O que funciona (verificado rodando, não só nos testes)

```
pnpm --filter @buer/cli run start:dev analyze --from <caminho-absoluto-da-extracao.json> --character xiangling
pnpm --filter @buer/cli run start:dev analyze --from <caminho-absoluto-da-extracao.json> --account
```

Saída real, sobre a conta de calibração de 63 personagens: times curados que o personagem consegue formar, quem foi para cada slot e contra qual variante está sendo julgado, ER medido contra o alvo de cada membro, os cinco achados da build, e as lacunas de aquisição. Tudo em nomes legíveis, não ids.

- **307 testes verdes**, 16 pacotes/tarefas, `pnpm -w typecheck` limpo.
- **Pacote novo `@buer/meta`** — dado curado versionado: 10 fichas de personagem (com variantes nomeadas), 5 arquétipos de time, pesos de pontuação. Validação que derruba o build quando o dado é inválido.
- **`@buer/engine` preenchido** — `CuratedBuildEvaluator` (cinco verificações que produzem achados explicáveis, não uma nota), `CuratedTeamEvaluator` (matching bipartido exato de arquétipo contra roster), `CuratedRosterAdvisor` (aquisição derivada de arquétipo bloqueado), `StatResolver` como costura para a Fase 3.
- **Montagem de `Roster`/`Build`** a partir do payload cru do HoYoLAB — não existia antes; era a peça faltante entre a extração e o motor.
- **Golden file** sobre os 63 personagens reais + **13 casos-âncora** do que o sistema nunca pode afirmar.

### O padrão de defeito desta fase (vale para a Fase 3)

Seis defeitos da **mesma família** foram encontrados em revisão, e **nenhum quebrava teste**:
valor ausente virando `0`; afirmação sobre o dado do usuário nunca verificada; rótulo afirmando origem falsa; identificador sem dono; lista filtrada por um critério e apresentada como se fosse por outro; papel marcado como coberto sem evidência.
O contrato que os previne está na spec: *nenhum número sem origem rastreável; ausência nunca vira zero; nenhum rótulo afirma origem que não é a verdadeira.* Revise contra ele.

Um sétimo defeito, no **dado** e não no código, colocava personagem de elemento antagônico dentro de arquétipo curado (geo num Hyperbloom) e apresentava como time `meta` jogável. Hoje há âncora que pega isso.

### Pendente / adjudicado (decidido conscientemente, não esquecido)

Ordenado por impacto de produto:

1. **"Ainda sem time curado" é falso para Noelle e Gorou.** O `mono-geo` nomeia os dois; o time existe, só não é formável (faltam fichas de geo sub-dps e de um 3º slot). Pior: arquétipo em `too-far` não gera `coverageGap`, então não há sinal nenhum de que falta um geo. Conserto: uma linha de condição, ou escrever a ficha (a conta tem Albedo e Ningguang).
2. **`redundancyWith` nunca chega à tela.** O advisor computa quem você já tem que faz o mesmo trabalho — a única parte do sistema que desaconselha gastar — e a CLI não serializa. Falta também a âncora que a §12 da spec nomeia literalmente ("nenhum candidato com `redundancyWith` não-vazio no topo").
3. **`Provenance` é computada e descartada.** `confidence`, `citations` e `assumptions` não aparecem em lugar nenhum da saída — 0 ocorrências no golden. A §5.3 promete que a confiança da ficha chega ao usuário; não chega. `CuratedBuildEvaluator` e `DefaultEvaluatorRegistry` não têm consumidor de produção.
4. **Todo dado curado tem `sources: []`.** "Curado" hoje significa "escrito à mão sem citação". `explanation.citations` é sempre vazio.
5. **Três cópias divergentes da regra "este personagem pode hospedar este arquétipo"** (`candidatesFor`, `canHost`, `adviseFor`); a terceira erra na direção insegura.
6. **Alvo duro não medido conta como cumprido** na contagem que ordena times.
7. **A camada 5 da §12** (casos-âncora) tem 13 asserções sobre a forma do JSON do banco; os três exemplos que a spec nomeia — sobre a *saída* do sistema — não existem.
8. **A §9 da spec (`FarmPlan`, `EquipPlan`, troca por dominância) não foi implementada** — lacuna consciente registrada no plano. Ausência limpa: só os dois tipos declarados, nenhum código pela metade.
9. **Cobertura do banco:** 10 fichas cobrem 10 dos 120 personagens do catálogo. Na conta de calibração, 5 dos 63 personagens têm time jogável. É o gargalo real do produto, e é o que o **pipeline de autoria assistida (plano separado, §10 da spec)** existe para resolver.

### Cobertura conhecida-faltante (informada pelo dono da conta, 2026-08-25)

Rodando `analyze --account` na conta real, o relatório afirmou "falta um personagem de cryo/pyro que cumpra main-dps" para lacunas de arquétipo. **O dono da conta tem os três times abaixo completos e montáveis hoje, com carry no nível 90.** Não falta ficha; faltam três arquétipos inteiros, mais as fichas dos 11 personagens envolvidos.

| Time | Composição | Estrutura elemental (verificada no dado) |
|---|---|---|
| **Sandrone** (carry, cryo, L90 C0) | + `odette` (cryo L80 C0) / `alyosha` (electro L89 C6) / `fischl` (electro L90 C6) + `qiqi` (cryo L90 C3) | cryo carry com electro — supercondução, ressonância cryo |
| **Linnea** (carry, geo, L90 C1) | + `zibai` (geo L90 C1) + `columbina` (hydro L90 C3) + `illuga` (geo L90 C6) | 3 geo + 1 hydro — ressonância geo |
| **Durin** (carry, pyro, L90 C0) | + `varka` (anemo L90 C0) + `nicole` (pyro L90 C0) + `prune` (anemo L50 C5) | 2 pyro + 2 anemo — ressonância pyro, swirl duplo |

Elemento, raridade, tipo de arma, nível e constelação foram verificados contra o catálogo do `gi-data` e a extração real. **Papéis e alvos de build não foram autorados** — nenhum dos 11 personagens tem ficha, e escrevê-las de memória produziria exatamente o defeito que a §14.3 da spec descreve. É trabalho do pipeline de autoria (abaixo).

Consequência de produto enquanto isso não existe: a lacuna reportada é sobre o **banco de fichas**, não sobre o roster, e a frase atual não deixa isso claro o bastante — ver item 1 dos pendentes.

### Pipeline de autoria assistida — IMPLEMENTADO (falta a primeira rodada real)

**Plano:** `docs/superpowers/plans/2026-08-25-buer-pipeline-autoria.md` · 7 tarefas de código, todas revisadas e fechadas.

Ferramenta offline em `packages/meta/scripts/`, nunca importada por runtime. Quatro estágios por alvo, e a fronteira entre eles é o desenho: **pesquisa** e **extração** chamam a API; **reconciliação** e **escrita** são TypeScript puro. A parte cara e não-determinística fica isolada; a parte que decide é testável sem chave de API.

```bash
pnpm --filter @buer/meta run meta:gaps
pnpm --filter @buer/meta run meta:research:characters -- --only <slugs> --dry-run
pnpm --filter @buer/meta run meta:research:archetypes  -- --only <slugs>
```

- **A confiança sai de concordância entre fontes computada em código**, não de um prompt. Campo de **lista** (conjuntos, armas, substats, main-stats) divergindo é **alternativa** — une e ranqueia, nada é descartado. Campo de **valor único** (limiar de ER, o atributo que escala) divergindo é **contradição** — maioria decide, sem maioria fica ausente, e derruba a confiança.
- **Um personagem tem vários times.** Composições diferentes viram arquétipos separados; idênticas se fundem. Quem ordena para o usuário é o motor, por conta.
- **`confidence` nunca é `high`** — isso exige revisão humana. Rascunho nasce `authoredBy: 'researched'`.
- **A borda recusa**: pesquisa sem conjunto, papel, `scalesOn` ou main-stat vira relatório, não arquivo. Time com membro que não resolve é recusado **inteiro** — encolher a composição criaria um time que ninguém descreveu.
- **`sources` traz as URLs realmente consultadas pela busca**, não as que o modelo declarou; as declaradas e não confirmadas vão para `notes`.
- 140 testes no `@buer/meta`, 307+ no monorepo. Nenhum toca a rede nem exige credencial.

**Falta a Task 8: a primeira rodada real.** Exige `ANTHROPIC_API_KEY` (ou `ant auth login`) e gasta dinheiro — é decisão do dono do projeto. Alvos: os 12 personagens dos três times da seção acima. Estimativa: ~US$ 4, em duas levas com leitura do relatório entre elas. O passo a passo está na Task 8 do plano.

### Débito registrado do pipeline

1. **Atribuição de `sources` dentro de um domínio é grosseira** — se o Game8 foi consultado em três URLs e citou o time X, as três viram `sources` de X. Melhor que o uniforme anterior, mas não é "só as fontes que o descreveram" no sentido estrito.
2. **`confidence` ainda não chega à tela.** A terceira defesa da §14.3 continua incompleta: nem a CLI nem o golden imprimem `confidence`. O que se fechou nesta fase foi a **fabricação** do valor (o motor derivava a confiança do time da taxa de preenchimento do roster), não a exibição.
3. **Uma variante por ficha.** Reconciliar variantes entre fontes exige julgamento que o pipeline não tem — casar "Xiangling ER" do Icy Veins com "Xiangling Vaporize" do Game8. Uma variante bem fundamentada é melhor que três inventadas; o revisor humano divide.

### Fontes para a curadoria (decidido 2026-08-25)

O pipeline de autoria deve pesquisar e **citar** fontes de referência da comunidade, preenchendo `MetaProvenance.sources` com URLs. Preferência do dono do projeto, nesta ordem:

1. **Icy Veins** — guias de build por personagem
2. **Game8** — builds, times e prioridade de talento
3. **genshin-builds** — dado estruturado de build e times

Isso é **pesquisa com citação**, não scraping: a saída é uma ficha autorada, revisável, com as URLs em `sources`, e é o que finalmente faz `confidence: "high"` ser alcançável (hoje todas as 10 fichas estão em `"medium"` com `sources: []`, porque nenhuma cita nada).

### Herdado da Fase 1, ainda aberto

- `asc` (ascensão do personagem) vem sempre 0 — o payload não expõe `base.promote_level` do personagem. Não afeta a Fase 2 (usa stats observados); **afeta a Fase 3**, que precisa dele para calcular stats base.
- Faltam tabelas de tier 3★/4★ → a qualidade de roll degrada em peça não-5★, com ressalva visível na saída.
- Postgres provisionado (Neon), OAuth/login, bundle da CLI, pipeline de imagens, seletor de conta no site.

---

## Fase 3 — o avaliador analítico (PRÓXIMO)

**O que destrava:** comparar builds hipotéticas. Hoje o motor julga o que está equipado; não sabe dizer se trocar a ampulheta melhora.

**A costura já existe:** `StatResolver` (`packages/engine/src/stat-resolver.ts`). A Fase 2 entrega `ObservedStatResolver` (lê da captura); a Fase 3 entrega `ComputedStatResolver` (curvas + ascensão + arma + artefatos + bônus de set). **Mesma interface, mesmas fichas, mesmo avaliador, mesmo scoring.** Um teste da `contract-suite` já verifica que build sem `observedStats` sai por `canHandle` com razões, nunca por exceção — é essa a prova de que a troca funcionou.

**O que precisa vendorizar:** as tabelas de scaling do gi-data (curvas de personagem, ascensão, talentos, arma), deliberadamente fora da Fase 1 (ver `packages/gi-data/vendor/SOURCES.md`).
