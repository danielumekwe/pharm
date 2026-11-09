// Development builds install next to the released app ("PharmaERP Dev", its own ID), so testing never
// replaces or clashes with the PharmaERP app already on a phone. Release builds keep com.pharmaerp.app,
// so they update the existing app in place.
const IS_DEV = process.env.APP_VARIANT !== 'production';

module.exports = ({ config }) => ({
  ...config,
  name: IS_DEV ? 'PharmaERP Dev' : config.name,
  android: { ...config.android, package: IS_DEV ? 'com.pharmaerp.app.dev' : config.android.package },
  ios: { ...config.ios, bundleIdentifier: IS_DEV ? 'com.pharmaerp.app.dev' : config.ios.bundleIdentifier },
});
