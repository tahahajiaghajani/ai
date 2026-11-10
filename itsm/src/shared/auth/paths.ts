// Organisation-relative paths of the sign-in settings pages, named once: the server edition's first-run setup links to
// them from its last step, «سلامت سرور» and the docs refer to them. Prefixed with `/${orgId}` in the app.

/** The integration hub's «فهرست کاربران (LDAP و SCIM)»: Active Directory / LDAP sign-in and directory sync. */
export const DIRECTORY_SETTINGS_PATH = "/integrations/directory";

/** «امنیت ورود و نشست‌ها»: session policy, break-glass accounts, lockout and the sign-in audit. */
export const SECURITY_SETTINGS_PATH = "/settings/security";
