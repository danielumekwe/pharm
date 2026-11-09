// Signs release builds with the existing PharmaERP key, so the new app installs as an update over the
// current com.pharmaerp.app. The key never enters this repository: point PHARMAERP_SIGNING at the
// keystore.properties file (storeFile, storePassword, keyAlias, keyPassword; storeFile relative to that file's
// folder or absolute; PHARMAERP_KEYSTORE overrides the keystore path). Without it, release builds fall back to the debug key (fine for local testing only).
const { withAppBuildGradle } = require('expo/config-plugins');

const SETUP = `
// --- PharmaERP release signing (plugins/with-release-signing.js) ---
def pharmaSigning = new Properties()
def pharmaSigningFile = System.getenv("PHARMAERP_SIGNING") ? new File(System.getenv("PHARMAERP_SIGNING")) : null
if (pharmaSigningFile != null && pharmaSigningFile.exists()) { pharmaSigningFile.withInputStream { pharmaSigning.load(it) } }
def pharmaStoreFile = { ->
    if (System.getenv("PHARMAERP_KEYSTORE")) return new File(System.getenv("PHARMAERP_KEYSTORE"))
    def path = pharmaSigning.getProperty("storeFile")
    if (path == null) return null
    def candidate = new File(path)
    return candidate.isAbsolute() ? candidate : new File(pharmaSigningFile.parentFile, path).canonicalFile
}
// --- end PharmaERP release signing ---
`;

module.exports = function withReleaseSigning(config) {
  return withAppBuildGradle(config, (mod) => {
    let gradle = mod.modResults.contents;
    if (gradle.includes('PharmaERP release signing')) return mod;
    gradle = gradle.replace(/\nandroid \{/, `${SETUP}\nandroid {`);
    gradle = gradle.replace(/signingConfigs \{\s*\n\s*debug \{/, (match) => `signingConfigs {
        release {
            if (pharmaSigning.getProperty("storeFile") != null) {
                storeFile pharmaStoreFile()
                storePassword pharmaSigning.getProperty("storePassword")
                keyAlias pharmaSigning.getProperty("keyAlias")
                keyPassword pharmaSigning.getProperty("keyPassword")
            }
        }
${match.replace(/^signingConfigs \{\s*\n/, '')}`);
    gradle = gradle.replace(/(release \{[^{}]*?)signingConfig signingConfigs\.debug/, `$1signingConfig pharmaSigning.getProperty("storeFile") != null ? signingConfigs.release : signingConfigs.debug`);
    mod.modResults.contents = gradle;
    return mod;
  });
};
