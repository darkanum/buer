// Task 8.3 — screen 4 (design spec §4.1): character detail. Identity,
// constellations, talents, full attributes, weapon, the 5 artifacts with
// main+substats, active set-piece counts, PLUS a reserved analysis panel
// that renders an honest empty state (the design explicitly requires
// reserving this layout slot now, for the second-cycle engine — see
// @onewash/engine's BuildEvaluator/Score, not wired here on purpose: mapping
// a persisted CharacterDoc into a Build/EvaluationContext is exactly the
// "segundo ciclo" work the spec defers, §11).

import { notFound } from 'next/navigation';
import Link from 'next/link';
import { requireAccount } from '../../../lib/session.js';
import { db } from '../../../lib/db.js';
import {
  ARTIFACT_SLOT_LABELS,
  describeArtifactSet,
  describeCharacter,
  describeProperty,
  describeWeapon,
  formatStatValue,
  getCharacter,
} from '../../../lib/render.js';

interface CharacterDetailPageProps {
  params: Promise<{ key: string }>;
}

export default async function CharacterDetailPage({ params }: CharacterDetailPageProps) {
  const { account } = await requireAccount();
  const { key } = await params;
  const charKey = decodeURIComponent(key);

  const character = await getCharacter(db, account.accountId, charKey);
  if (!character) notFound();

  const info = describeCharacter(charKey);
  const weaponInfo = describeWeapon(character.doc.weapon.id);

  // Active set-piece counts (how many pieces of each set are currently
  // equipped) — NOT the bonus TEXT. Set-bonus effect descriptions aren't in
  // @onewash/gi-data yet (§5.1: catalog carries no effect/description
  // column by design), so this reports what's verifiable from the doc
  // (piece counts crossing the 2pc/4pc thresholds) without inventing wording
  // for what those thresholds actually do.
  const setCounts = new Map<number, number>();
  for (const a of character.doc.artifacts) {
    setCounts.set(a.set, (setCounts.get(a.set) ?? 0) + 1);
  }

  return (
    <main style={{ maxWidth: 860, margin: '0 auto', padding: '2rem 1rem', fontFamily: 'system-ui, sans-serif' }}>
      <p>
        <Link href="/characters">&larr; voltar ao grid</Link>
      </p>

      <header style={{ marginBottom: '1.5rem' }}>
        <h1 style={{ margin: 0 }}>{info.displayName}</h1>
        <p style={{ margin: '0.25rem 0 0', color: '#888' }}>
          {info.element ?? '—'} · {info.rarity ? `${info.rarity}★` : '?★'} · char_key {character.charKey}
        </p>
      </header>

      <section style={{ marginBottom: '1.5rem' }}>
        <h2>Identidade e progressão</h2>
        <dl style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '0.25rem 1rem', margin: 0 }}>
          <dt>Nível</dt>
          <dd>{character.doc.lvl}</dd>
          <dt>Ascensão</dt>
          <dd>{character.doc.asc}</dd>
          <dt>Constelação</dt>
          <dd>C{character.doc.cons}</dd>
          <dt>Amizade</dt>
          <dd>{character.doc.friend}</dd>
        </dl>
      </section>

      <section style={{ marginBottom: '1.5rem' }}>
        <h2>Talentos</h2>
        {character.doc.talents.length === 0 ? (
          <p>Nenhum talento observado.</p>
        ) : (
          <ul>
            {character.doc.talents.map(([talentId, level]) => (
              <li key={talentId}>
                Talento {talentId}: nível {level}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section style={{ marginBottom: '1.5rem' }}>
        <h2>Arma</h2>
        <dl style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '0.25rem 1rem', margin: 0 }}>
          <dt>Nome</dt>
          <dd>
            {weaponInfo.displayName} {weaponInfo.rarity ? `(${weaponInfo.rarity}★)` : ''}
          </dd>
          <dt>Nível</dt>
          <dd>{character.doc.weapon.lvl}</dd>
          <dt>Refinamento</dt>
          <dd>R{character.doc.weapon.refine}</dd>
        </dl>
      </section>

      <section style={{ marginBottom: '1.5rem' }}>
        <h2>Artefatos</h2>
        {character.doc.artifacts.length === 0 ? (
          <p>Nenhum artefato equipado.</p>
        ) : (
          <div style={{ display: 'grid', gap: '0.75rem' }}>
            {character.doc.artifacts.map((a) => {
              const setInfo = describeArtifactSet(a.set);
              const mainProp = describeProperty(a.main[0]);
              return (
                <div key={a.slot} style={{ border: '1px solid #333', borderRadius: 8, padding: '0.75rem 1rem' }}>
                  <div style={{ fontWeight: 600 }}>
                    {ARTIFACT_SLOT_LABELS[a.slot]} · {setInfo.displayName} · {a.rarity}★ · +{a.lvl}
                  </div>
                  <div style={{ margin: '0.25rem 0' }}>
                    Principal: {mainProp.label} {formatStatValue(a.main[0], a.main[1])}
                  </div>
                  <ul style={{ margin: 0 }}>
                    {a.subs.map(([propId, value, tier]) => {
                      const sub = describeProperty(propId);
                      return (
                        <li key={propId}>
                          {sub.label} +{formatStatValue(propId, value)} (tier {tier})
                        </li>
                      );
                    })}
                  </ul>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section style={{ marginBottom: '1.5rem' }}>
        <h2>Bônus de conjunto</h2>
        {setCounts.size === 0 ? (
          <p>Nenhum conjunto ativo.</p>
        ) : (
          <ul>
            {Array.from(setCounts.entries()).map(([setId, count]) => {
              const setInfo = describeArtifactSet(setId);
              const active = [count >= 2 ? '2 peças' : null, count >= 4 ? '4 peças' : null].filter(Boolean);
              return (
                <li key={setId}>
                  {setInfo.displayName}: {count} peça(s){active.length > 0 ? ` — bônus ativo: ${active.join(', ')}` : ''}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* Painel de análise reservado (design spec §4.1) — a UI intencionalmente
          existe e ocupa layout agora, para o motor do segundo ciclo (ver
          @onewash/engine's BuildEvaluator) encaixar aqui sem precisar de uma
          segunda passada de design. Estado vazio honesto: nenhuma nota,
          score ou sugestão é calculada ou inventada nesta fase. */}
      <section style={{ border: '1px dashed #444', borderRadius: 8, padding: '1rem' }}>
        <h2 style={{ marginTop: 0 }}>Análise de build</h2>
        <p style={{ color: '#888', margin: 0 }}>Análise ainda não disponível.</p>
      </section>
    </main>
  );
}
