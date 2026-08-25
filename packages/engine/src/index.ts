export * from './interfaces.js';
// `contractSuite` (`./contract-suite.js`) NÃO é reexportado aqui — ele
// importa `vitest` no topo do módulo, e este é o índice de PRODUÇÃO do
// pacote: qualquer consumidor real (o comando `analyze` da CLI, entre
// outros) que importasse algo daqui arrastaria o runtime de teste para
// dentro do binário e quebraria fora do vitest (achado desta task, ao
// rodar `analyze` via `start:dev` — sem isto o comando nem chegava a
// imprimir o relatório). Os dois únicos consumidores (`test/contract.test.ts`
// e `test/curated/evaluator.test.ts`) já importam de `../src/contract-suite.js`
// direto — a reexportação nunca foi usada por ninguém, só pelo barril.
export { rosterFromHoyolab, equippedBuild } from './roster/from-hoyolab.js';
export { ObservedStatResolver } from './stat-resolver.js';
export type { StatResolver } from './stat-resolver.js';
export { assess } from './curated/scoring.js';
export type { CuratedAssessment } from './curated/scoring.js';
export { selectVariant } from './curated/variant.js';
export type { VariantChoice, SelectVariantOptions } from './curated/variant.js';
export { CuratedBuildEvaluator } from './curated/evaluator.js';
export type { CuratedBuildEvaluatorOptions } from './curated/evaluator.js';
export { statusFor } from './curated/findings.js';
export { defaultKeyNames } from './curated/names.js';
export type { KeyNames } from './curated/names.js';
export type { Finding, FindingStatus, CheckId } from './curated/findings.js';
export { DefaultEvaluatorRegistry } from './registry.js';
export { reactionsFor, resonanceFor } from './team/rules.js';
export { matchArchetype } from './team/matching.js';
export type { ArchetypeMatch, MatchOptions } from './team/matching.js';
export { CuratedTeamEvaluator } from './team/evaluator.js';
export type { TeamOption, TeamsForResult, CuratedTeamEvaluatorOptions } from './team/evaluator.js';
export { CuratedRosterAdvisor } from './advisor/advisor.js';
export type { CuratedRosterAdvisorOptions } from './advisor/advisor.js';
