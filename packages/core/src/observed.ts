import { loadProperty } from '@buer/gi-data';
import type { StatKey } from './substat.js';
import type { ObservedStats } from './domain.js';

const PROPERTY_MAP = loadProperty();

/**
 * Os quatro blocos em que o HoYoLAB reporta stats finais de personagem.
 * A ordem importa: os últimos sobrescrevem os primeiros quando repetem um
 * id, e `selected_properties` é o bloco autoritativo (traz HP/ATK/DEF
 * finais, crit, ER e maestria já somados). `element_properties` entra por
 * último só para preencher os bônus elementais que os outros não trazem.
 */
const BLOCKS = ['base_properties', 'extra_properties', 'selected_properties', 'element_properties'] as const;

interface PropEntry {
  property_type?: unknown;
  final?: unknown;
}

/** "78.6%" -> 78.6 ; "19884" -> 19884 ; "" / lixo -> null. */
function parseFinal(raw: unknown): number | null {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  if (typeof raw !== 'string') return null;
  const n = Number.parseFloat(raw.replace('%', '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

/**
 * Payload cru de um personagem (um item de `detail.list`) → stats finais.
 *
 * Não lança nunca: um id que a tabela FightProp conhece mas que não tem
 * `StatKey` equivalente (RES elemental, redução de recarga, stamina) é
 * PULADO por design, e um id que ela não conhece também — este módulo é
 * leitura de telemetria de conta, não a borda de validação de artefato.
 * A borda que exige fail-loud é `propKey()` em normalize.ts, e ela continua
 * como está.
 */
export function extractObservedStats(entry: unknown): ObservedStats {
  if (entry === null || typeof entry !== 'object') return {};
  const source = entry as Record<string, unknown>;
  const out: Record<string, number> = {};

  for (const block of BLOCKS) {
    const list = source[block];
    if (!Array.isArray(list)) continue;
    for (const item of list as PropEntry[]) {
      const id = typeof item?.property_type === 'number' ? item.property_type : null;
      if (id === null) continue;
      const goodKey = PROPERTY_MAP[id]?.goodKey;
      if (!goodKey) continue;
      const value = parseFinal(item.final);
      if (value === null) continue;
      out[goodKey satisfies string] = value;
    }
  }

  return out as Readonly<Partial<Record<StatKey, number>>>;
}
