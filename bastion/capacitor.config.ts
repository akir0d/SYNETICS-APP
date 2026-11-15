import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.dernierbastion.jeu',
  appName: 'Dernier Bastion',
  webDir: 'dist',
  backgroundColor: '#1c2a20',
  server: { androidScheme: 'https' },
  android: {
    // Le plein ecran est gere dans MainActivity : la WebView ne doit pas
    // ajouter ses propres marges par-dessus.
    adjustMarginsForEdgeToEdge: 'disable',
  },
};

export default config;
