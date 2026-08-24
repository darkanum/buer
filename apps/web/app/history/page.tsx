// Task 8.3 — screen 5 (design spec §4.1): snapshot-date selector + a diff
// view between two snapshots, built on getAccountViewAt + diffSnapshots
// (§5.11's level (2) semantic diff).

import Link from 'next/link';
import { requireAccount } from '../../lib/session.js';
import { db } from '../../lib/db.js';
import {
  ARTIFACT_SLOT_LABELS,
  describeCharacter,
  diffSnapshots,
  getAccountViewAt,
  listSnapshots,
  type ChangeKind,
  type RosterChange,
  type SnapshotSummary,
} from '../../lib/render.js';

interface HistoryPageProps {
  searchParams: Promise<{ before?: string; after?: string }>;
}

const CHANGE_LABELS: Record<ChangeKind, string> = {
  character_new: 'Personagem observado por aqui pela primeira vez',
  level_up: 'Nível',
  ascension: 'Ascensão',
  constellation: 'Constelação',
  talent_up: 'Talento',
  weapon_change: 'Arma trocada',
  weapon_refine: 'Refinamento da arma',
  artifact_equip: 'Artefato equipado',
  artifact_upgrade: 'Artefato aprimorado (mesma peça, nível maior)',
  artifact_swap: 'Artefato trocado (peça diferente)',
};

function describeChange(change: RosterChange): string {
  const label = CHANGE_LABELS[change.kind];
  if (change.kind === 'talent_up') {
    return `${label} ${change.key}: ${change.before} → ${change.after}`;
  }
  if (change.kind === 'artifact_upgrade' || change.kind === 'artifact_swap' || change.kind === 'artifact_equip') {
    const slot = change.key ? ARTIFACT_SLOT_LABELS[change.key as 1 | 2 | 3 | 4 | 5] : '?';
    if (change.kind === 'artifact_equip') return `${label}: ${slot}`;
    return `${label}: ${slot} (+${change.before} → +${change.after})`;
  }
  if (change.before !== undefined && change.after !== undefined) {
    return `${label}: ${change.before} → ${change.after}`;
  }
  return label;
}

function findSnapshot(snapshots: SnapshotSummary[], idParam: string | undefined) {
  if (!idParam) return undefined;
  return snapshots.find((s) => s.snapshotId.toString() === idParam);
}

export default async function HistoryPage({ searchParams }: HistoryPageProps) {
  const { account } = await requireAccount();
  const params = await searchParams;

  const snapshots = await listSnapshots(db, account.accountId);

  // Defaults: the two most recent snapshots (index 0 = newest, per
  // listSnapshots' ORDER BY taken_at DESC), so the page is useful with zero
  // query params.
  const afterSnapshot = findSnapshot(snapshots, params.after) ?? snapshots[0];
  const beforeSnapshot = findSnapshot(snapshots, params.before) ?? snapshots[1];

  const changes: RosterChange[] =
    beforeSnapshot && afterSnapshot && beforeSnapshot.snapshotId !== afterSnapshot.snapshotId
      ? diffSnapshots(
          await getAccountViewAt(db, account.accountId, beforeSnapshot.takenAt),
          await getAccountViewAt(db, account.accountId, afterSnapshot.takenAt),
        )
      : [];

  const changesByChar = new Map<string, RosterChange[]>();
  for (const c of changes) {
    const list = changesByChar.get(c.charKey) ?? [];
    list.push(c);
    changesByChar.set(c.charKey, list);
  }

  return (
    <main style={{ maxWidth: 860, margin: '0 auto', padding: '2rem 1rem', fontFamily: 'system-ui, sans-serif' }}>
      <p>
        <Link href="/characters">&larr; voltar ao grid</Link>
      </p>
      <h1>Histórico</h1>

      {snapshots.length < 2 ? (
        <p>É preciso pelo menos 2 sincronizações para comparar o histórico.</p>
      ) : (
        <>
          <form method="get" style={{ display: 'flex', gap: '1rem', alignItems: 'end', marginBottom: '1.5rem', flexWrap: 'wrap' }}>
            <label>
              De:
              <br />
              <select name="before" defaultValue={beforeSnapshot?.snapshotId.toString()}>
                {snapshots.map((s) => (
                  <option key={s.snapshotId.toString()} value={s.snapshotId.toString()}>
                    {s.takenAt.toLocaleString('pt-PT')}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Para:
              <br />
              <select name="after" defaultValue={afterSnapshot?.snapshotId.toString()}>
                {snapshots.map((s) => (
                  <option key={s.snapshotId.toString()} value={s.snapshotId.toString()}>
                    {s.takenAt.toLocaleString('pt-PT')}
                  </option>
                ))}
              </select>
            </label>
            <button type="submit">Comparar</button>
          </form>

          {changesByChar.size === 0 ? (
            <p>Nenhuma mudança entre esses dois snapshots.</p>
          ) : (
            <div style={{ display: 'grid', gap: '1rem' }}>
              {Array.from(changesByChar.entries()).map(([charKey, charChanges]) => {
                const info = describeCharacter(charKey);
                return (
                  <div key={charKey} style={{ border: '1px solid #333', borderRadius: 8, padding: '0.75rem 1rem' }}>
                    <div style={{ fontWeight: 600, marginBottom: '0.25rem' }}>
                      <Link href={`/characters/${encodeURIComponent(charKey)}`}>{info.displayName}</Link>
                    </div>
                    <ul style={{ margin: 0 }}>
                      {charChanges.map((c, i) => (
                        <li key={i}>{describeChange(c)}</li>
                      ))}
                    </ul>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </main>
  );
}
