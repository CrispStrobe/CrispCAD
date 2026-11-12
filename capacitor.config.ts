import type { CapacitorConfig } from '@capacitor/cli';
const config: CapacitorConfig = {
  appId: 'com.crispstrobe.brickwrightcad', appName: 'Brickwright CAD', webDir: 'dist',
  ios: { path: 'apps/ipad', contentInset: 'never', scrollEnabled: false, preferredContentMode: 'mobile' },
};
export default config;
