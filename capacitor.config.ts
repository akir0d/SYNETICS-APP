import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'gg.synetics.evaanalyzer',
  appName: 'SYNETICS',
  webDir: 'dist',
  android: {
    // L'analyse decode la video localement : aucun upload n'est necessaire.
    allowMixedContent: false,
  },
  server: {
    androidScheme: 'https',
  },
};

export default config;
