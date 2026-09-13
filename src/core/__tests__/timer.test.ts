import { describe, expect, it } from 'vitest';
import { DEFAULT_TIMER_REGION, fitMatchClock, matchTimeToVideo, readTimer, videoTimeToMatch } from '../vision/timer';
import type { ClockSample } from '../vision/timer';
import { cropRegion, gameFrame, loadCapture } from './fixtures/captures';

describe('lecture du chronometre sur une vraie capture', () => {
  const capture = loadCapture('lobby-10min');

  it('lit 10:00 dans le HUD du lobby', () => {
    const crop = cropRegion(capture, gameFrame('lobby-10min'), DEFAULT_TIMER_REGION);
    const lu = readTimer(crop);
    expect(lu).not.toBeNull();
    expect(lu!.minutes).toBe(10);
    expect(lu!.seconds).toBe(0);
    expect(lu!.remainingS).toBe(600);
  });

  it('rend une marge de confiance nettement au-dessus du plancher', () => {
    const crop = cropRegion(capture, gameFrame('lobby-10min'), DEFAULT_TIMER_REGION);
    expect(readTimer(crop)!.margin).toBeGreaterThan(0.02);
  });

  it('refuse une zone qui ne contient pas de chronometre', () => {
    // Plein milieu de l'arene : rien a lire, donc rien ne doit etre rendu.
    const crop = cropRegion(capture, gameFrame('lobby-10min'), {
      x: 0.4, y: 0.5, width: 0.06, height: 0.04,
    });
    expect(readTimer(crop)).toBeNull();
  });

  it('refuse une zone decalee qui happerait les pourcentages d equipe', () => {
    const crop = cropRegion(capture, gameFrame('lobby-10min'), {
      x: 0.44, y: 0.038, width: 0.12, height: 0.05,
    });
    // Six a huit glyphes au lieu de quatre : la lecture doit echouer, pas
    // rendre un horaire invente.
    expect(readTimer(crop)).toBeNull();
  });
});

describe('calage de la manche sur le chronometre', () => {
  const echantillon = (videoTimeS: number, remainingS: number): ClockSample => ({
    videoTimeS,
    reading: { remainingS, minutes: Math.floor(remainingS / 60), seconds: remainingS % 60, margin: 0.05 },
  });

  it('retrouve le debut exact de la manche', () => {
    // Manche de dix minutes demarrant a 42 s dans le fichier.
    const samples = [30, 90, 200, 400, 600].map((t) => echantillon(42 + t, 600 - t));
    const clock = fitMatchClock(samples);

    expect(clock).not.toBeNull();
    expect(clock!.startS).toBeCloseTo(42, 5);
    expect(clock!.durationS).toBe(600);
    expect(clock!.used).toBe(5);
    expect(clock!.residualS).toBe(0);
  });

  it('encaisse une lecture fausse sans se deplacer', () => {
    // Une erreur de chiffre deplacerait une moyenne ; elle ne deplace pas une
    // mediane, et c'est tout l'interet de l'ajustement robuste.
    const samples = [
      echantillon(72, 570),
      echantillon(132, 510),
      echantillon(242, 400),
      echantillon(342, 141), // 300 lu 141
      echantillon(442, 200),
    ];
    const clock = fitMatchClock(samples);
    expect(clock!.startS).toBeCloseTo(42, 5);
    expect(clock!.used).toBe(4);
    expect(clock!.total).toBe(5);
  });

  it('convertit dans les deux sens', () => {
    const clock = fitMatchClock([30, 300].map((t) => echantillon(42 + t, 600 - t)))!;
    expect(matchTimeToVideo(clock, 142)).toBeCloseTo(184, 5);
    expect(videoTimeToMatch(clock, 184)).toBeCloseTo(142, 5);
  });

  it('ne rend rien sans lecture', () => {
    expect(fitMatchClock([])).toBeNull();
  });
});
