import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.franklinvitor.jarvisfv',
  appName: 'JARVIS FV',
  webDir: 'dist',
  backgroundColor: '#050A12',
  plugins: {
    LocalNotifications: { smallIcon: 'ic_stat_jarvis', iconColor: '#00D9FF' },
    PushNotifications: { presentationOptions: ['badge', 'sound', 'alert'] },
  },
};

export default config;
