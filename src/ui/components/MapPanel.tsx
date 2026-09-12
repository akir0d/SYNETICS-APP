import { useState } from 'react';
import type { AiEnvironment, KnownMap, MatchAnalysis } from '../../core/types';

interface MapPanelProps {
  analysis: MatchAnalysis;
  mapLibrary: readonly KnownMap[];
  environment: AiEnvironment | undefined;
  onConfirm: (name: string, existingId: string | null) => void;
}

/**
 * Identification de l'arene.
 *
 * L'application n'embarque aucune liste de cartes EVA : elle apprend des noms
 * que le joueur donne. Le panneau rend ce fonctionnement explicite plutot que
 * de laisser croire a une reconnaissance magique.
 */
export function MapPanel({ analysis, mapLibrary, environment, onConfirm }: MapPanelProps) {
  const { map } = analysis;
  const [name, setName] = useState(map.mapName);
  const [editing, setEditing] = useState(!map.mapName);

  const recognised = map.mapId !== null && !map.confirmed;
  const suggestion = mapLibrary.find((m) => m.id === map.mapId);

  const submit = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const existing = mapLibrary.find((m) => m.name.toLowerCase() === trimmed.toLowerCase());
    onConfirm(trimmed, existing?.id ?? null);
    setEditing(false);
  };

  return (
    <div className="card">
      <h2>Arene</h2>

      {map.confirmed && !editing && (
        <div className="row" style={{ marginBottom: 10 }}>
          <strong style={{ fontSize: 17 }}>{map.mapName}</strong>
          <span className="tag">confirmee</span>
          <div className="spacer" />
          <button className="btn-ghost" onClick={() => setEditing(true)}>
            Modifier
          </button>
        </div>
      )}

      {recognised && !editing && (
        <>
          <div className="row" style={{ marginBottom: 8 }}>
            <strong style={{ fontSize: 17 }}>{map.mapName}</strong>
            <span className="tag">reconnue a {Math.round(map.confidence * 100)} %</span>
          </div>
          <p className="hint">
            Cette arene ressemble a {suggestion ? `« ${suggestion.name} »` : 'une arene connue'}
            {suggestion ? ` (${suggestion.matchCount} match${suggestion.matchCount > 1 ? 's' : ''} de reference)` : ''}.
            Confirmez pour affiner la reconnaissance des prochains matchs.
          </p>
          <div className="row">
            <button className="btn" onClick={() => onConfirm(map.mapName, map.mapId)}>
              Confirmer
            </button>
            <button className="btn-ghost" onClick={() => setEditing(true)}>
              Ce n'est pas la bonne
            </button>
          </div>
        </>
      )}

      {!map.confirmed && !recognised && !editing && (
        <div className="row" style={{ marginBottom: 10 }}>
          <span className="hint" style={{ margin: 0 }}>Arene inconnue.</span>
          <div className="spacer" />
          <button className="btn-ghost" onClick={() => setEditing(true)}>
            Nommer l'arene
          </button>
        </div>
      )}

      {editing && (
        <>
          <div className="field">
            <label htmlFor="map-name">Nom de l'arene</label>
            <input
              id="map-name"
              type="text"
              list="map-library"
              value={name}
              placeholder="Par exemple : Hangar, Cite souterraine, Station..."
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') submit();
              }}
            />
            <datalist id="map-library">
              {mapLibrary.map((m) => (
                <option key={m.id} value={m.name} />
              ))}
            </datalist>
          </div>
          <div className="row" style={{ marginBottom: 10 }}>
            <button className="btn" onClick={submit} disabled={!name.trim()}>
              Enregistrer
            </button>
            {map.mapName && (
              <button className="btn-ghost" onClick={() => setEditing(false)}>
                Annuler
              </button>
            )}
          </div>
          <p className="hint" style={{ marginBottom: 0 }}>
            {mapLibrary.length === 0
              ? "Aucune arene enregistree pour l'instant : celle-ci sera la premiere. Les prochains matchs joues au meme endroit seront reconnus automatiquement."
              : `${mapLibrary.length} arene${mapLibrary.length > 1 ? 's' : ''} enregistree${mapLibrary.length > 1 ? 's' : ''} sur cet appareil. Reprenez un nom existant pour affiner sa reconnaissance.`}
          </p>
        </>
      )}

      {environment && (
        <div className="banner banner-info" style={{ marginTop: 12, marginBottom: 0 }}>
          <strong>Ce que l'IA voit de l'arene :</strong> {environment.description}
          {environment.landmarks.length > 0 && (
            <ul className="ai-list" style={{ marginTop: 6, marginBottom: 0 }}>
              {environment.landmarks.map((l, i) => (
                <li key={i}>{l}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {!environment && !analysis.mapFingerprint && (
        <p className="hint" style={{ marginTop: 10, marginBottom: 0 }}>
          Cette analyse a ete produite avant la reconnaissance d'arene : son nom ne servira pas a
          identifier les prochains matchs.
        </p>
      )}
    </div>
  );
}
