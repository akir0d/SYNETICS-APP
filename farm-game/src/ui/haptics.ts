// Petites vibrations : plugin natif sous Android, navigator.vibrate ailleurs.

import { Capacitor } from '@capacitor/core';
import { Haptics, ImpactStyle } from '@capacitor/haptics';

let enabled = true;
let last = 0;

export function setHapticsEnabled(on: boolean): void {
  enabled = on;
}

export function buzz(kind: 'light' | 'medium' | 'heavy' = 'light'): void {
  if (!enabled) return;
  const now = performance.now();
  // Un balayage de 20 champs ne doit pas devenir un bourdonnement continu.
  if (kind === 'light' && now - last < 35) return;
  last = now;
  if (Capacitor.isNativePlatform()) {
    const style = kind === 'heavy' ? ImpactStyle.Heavy : kind === 'medium' ? ImpactStyle.Medium : ImpactStyle.Light;
    void Haptics.impact({ style }).catch(() => undefined);
  } else if ('vibrate' in navigator) {
    try { navigator.vibrate(kind === 'heavy' ? 40 : kind === 'medium' ? 18 : 8); } catch { /* rien */ }
  }
}
