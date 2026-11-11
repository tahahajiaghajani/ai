// Names of the server edition. The Windows-facing ones (MSI product, services, folders) come from the one packaging
// file packaging/server/edition.json, shared with the installer scripts and the WiX build; the product's name in the
// user interface stays APP_NAME (src/shared/constants.ts). Internal identifiers (sm_ tables, itsm.* settings, ITSM_*
// variables) never derive from these names.
import edition from "../../packaging/server/edition.json";

export interface EditionNames {
  product: string;
  displayName: string;
  manufacturer: string;
  msiFilePrefix: string;
  upgradeCode: string;
  installDir: string;
  dataDir: string;
  configFile: string;
  /** HKLM key where the installer records the data folder (found again by upgrades) */
  registryKey: string;
  services: {
    db: { name: string; displayName: string; description: string };
    app: { name: string; displayName: string; description: string };
    backupTask: { name: string; description: string };
  };
  ctl: string;
  firewallRule: string;
  /** the Application event log source of the installer (install-error reasons, installs) */
  eventSource: string;
  database: { name: string; appRole: string; superuser: string; port: number };
  defaultHostName: string;
}

export const EDITION: EditionNames = edition;

/**
 * Where the first-run setup sends the administrator: the integration hub's «فهرست کاربران (LDAP و SCIM)» (the AD
 * engineer adds the sign-in settings there) and «امنیت ورود و نشست‌ها» (session policy, break-glass accounts).
 */
export { DIRECTORY_SETTINGS_PATH, SECURITY_SETTINGS_PATH } from "@shared/auth/paths";

/** Environment variable naming the configuration file (default: <dataDir>\kariz.json on Windows). */
export const CONFIG_ENV = "ITSM_SERVER_CONFIG";

/** Exit code of a worker that asks its supervisor not to restart it (a configuration error). */
export const EXIT_FATAL_CONFIG = 78;
