import type { ConfigContext, ExpoConfig } from 'expo/config';

export default ({ config }: ConfigContext): ExpoConfig => {
  const projectId = process.env.EXPO_PROJECT_ID?.trim();
  const bundleIdentifier =
    process.env.IOS_BUNDLE_ID?.trim() ||
    config.ios?.bundleIdentifier ||
    'org.salishpulse.orcatracker';

  return {
    ...config,
    name: config.name ?? 'SalishPulse — Seattle Orca Tracker',
    slug: config.slug ?? 'salish-pulse',
    ios: {
      ...config.ios,
      bundleIdentifier,
    },
    extra: {
      ...(config.extra ?? {}),
      ...(projectId ? { eas: { ...(config.extra?.eas ?? {}), projectId } } : {}),
    },
  };
};
