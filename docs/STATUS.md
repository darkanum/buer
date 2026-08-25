# Buer — Status & Handoff

**Atualizado:** 2026-08-24
**Branch:** `design/onewash-fase-1` · **PR:** https://github.com/darkanum/buer/pull/1
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

## Fase 2 — o motor de análise (PRÓXIMO)

**Objetivo:** preencher o esqueleto de interfaces do motor (§6 da spec de Fase 1) com regras reais: avaliar a build atual, propor build ideal (set/main-stats/substats/arma), sugerir times, e sugerir aquisições.

**Insumos pra começar (grounding do brainstorm de Fase 2):**
- As interfaces já existem: `packages/engine/src/interfaces.ts` (`BuildEvaluator` `curated`→`analytic`→`simulation`, `BuildSearcher`, `TeamEvaluator`, `RosterAdvisor`, `GameDataProvider`, etc.) + `contractSuite` reutilizável.
- Spec de Fase 1: `docs/superpowers/specs/2026-08-24-onewash-design.md` (§6 = contratos do motor).
- Dado real pra calibrar: um roster de 63 personagens (extração validada).
- Pesquisa de domínio já feita (na sessão de brainstorm de Fase 1): curado-primeiro; GO acoplou solver+fórmula (não repetir); gcsim resolve energia/ICD/rotação (caro); scores de time abertos são pesos mágicos sem calibração → validar contra Abyss/Theater é questão em aberto.

**Decisões abertas pro brainstorm de Fase 2:**
- Começar por qual avaliador — `curated` (regras de meta escritas à mão, rápido de mostrar valor) vs `analytic` (cálculo de dano, exige as tabelas de scaling do gi-data que NÃO foram vendorizadas na Fase 1)?
- De onde vem o "meta" curado (KQM/comunidade) e como mantê-lo versionado/auditável?
- Precisamos das tabelas de scaling (curvas/ascensão/talentos/arma) — segundo ciclo do gi-data.
- Métrica de validação: como saber que uma build/time sugerido é "bom"?

**Recomendação:** começar a Fase 2 num contexto limpo (sessão nova / `/clear`), usando este STATUS.md + a §6 da spec + o roster real como grounding, e rodar o brainstorm de Fase 2 a partir daí.
