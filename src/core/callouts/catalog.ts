import type { CalloutMap } from './quiz';
import { EMPTY_STATS } from './quiz';

/**
 * Cartes livrees avec l'application.
 *
 * Chaque carte part de deux images fournies par l'equipe : le plan nu, sur
 * lequel on joue, et le plan annote, qui sert a reviser. Les positions sont
 * en fractions de l'image (0 a 1), relevees sur le plan annote.
 *
 * Pour ajouter une carte : deposer les images dans `src/assets/maps/`, les
 * importer ici, et ajouter une entree a BUILTIN_MAPS. Pour corriger une
 * carte, modifier ses endroits et incrementer `version` : la mise a jour
 * remplace les positions chez le joueur en gardant sa progression, tant que
 * l'identifiant de l'endroit ne change pas.
 */

export interface BuiltinCallout {
  /** Identifiant stable : c'est lui qui porte la progression du joueur. */
  id: string;
  name: string;
  x: number;
  y: number;
}

export interface BuiltinMap {
  /** Identifiant stable, prefixe par `builtin-`. */
  id: string;
  name: string;
  version: number;
  /** Plan nu, URL de l'image importee. */
  image: string;
  /** Plan annote, URL de l'image importee. */
  reference?: string;
  /** Largeur / hauteur du plan nu. */
  aspect: number;
  callouts: BuiltinCallout[];
}

export const BUILTIN_MAPS: BuiltinMap[] = [];

/**
 * Accorde les cartes enregistrees sur l'appareil avec le catalogue.
 *
 * Renvoie uniquement les cartes a (re)ecrire : nouvelles cartes du catalogue,
 * ou cartes dont la version a change. Les images sont toujours reprises du
 * catalogue, car leur URL change a chaque construction de l'application.
 */
export function syncBuiltin(
  stored: readonly CalloutMap[],
  catalog: readonly BuiltinMap[],
  now: string,
): CalloutMap[] {
  const out: CalloutMap[] = [];
  for (const b of catalog) {
    const existing = stored.find((m) => m.id === b.id);
    const sameImages =
      existing && existing.image === b.image && existing.reference === b.reference;
    if (existing && existing.builtin === b.version && sameImages) continue;

    const statsById = new Map(existing?.callouts.map((c) => [c.id, c.stats]) ?? []);
    out.push({
      id: b.id,
      name: b.name,
      image: b.image,
      reference: b.reference,
      aspect: b.aspect,
      builtin: b.version,
      callouts: b.callouts.map((c) => ({
        ...c,
        stats: { ...(statsById.get(c.id) ?? EMPTY_STATS) },
      })),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    });
  }
  return out;
}
