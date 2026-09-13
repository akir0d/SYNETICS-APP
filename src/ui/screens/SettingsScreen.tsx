import { useState } from 'react';
import type { AppSettings, GameProfileId, HudRegion, KnownMap } from '../../core/types';
import { AI_MODELS, DEFAULT_MAP_NAME_REGION, GAME_PROFILES } from '../../core/types';
import { formatDuration } from '../../core/analysis/metrics';
import { detectPlatform } from '../../platform';

interface SettingsScreenProps {
  settings: AppSettings;
  maps: readonly KnownMap[];
  onChange: (settings: AppSettings) => void;
  onDeleteMap: (id: string) => void;
}

const PLATFORM_LABEL: Record<ReturnType<typeof detectPlatform>, string> = {
  electron: 'Application PC (Electron)',
  android: 'Application Android',
  web: 'Navigateur',
};

export function SettingsScreen({ settings, maps, onChange, onDeleteMap }: SettingsScreenProps) {
  const [showKey, setShowKey] = useState(false);
  const platform = detectPlatform();

  const update = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
    onChange({ ...settings, [key]: value });
  };

  const updateRegion = (key: keyof HudRegion, value: number) => {
    update('mapNameRegion', { ...settings.mapNameRegion, [key]: value / 100 });
  };

  const region = settings.mapNameRegion;

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
        <h2>Decoupage des rediffusions</h2>

        <div className="field">
          <label>
            <input
              type="checkbox"
              checked={settings.autoSegment}
              onChange={(e) => update('autoSegment', e.target.checked)}
              style={{ width: 'auto', marginRight: 8 }}
            />
            Separer automatiquement les matchs d'une meme rediffusion
          </label>
          <p className="hint" style={{ margin: 0 }}>
            Une captation de plusieurs heures contient en general plusieurs manches separees par
            des temps morts. Chaque match devient une analyse autonome, avec ses propres mesures.
            Desactivez si votre fichier ne contient qu'un seul match.
          </p>
        </div>

        <div className="field">
          <label>
            <input
              type="checkbox"
              checked={settings.useBlackScreens}
              onChange={(e) => update('useBlackScreens', e.target.checked)}
              disabled={!settings.autoSegment}
              style={{ width: 'auto', marginRight: 8 }}
            />
            Se caler sur les ecrans noirs du jeu
          </label>
          <p className="hint" style={{ margin: 0 }}>
            EVA insere un ecran noir apres le decompte de debut et apres le tableau des scores.
            Quand ils sont presents, ils servent de frontieres franches : deux manches separees par
            un ecran noir ne peuvent plus etre fusionnees, quoi que dise le mouvement. Si votre
            captation n'en contient pas (montage, fondu doux, recadrage), l'application retombe
            d'elle-meme sur la detection par le mouvement.
          </p>
        </div>

        <div className="field">
          <label htmlFor="minMatch">
            Duree minimale d'un match : <b>{formatDuration(settings.minMatchS)}</b>
          </label>
          <input
            id="minMatch"
            type="range"
            min={30}
            max={600}
            step={15}
            value={settings.minMatchS}
            disabled={!settings.autoSegment}
            onChange={(e) => update('minMatchS', Number(e.target.value))}
          />
          <p className="hint" style={{ margin: 0 }}>
            Tout bloc d'action plus court est ecarte : c'est ce qui evite qu'un echauffement ou un
            faux depart devienne un match a part entiere.
          </p>
        </div>

        <div className="field">
          <label htmlFor="minGap">
            Pause minimale entre deux matchs : <b>{settings.minGapS} s</b>
          </label>
          <input
            id="minGap"
            type="range"
            min={10}
            max={180}
            step={5}
            value={settings.minGapS}
            disabled={!settings.autoSegment}
            onChange={(e) => update('minGapS', Number(e.target.value))}
          />
          <p className="hint" style={{ margin: 0 }}>
            En dessous de cette duree, un temps calme est considere comme une phase du match en
            cours (rotation, attente de reapparition) et non comme une separation. Baissez si vos
            manches s'enchainent vite, montez si un seul match se retrouve coupe en deux.
          </p>
        </div>
      </div>

      <div className="card">
        <h2>Zone du nom de carte</h2>

        <p className="hint">
          Le jeu ecrit le nom de la carte en haut au centre, sous le chronometre. L'application y
          preleve une empreinte du texte : c'est ce qui lui permet de reconnaitre une arene deja
          nommee, sans rien comprendre a ce qui est ecrit. Ces valeurs sont en pourcentage de
          l'image, elles restent donc valables quelle que soit la definition.
        </p>
        <p className="hint">
          Les valeurs par defaut correspondent au HUD d'EVA en plein cadre. Ne les touchez que si
          la vignette affichee dans le rapport d'un match ne montre pas le nom de la carte — par
          exemple sur une captation recadree ou filmee a l'ecran.
        </p>

        {(
          [
            ['x', 'Bord gauche', 0, 90],
            ['y', 'Bord haut', 0, 90],
            ['width', 'Largeur', 5, 100],
            ['height', 'Hauteur', 2, 50],
          ] as Array<[keyof HudRegion, string, number, number]>
        ).map(([key, label, min, max]) => (
          <div className="field" key={key}>
            <label htmlFor={`region-${key}`}>
              {label} : <b>{Math.round(region[key] * 100)} %</b>
            </label>
            <input
              id={`region-${key}`}
              type="range"
              min={min}
              max={max}
              step={1}
              value={Math.round(region[key] * 100)}
              onChange={(e) => updateRegion(key, Number(e.target.value))}
            />
          </div>
        ))}

        <button
          className="btn-ghost"
          onClick={() => update('mapNameRegion', { ...DEFAULT_MAP_NAME_REGION })}
        >
          Revenir a la zone par defaut
        </button>
      </div>

      <div className="card">
        <h2>Arenes connues</h2>

        {maps.length === 0 ? (
          <p className="hint" style={{ marginBottom: 0 }}>
            Aucune arene enregistree. L'application n'embarque pas le catalogue des cartes EVA :
            elle apprend de vous. Nommez l'arene d'un match depuis son rapport, et les matchs
            suivants joues au meme endroit seront reconnus tout seuls.
          </p>
        ) : (
          <>
            <p className="hint">
              Reconnaissance apprise sur cet appareil, a partir de la signature visuelle des
              matchs que vous avez nommes.
            </p>
            <div className="event-list" style={{ maxHeight: 300 }}>
              {maps.map((m) => (
                <div className="event" key={m.id} style={{ cursor: 'default' }}>
                  <time>{m.matchCount}×</time>
                  <div>
                    <div className="title">{m.name}</div>
                    <div className="meta">
                      Signature issue de {m.fingerprint.frames} images · mise a jour le{' '}
                      {new Date(m.updatedAt).toLocaleDateString('fr-FR')}
                    </div>
                  </div>
                  <button
                    className="btn-ghost btn-danger"
                    style={{ padding: '4px 9px' }}
                    onClick={() => onDeleteMap(m.id)}
                    aria-label={`Oublier l arene ${m.name}`}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          </>
        )}
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
          <li>
            Le decoupage repose sur le mouvement a l'image : il separe des blocs de jeu de temps
            morts, il ne lit pas un tableau des scores. Verifiez le decoupage sur une premiere
            rediffusion avant de lui faire confiance les yeux fermes.
          </li>
          <li>
            La reconnaissance d'arene s'appuie d'abord sur l'<b>empreinte du nom ecrit dans le
            HUD</b>, completee par la palette de couleurs du lieu. Elle ne <i>lit</i> pas ce nom :
            seule l'analyse IA sait le dechiffrer et vous le proposer. Hors IA, vous nommez une
            arene une fois et elle est reconnue ensuite.
          </li>
          <li>
            Les eliminations et morts affichees viennent du <b>tableau des scores du jeu</b> des
            que l'IA a pu le lire — a condition d'avoir renseigne votre pseudo ci-dessus, sans quoi
            l'application ne sait pas quelle ligne est la votre. Sinon elles viennent de votre
            marquage manuel.
          </li>
        </ul>
      </div>
    </>
  );
}
