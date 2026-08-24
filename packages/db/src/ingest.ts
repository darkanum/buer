// Task 3.2 — gravação transacional de snapshot (dedupe + advisory lock + timeline).
// Spec: docs/superpowers/specs/2026-08-24-onewash-design.md §5.4-§5.9.
//
// A CRUX: `app.character_state.content_hash` é GENERATED ALWAYS AS (sha256(doc_canon))
// STORED. Para que esse hash calculado pelo Postgres coincida com
// `@buer/core`'s `contentHash(doc)`, o `doc_canon` gravado TEM que ser
// exatamente `canonBytes(doc)` — os mesmos bytes que o core hasheou. Dado isso,
// dedupe e detecção de mudança são feitos comparando o `state_id` resolvido via
// o `content_hash` computado pelo BANCO (nunca comparando strings de hash calculadas
// em JS), porque é o valor do Postgres que é a fonte da verdade de identidade.

import { sql } from 'drizzle-orm';
import type { PgDatabase } from 'drizzle-orm/pg-core';
import { canonBytes, type NormalizedSnapshot } from '@buer/core';
import * as schema from './schema/index.js';

/**
 * Qualquer client Drizzle Postgres-compatível (node-postgres em produção,
 * PGlite em teste) que compartilhe o mesmo schema tipado. O primeiro genérico
 * de `PgDatabase` (o "query result HKT") varia por driver — usar `any` aqui é
 * o que permite `writeSnapshot` aceitar tanto `Database` (src/client.ts) quanto
 * a instância PGlite de `test/helpers.ts` sem duplicar tipos por driver.
 */
export type IngestDb = PgDatabase<any, typeof schema>;

export interface WriteSnapshotArgs {
  accountId: bigint;
  takenAt: Date;
  parserVersion: number;
  docSchema: number;
  lang: string;
  /** sha256 do raw bruto. Precisa já existir em `app.raw_object` (FK) — omitir/`null` se não houver raw persistido. */
  rawSha256?: Buffer | null;
  normalized: NormalizedSnapshot;
  idempotencyKey?: string | null;
  cliVersion?: string | null;
}

export interface WriteSnapshotResult {
  snapshotId: bigint;
  changedChars: number;
  deduped: boolean;
}

interface SnapshotIdRow {
  snapshot_id: string;
}
interface ExistingSnapshotRow {
  snapshot_id: string;
}
interface StateIdRow {
  state_id: string;
}
interface PromotedRow {
  char_level: number;
  ascension: number;
  constellation: number;
  weapon_id: number | null;
  weapon_refine: number | null;
}

/**
 * Classificador best-effort de `change_event.kind` a partir apenas das colunas
 * promovidas (as únicas que já temos em mãos sem detoast do doc_canon). Uma
 * classificação completa (que também cobre artefatos/talentos via diff do doc)
 * é responsabilidade de `diffSnapshots` (Marco 8, leitura) — aqui só evitamos
 * inserir um `kind` sem sentido quando o diff já está disponível de graça.
 */
function bestEffortKind(before: PromotedRow, after: { charLevel: number; ascension: number; constellation: number; weaponId: number; weaponRefine: number }): string {
  if (before.constellation !== after.constellation) return 'constellation';
  if (before.ascension !== after.ascension) return 'ascension';
  if (before.weapon_id !== after.weaponId) return 'weapon_change';
  if (before.weapon_refine !== after.weaponRefine) return 'weapon_refine';
  if (before.char_level !== after.charLevel) return 'level_up';
  // Mudança só visível no doc completo (talentos/artefatos) — fora do alcance
  // das colunas promovidas; fica para a leitura (diffSnapshots) refinar.
  return 'state_change';
}

/**
 * Grava um snapshot normalizado dentro de uma única transação:
 *  1. advisory lock por conta (serializa qualquer escrita concorrente na timeline
 *     dessa conta — é isso que torna "no máximo um intervalo aberto" seguro sem
 *     EXCLUDE gist);
 *  2. insere `app.snapshot` (ou, se `idempotencyKey` já foi usado por essa conta,
 *     devolve o snapshot existente sem tocar em character_state/timeline);
 *  3. para cada personagem do `normalized`: upsert em `app.character_state` via
 *     `ON CONFLICT (account_id, doc_schema, content_hash) DO NOTHING` (dedupe pelo
 *     hash GERADO pelo Postgres a partir do `doc_canon` inserido — nunca por um
 *     hash calculado em JS), resolve o `state_id` (recém-inserido OU pré-existente)
 *     com um SELECT por `sha256($doc_canon::bytea)`, e compara esse `state_id` com
 *     o intervalo aberto atual da timeline para decidir: personagem novo → abre
 *     intervalo; mesmo estado → só atualiza `last_seen_at`; estado diferente →
 *     fecha o intervalo antigo, abre um novo, emite `change_event`;
 *  4. grava `changed_chars` no snapshot.
 */
export async function writeSnapshot(db: IngestDb, args: WriteSnapshotArgs): Promise<WriteSnapshotResult> {
  return db.transaction(async (tx) => {
    // 1. Advisory lock por conta — primeira instrução da transação (spec §5.6).
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtextextended('buer.account'::text, ${args.accountId.toString()}::bigint))`,
    );

    const accountHashBytes = Buffer.from(args.normalized.accountHash, 'hex');
    const observedChars = args.normalized.characters.length;
    const accountIdStr = args.accountId.toString();
    const rawSha256Param = args.rawSha256 ?? null;
    const cliVersionParam = args.cliVersion ?? null;

    // 2. snapshot: dedupe por idempotency_key quando fornecida. NULL nunca colide
    // em UNIQUE (semântica padrão do Postgres), então só entra nesse caminho
    // quando a chave é uma string real.
    let snapshotId: bigint;
    if (args.idempotencyKey) {
      const inserted = await tx.execute(sql`
        INSERT INTO app.snapshot
          (account_id, taken_at, parser_version, doc_schema, lang, raw_sha256,
           account_hash, observed_chars, idempotency_key, cli_version)
        VALUES (${accountIdStr}::bigint, ${args.takenAt}, ${args.parserVersion}, ${args.docSchema},
                ${args.lang}, ${rawSha256Param}, ${accountHashBytes}, ${observedChars},
                ${args.idempotencyKey}, ${cliVersionParam})
        ON CONFLICT (account_id, idempotency_key) DO NOTHING
        RETURNING snapshot_id
      `);
      const insertedRows = (inserted as { rows: SnapshotIdRow[] }).rows;
      if (insertedRows.length === 0) {
        // idempotency_key já usado por essa conta: dedupe no nível de snapshot —
        // devolve o snapshot existente, sem tocar em character_state/timeline.
        const existing = await tx.execute(sql`
          SELECT snapshot_id FROM app.snapshot
          WHERE account_id = ${accountIdStr}::bigint AND idempotency_key = ${args.idempotencyKey}
        `);
        const existingRows = (existing as { rows: ExistingSnapshotRow[] }).rows;
        const row = existingRows[0];
        if (!row) throw new Error('writeSnapshot: idempotency_key em conflito mas snapshot existente não encontrado');
        return { snapshotId: BigInt(row.snapshot_id), changedChars: 0, deduped: true };
      }
      snapshotId = BigInt(insertedRows[0]!.snapshot_id);
    } else {
      const inserted = await tx.execute(sql`
        INSERT INTO app.snapshot
          (account_id, taken_at, parser_version, doc_schema, lang, raw_sha256,
           account_hash, observed_chars, cli_version)
        VALUES (${accountIdStr}::bigint, ${args.takenAt}, ${args.parserVersion}, ${args.docSchema},
                ${args.lang}, ${rawSha256Param}, ${accountHashBytes}, ${observedChars}, ${cliVersionParam})
        RETURNING snapshot_id
      `);
      const insertedRows = (inserted as { rows: SnapshotIdRow[] }).rows;
      snapshotId = BigInt(insertedRows[0]!.snapshot_id);
    }
    const snapshotIdStr = snapshotId.toString();

    // 3. Por personagem: upsert content-addressed + manutenção da timeline.
    let changedChars = 0;
    for (const c of args.normalized.characters) {
      // A CRUX: doc_canon É canonBytes(c.doc) — os mesmos bytes que
      // @buer/core hasheou para c.contentHash / normalized.accountHash.
      // sha256(doc_canon) computado pelo Postgres (coluna gerada) portanto
      // coincide byte-a-byte com contentHash(c.doc) calculado em JS.
      const docCanon = Buffer.from(canonBytes(c.doc));

      await tx.execute(sql`
        INSERT INTO app.character_state
          (account_id, char_key, doc_schema, doc_canon, char_level, ascension,
           constellation, weapon_id, weapon_refine)
        VALUES (${accountIdStr}::bigint, ${c.charKey}, ${args.docSchema}, ${docCanon},
                ${c.promoted.charLevel}, ${c.promoted.ascension}, ${c.promoted.constellation},
                ${c.promoted.weaponId}, ${c.promoted.weaponRefine})
        ON CONFLICT (account_id, doc_schema, content_hash) DO NOTHING
      `);

      // ON CONFLICT DO NOTHING RETURNING não devolve nada em caso de conflito —
      // um SELECT de acompanhamento pelo hash GERADO é a forma confiável de
      // obter o state_id, tenha a linha sido inserida agora ou já existisse.
      const stateRes = await tx.execute(sql`
        SELECT state_id FROM app.character_state
        WHERE account_id = ${accountIdStr}::bigint AND doc_schema = ${args.docSchema}
          AND content_hash = sha256(${docCanon}::bytea)
      `);
      const stateRow = (stateRes as { rows: StateIdRow[] }).rows[0];
      if (!stateRow) {
        throw new Error(`writeSnapshot: falha ao resolver state_id para char_key=${c.charKey}`);
      }
      const stateId = BigInt(stateRow.state_id);

      // Intervalo aberto atual (no máximo um, garantido por
      // character_timeline_one_open) para esse personagem/conta/doc_schema.
      const openRes = await tx.execute(sql`
        SELECT state_id FROM app.character_timeline
        WHERE account_id = ${accountIdStr}::bigint AND char_key = ${c.charKey}
          AND doc_schema = ${args.docSchema} AND valid_to IS NULL
      `);
      const openRow = (openRes as { rows: StateIdRow[] }).rows[0];

      if (!openRow) {
        // Personagem observado por essa conta pela primeira vez: abre intervalo.
        await tx.execute(sql`
          INSERT INTO app.character_timeline
            (account_id, char_key, doc_schema, valid_from, valid_to, last_seen_at,
             closed_by, state_id, from_snapshot)
          VALUES (${accountIdStr}::bigint, ${c.charKey}, ${args.docSchema}, ${args.takenAt},
                  NULL, ${args.takenAt}, 'open', ${stateId.toString()}::bigint, ${snapshotIdStr}::bigint)
        `);
        changedChars++;
        continue;
      }

      const openStateId = BigInt(openRow.state_id);
      if (openStateId === stateId) {
        // Estado idêntico ao intervalo aberto (dedupe via content_hash): só
        // registra que a conta ainda foi observada nesse instante.
        await tx.execute(sql`
          UPDATE app.character_timeline
          SET last_seen_at = ${args.takenAt}
          WHERE account_id = ${accountIdStr}::bigint AND char_key = ${c.charKey}
            AND doc_schema = ${args.docSchema} AND valid_to IS NULL
        `);
        continue;
      }

      // Estado mudou: fecha o intervalo antigo, abre um novo, emite change_event.
      const promotedRes = await tx.execute(sql`
        SELECT char_level, ascension, constellation, weapon_id, weapon_refine
        FROM app.character_state WHERE state_id = ${openRow.state_id}::bigint
      `);
      const beforeRow = (promotedRes as { rows: PromotedRow[] }).rows[0];

      await tx.execute(sql`
        UPDATE app.character_timeline
        SET valid_to = ${args.takenAt}, closed_by = 'change'
        WHERE account_id = ${accountIdStr}::bigint AND char_key = ${c.charKey}
          AND doc_schema = ${args.docSchema} AND valid_to IS NULL
      `);
      await tx.execute(sql`
        INSERT INTO app.character_timeline
          (account_id, char_key, doc_schema, valid_from, valid_to, last_seen_at,
           closed_by, state_id, from_snapshot)
        VALUES (${accountIdStr}::bigint, ${c.charKey}, ${args.docSchema}, ${args.takenAt},
                NULL, ${args.takenAt}, 'open', ${stateId.toString()}::bigint, ${snapshotIdStr}::bigint)
      `);

      const kind = beforeRow ? bestEffortKind(beforeRow, c.promoted) : 'state_change';
      const payload = JSON.stringify({
        fromStateId: openRow.state_id,
        toStateId: stateId.toString(),
      });
      await tx.execute(sql`
        INSERT INTO app.change_event
          (account_id, char_key, observed_at, window_from, detected_in, kind, payload)
        VALUES (${accountIdStr}::bigint, ${c.charKey}, ${args.takenAt}, ${args.takenAt},
                ${snapshotIdStr}::bigint, ${kind}, ${payload}::jsonb)
      `);
      changedChars++;
    }

    // 4. changed_chars fica só sabido depois de processar todos os personagens.
    await tx.execute(sql`
      UPDATE app.snapshot SET changed_chars = ${changedChars} WHERE snapshot_id = ${snapshotIdStr}::bigint
    `);

    return { snapshotId, changedChars, deduped: changedChars === 0 };
  });
}
