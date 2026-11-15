import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.grainesdor.idlefarm',
  appName: "Graines d'Or",
  webDir: 'dist',
  backgroundColor: '#7cc860',
  server: { androidScheme: 'https' },
};

export default config;
