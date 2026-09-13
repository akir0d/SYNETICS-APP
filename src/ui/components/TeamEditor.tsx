import { useState } from 'react';
import type { Team } from '../../core/types';

interface TeamEditorProps {
  teams: readonly Team[];
  myTeamId: string;
  onChange: (teams: Team[], myTeamId: string) => void;
}

function newTeam(): Team {
  return { id: `eq-${Date.now().toString(36)}`, tag: '', name: '', players: [] };
}

/**
 * Saisie des effectifs.
 *
 * Le tag compte autant que les pseudos : chez EVA il est colle devant le nom
 * du joueur, separe par un x — SYNxAKIROD. C'est ce qui permet a
 * l'application de voir que quatre cartes du tableau forment une equipe, sans
 * avoir a lire quoi que ce soit.
 */
export function TeamEditor({ teams, myTeamId, onChange }: TeamEditorProps) {
  const [ouverte, setOuverte] = useState<string | null>(null);

  const modifier = (id: string, champs: Partial<Team>) => {
    onChange(
      teams.map((t) => (t.id === id ? { ...t, ...champs } : t)),
      myTeamId,
    );
  };

  const supprimer = (id: string) => {
    onChange(
      teams.filter((t) => t.id !== id),
      myTeamId === id ? '' : myTeamId,
    );
  };

  const ajouter = () => {
    const equipe = newTeam();
    onChange([...teams, equipe], myTeamId || equipe.id);
    setOuverte(equipe.id);
  };

  return (
    <>
      {teams.length === 0 && (
        <p className="hint">
          Aucune equipe enregistree. Ajoutez la votre, puis celles que vous affrontez pour suivre vos
          resultats face a chacune.
        </p>
      )}

      {teams.map((equipe) => {
        const mienne = equipe.id === myTeamId;
        return (
          <div className="card" key={equipe.id} style={{ padding: 12, marginBottom: 8 }}>
            <div className="row">
              <input
                value={equipe.tag}
                placeholder="TAG"
                maxLength={8}
                onChange={(e) => modifier(equipe.id, { tag: e.target.value.toUpperCase() })}
                style={{ width: 90, textTransform: 'uppercase' }}
              />
              <input
                value={equipe.name}
                placeholder="Nom de l'equipe"
                onChange={(e) => modifier(equipe.id, { name: e.target.value })}
                style={{ flex: 1 }}
              />
              <button
                className="btn-ghost"
                style={mienne ? { borderColor: 'var(--ok)', color: 'var(--ok)' } : {}}
                onClick={() => onChange([...teams], equipe.id)}
              >
                {mienne ? 'Mon equipe' : 'Definir comme mienne'}
              </button>
              <button
                className="btn-ghost"
                onClick={() => setOuverte(ouverte === equipe.id ? null : equipe.id)}
              >
                {equipe.players.length} joueur{equipe.players.length > 1 ? 's' : ''}
              </button>
              <button className="btn-ghost btn-danger" onClick={() => supprimer(equipe.id)}>
                Retirer
              </button>
            </div>

            {ouverte === equipe.id && (
              <div className="field" style={{ marginTop: 10, marginBottom: 0 }}>
                <label htmlFor={`joueurs-${equipe.id}`}>Pseudos, un par ligne</label>
                <textarea
                  id={`joueurs-${equipe.id}`}
                  rows={5}
                  value={equipe.players.join('\n')}
                  placeholder={`${equipe.tag || 'TAG'}xJOUEUR1\n${equipe.tag || 'TAG'}xJOUEUR2`}
                  onChange={(e) =>
                    modifier(equipe.id, {
                      players: e.target.value
                        .split('\n')
                        .map((l) => l.trim().toUpperCase())
                        .filter(Boolean),
                    })
                  }
                />
                <p className="hint">
                  Tels qu'ils apparaissent sur le tableau des scores, tag compris.
                </p>
              </div>
            )}
          </div>
        );
      })}

      <button className="btn-ghost" onClick={ajouter}>
        Ajouter une equipe
      </button>
    </>
  );
}
