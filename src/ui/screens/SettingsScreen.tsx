import { useState } from 'react';
import type { AppSettings, GameProfileId } from '../../core/types';
import { AI_MODELS, GAME_PROFILES } from '../../core/types';
import { detectPlatform } from '../../platform';

interface SettingsScreenProps {
  settings: AppSettings;
  onChange: (settings: AppSettings) => void;
}

const PLATFORM_LABEL: Record<ReturnType<typeof detectPlatform>, string> = {
  electron: 'Application PC (Electron)',
  android: 'Application Android',
  web: 'Navigateur',
};

export function SettingsScreen({ settings, onChange }: SettingsScreenProps) {
  const [showKey, setShowKey] = useState(false);
  const platform = detectPlatform();

  const update = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
    onChange({ ...settings, [key]: value });
  };

  return (
    <>
      <h1>Reglages</h1>
      <p className="hint">
        Tout est stocke sur cet appareil ({PLATFORM_LABEL[platform]}). Rien n'est synchronise.
      </p>

      <div className="card">
        <h2>Analyse IA</h2>

        <div className="field">
          <label>
            <input
              type="checkbox"
              checked={settings.aiEnabled}
              onChange={(e) => update('aiEnabled', e.target.checked)}
              style={{ width: 'auto', marginRight: 8 }}
            />
            Activer l'analyse IA (facultative)
          </label>
          <p className="hint" style={{ margin: 0 }}>
            Desactivee, l'application reste entierement fonctionnelle hors-ligne : mesures, phases
            de jeu, timeline et marquage manuel.
          </p>
        </div>

        <div className="field">
          <label htmlFor="apiKey">Cle API Anthropic</label>
          <div className="row" style={{ flexWrap: 'nowrap' }}>
            <input
              id="apiKey"
              type={showKey ? 'text' : 'password'}
              value={settings.apiKey}
              placeholder="sk-ant-..."
              autoComplete="off"
              spellCheck={false}
              onChange={(e) => update('apiKey', e.target.value)}
            />
            <button className="btn-ghost" onClick={() => setShowKey((v) => !v)}>
              {showKey ? 'Masquer' : 'Voir'}
            </button>
          </div>
          <p className="hint" style={{ margin: 0 }}>
            La cle reste dans le stockage local de l'appareil et n'est envoyee qu'a l'API Anthropic.
            Creez-la sur console.anthropic.com. Les appels sont factures sur votre compte.
          </p>
        </div>

        <div className="field">
          <label htmlFor="model">Modele</label>
          <select
            id="model"
            value={settings.aiModel}
            onChange={(e) => update('aiModel', e.target.value)}
          >
            {AI_MODELS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label htmlFor="frames">
            Images cles envoyees a l'IA : <b>{settings.aiFrameBudget}</b>
          </label>
          <input
            id="frames"
            type="range"
            min={8}
            max={60}
            step={2}
            value={settings.aiFrameBudget}
            onChange={(e) => update('aiFrameBudget', Number(e.target.value))}
          />
          <p className="hint" style={{ margin: 0 }}>
            Plus d'images donne une lecture plus fine du match, mais coute plus cher par analyse.
            24 images est un bon point de depart.
          </p>
        </div>
      </div>

      <div className="card">
        <h2>Moteur local</h2>

        <div className="field">
          <label htmlFor="sampling">
            Images analysees par seconde de video : <b>{settings.samplingHz}</b>
          </label>
          <input
            id="sampling"
            type="range"
            min={1}
            max={6}
            step={0.5}
            value={settings.samplingHz}
            onChange={(e) => update('samplingHz', Number(e.target.value))}
          />
          <p className="hint" style={{ margin: 0 }}>
            Une image toutes les {(1 / settings.samplingHz).toFixed(2)} s, soit environ{' '}
            {Math.round(settings.samplingHz * 60)} lectures par minute de video.
          </p>
          {settings.samplingHz < 3 ? (
            <div className="banner banner-info" style={{ marginTop: 8, marginBottom: 0 }}>
              En dessous de 3 images/s, l'intervalle entre deux mesures depasse la duree d'un
              voile de degats (0,3 a 0,5 s) : des expositions passeront entre les images. Baissez
              cette valeur pour aller plus vite, en sachant que la detection y perd.
            </div>
          ) : (
            <p className="hint" style={{ marginTop: 6, marginBottom: 0 }}>
              Monter au-dela allonge l'analyse a peu pres proportionnellement, pour un gain de
              detection qui devient marginal.
            </p>
          )}
        </div>

        <div className="field">
          <label htmlFor="defaultProfile">Mode de jeu par defaut</label>
          <select
            id="defaultProfile"
            value={settings.defaultProfile}
            onChange={(e) => update('defaultProfile', e.target.value as GameProfileId)}
          >
            {Object.values(GAME_PROFILES).map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label htmlFor="player">Votre pseudo EVA</label>
          <input
            id="player"
            type="text"
            value={settings.playerName}
            placeholder="Facultatif — transmis a l'IA pour personnaliser le coaching"
            onChange={(e) => update('playerName', e.target.value)}
          />
        </div>
      </div>

      <div className="card">
        <h2>Ce que l'application sait faire, et ne sait pas faire</h2>
        <ul className="ai-list">
          <li>
            Le moteur local lit un <b>signal visuel</b> (mouvement, flashs, coupures). Il ne
            comprend pas le jeu : ses evenements sont des candidats a confirmer.
          </li>
          <li>
            Les compteurs d'eliminations, de morts et d'objectifs proviennent de vos marquages
            manuels et de l'IA, jamais des heuristiques seules.
          </li>
          <li>
            Aucune connexion a un compte eva.gg : EVA ne publie pas d'API ouverte. L'analyse part
            de vos propres enregistrements.
          </li>
        </ul>
      </div>
    </>
  );
}
