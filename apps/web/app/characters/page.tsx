// Task 8.3 — screen 3 (design spec §4.1): character grid. Cards (portrait,
// element, level, constellations, rarity), filter/sort, account header
// (nickname, UID, last-sync date). Server Component: reads the DB directly
// via lib/render.ts, no client-side fetch of the app's own data. Filter/sort
// are plain `<a href="?...">` links + a GET `<form>` — no client JS needed.

import Link from 'next/link';
import { requireAccount } from '../../lib/session.js';
import { db } from '../../lib/db.js';
import { describeCharacter, getAccountView, type RosterCharacter } from '../../lib/render.js';

type SortKey = 'level' | 'rarity' | 'name' | 'constellation';

interface CharactersPageProps {
  searchParams: Promise<{ sort?: string; element?: string }>;
}

const SORT_LABELS: Record<SortKey, string> = {
  level: 'Nível',
  rarity: 'Raridade',
  name: 'Nome',
  constellation: 'Constelação',
};

function isSortKey(v: string | undefined): v is SortKey {
  return v === 'level' || v === 'rarity' || v === 'name' || v === 'constellation';
}

function sortRoster(roster: RosterCharacter[], sort: SortKey) {
  const withInfo = roster.map((r) => ({ r, info: describeCharacter(r.charKey) }));
  withInfo.sort((a, b) => {
    switch (sort) {
      case 'level':
        return b.r.promoted.charLevel - a.r.promoted.charLevel;
      case 'rarity':
        return (b.info.rarity ?? 0) - (a.info.rarity ?? 0);
      case 'constellation':
        return b.r.promoted.constellation - a.r.promoted.constellation;
      case 'name':
      default:
        return a.info.displayName.localeCompare(b.info.displayName);
    }
  });
  return withInfo;
}

export default async function CharactersPage({ searchParams }: CharactersPageProps) {
  const { account } = await requireAccount();
  const params = await searchParams;
  const sort: SortKey = isSortKey(params.sort) ? params.sort : 'level';
  const elementFilter = params.element?.toLowerCase();

  const roster = await getAccountView(db, account.accountId);
  const filtered = elementFilter
    ? roster.filter((r) => describeCharacter(r.charKey).element === elementFilter)
    : roster;
  const sorted = sortRoster(filtered, sort);

  const elements = Array.from(
    new Set(roster.map((r) => describeCharacter(r.charKey).element).filter((e): e is string => Boolean(e))),
  ).sort();

  const linkWith = (overrides: Record<string, string | undefined>): string => {
    const next = new URLSearchParams();
    const merged = { sort, element: elementFilter, ...overrides };
    for (const [k, v] of Object.entries(merged)) if (v) next.set(k, v);
    const qs = next.toString();
    return qs ? `/characters?${qs}` : '/characters';
  };

  return (
    <main style={{ maxWidth: 1080, margin: '0 auto', padding: '2rem 1rem', fontFamily: 'system-ui, sans-serif' }}>
      <header style={{ marginBottom: '1.5rem', borderBottom: '1px solid #333', paddingBottom: '1rem' }}>
        <h1 style={{ margin: 0 }}>{account.nickname ?? 'Sua conta'}</h1>
        <p style={{ margin: '0.25rem 0 0', color: '#888' }}>
          UID {account.gameUid} ({account.region})
          {' · '}
          {roster.length} personagem(ns)
          {' · '}
          último sync:{' '}
          {account.lastSyncAt ? account.lastSyncAt.toLocaleString('pt-PT') : 'nunca'}
          {/* AR (Adventure Rank) não é persistido em app.account nesta fase —
              não é reconstruído nem fabricado aqui; ver task-8.3-report.md. */}
        </p>
      </header>

      <nav style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', marginBottom: '1.5rem', alignItems: 'baseline' }}>
        <span>
          Ordenar:{' '}
          {(Object.keys(SORT_LABELS) as SortKey[]).map((key) => (
            <Link
              key={key}
              href={linkWith({ sort: key })}
              style={{ marginRight: '0.75rem', fontWeight: key === sort ? 700 : 400 }}
            >
              {SORT_LABELS[key]}
            </Link>
          ))}
        </span>
        {elements.length > 0 ? (
          <span>
            Elemento:{' '}
            <Link href={linkWith({ element: undefined })} style={{ marginRight: '0.75rem', fontWeight: elementFilter ? 400 : 700 }}>
              Todos
            </Link>
            {elements.map((el) => (
              <Link
                key={el}
                href={linkWith({ element: el })}
                style={{ marginRight: '0.75rem', fontWeight: el === elementFilter ? 700 : 400 }}
              >
                {el}
              </Link>
            ))}
          </span>
        ) : null}
      </nav>

      {sorted.length === 0 ? (
        <p>Nenhum personagem encontrado.</p>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '1rem' }}>
          {sorted.map(({ r, info }) => (
            <Link
              key={r.charKey}
              href={`/characters/${encodeURIComponent(r.charKey)}`}
              style={{
                display: 'block',
                border: '1px solid #333',
                borderRadius: 8,
                padding: '0.75rem',
                textDecoration: 'none',
                color: 'inherit',
              }}
            >
              {/* Portrait: no icon URL survives into doc_canon or the gi-data
                  catalog by design (§5.1: catalog carries no icon column) —
                  an honest placeholder badge stands in until a future task
                  wires a per-character image source end to end. */}
              <div
                aria-hidden
                style={{
                  width: '100%',
                  aspectRatio: '1 / 1',
                  borderRadius: 6,
                  background: '#222',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '1.5rem',
                  fontWeight: 700,
                  marginBottom: '0.5rem',
                }}
              >
                {info.displayName.charAt(0)}
              </div>
              <div style={{ fontWeight: 600 }}>{info.displayName}</div>
              <div style={{ fontSize: '0.85rem', color: '#888' }}>
                {info.element ?? '—'} · {info.rarity ? `${info.rarity}★` : '?★'}
              </div>
              <div style={{ fontSize: '0.85rem' }}>
                Nv. {r.promoted.charLevel} · C{r.promoted.constellation}
              </div>
            </Link>
          ))}
        </div>
      )}
    </main>
  );
}
