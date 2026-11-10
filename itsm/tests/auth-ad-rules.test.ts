// The pure rules of sign-in (src/shared/auth): the three login forms, Active Directory's account flags and bind
// sub-codes, which refusals may be told (only those the right password proves), the session policy's bounds and the
// strictest of several organisations, and the SPN commands of the SSO checklist.
import { describe, it, expect } from "vitest";
import { accountState, domainMatches, filetimeMs, loginMessage, parseLogin, reasonOfAdCode, spnCommands, VERIFIED_REASONS, GENERIC_LOGIN_MESSAGE } from "@shared/auth/login";
import { normalizePolicy, policyProblems, strictestSession, DEFAULT_POLICY, BANK_POLICY } from "@shared/auth/policy";
import { loginFilter, principalFilter } from "@server/modules/integration/directory-login";
import { filetime, NEVER } from "./ldap-fake";

describe("login names", () => {
  it("reads the three forms and refuses what cannot be a login", () => {
    expect(parseLogin("ali")).toEqual({ form: "plain", name: "ali", domain: null, key: "ali" });
    expect(parseLogin("CORP\\Ali")).toEqual({ form: "netbios", name: "Ali", domain: "corp", key: "corp\\ali" });
    expect(parseLogin(" ali@Corp.Bank.ir ")).toEqual({ form: "upn", name: "ali", domain: "corp.bank.ir", key: "ali@corp.bank.ir" });
    for (const bad of ["", "   ", "\\ali", "CORP\\", "ali@", "@corp.ir", "a\u0000b", "x".repeat(300), "CORP\\a\\b", "ali@corp..ir"]) expect(parseLogin(bad)).toBeNull();
    expect(domainMatches("corp", ["CORP", "corp.bank.ir"])).toBe(true);
    expect(domainMatches("evil", ["CORP"])).toBe(false);
  });

  it("builds filters whose typed parts are escaped", () => {
    const conf = { userFilter: "(&(objectCategory=person)(objectClass=user))", loginAttr: "sAMAccountName" as const, domains: ["CORP", "corp.bank.ir"] };
    expect(loginFilter(conf, parseLogin("CORP\\ali")!)).toBe("(&(&(objectCategory=person)(objectClass=user))(sAMAccountName=ali))");
    expect(loginFilter(conf, parseLogin("a*)(x=1@corp.bank.ir")!)).toBe("(&(&(objectCategory=person)(objectClass=user))(|(userPrincipalName=a\\2a\\29\\28x=1@corp.bank.ir)(mail=a\\2a\\29\\28x=1@corp.bank.ir)))");
    expect(loginFilter({ ...conf, loginAttr: "mail" }, parseLogin("ali")!)).toBe("(&(&(objectCategory=person)(objectClass=user))(mail=ali@corp.bank.ir))");
    expect(loginFilter({ ...conf, userFilter: "objectClass=user" }, parseLogin("ali")!)).toBe("(&(objectClass=user)(sAMAccountName=ali))");
    expect(principalFilter(conf, "ali", "corp.bank.ir")).toBe("(&(&(objectCategory=person)(objectClass=user))(|(sAMAccountName=ali)(userPrincipalName=ali@corp.bank.ir)))");
  });
});

describe("Active Directory accounts", () => {
  const base = { userAccountControl: ["512"], accountExpires: [NEVER], pwdLastSet: [filetime(Date.now() - 86400_000)], "msDS-UserPasswordExpiryTimeComputed": [filetime(Date.now() + 86400_000)], "msDS-User-Account-Control-Computed": ["0"] };
  it("reads disabled, locked, expired, password-expired and must-change", () => {
    expect(accountState(base)).toEqual({ disabled: false, locked: false, expired: false, passwordExpired: false, mustChange: false });
    expect(accountState({ ...base, userAccountControl: ["514"] }).disabled).toBe(true);
    expect(accountState({ ...base, "msDS-User-Account-Control-Computed": ["16"] }).locked).toBe(true);
    expect(accountState({ ...base, accountExpires: [filetime(Date.now() - 1000)] }).expired).toBe(true);
    expect(accountState({ ...base, accountExpires: ["0"] }).expired).toBe(false);
    expect(accountState({ ...base, "msDS-UserPasswordExpiryTimeComputed": [filetime(Date.now() - 1000)] }).passwordExpired).toBe(true);
    // «password never expires» wins over a computed expiry
    expect(accountState({ ...base, userAccountControl: [String(512 | 0x10000)], "msDS-UserPasswordExpiryTimeComputed": [filetime(Date.now() - 1000)] }).passwordExpired).toBe(false);
    expect(accountState({ ...base, "msDS-User-Account-Control-Computed": [String(0x800000)] }).passwordExpired).toBe(true);
    expect(accountState({ ...base, pwdLastSet: ["0"] }).mustChange).toBe(true);
    expect(filetimeMs(NEVER)).toBeNull();
    expect(Math.abs(filetimeMs(filetime(1_700_000_000_000))! - 1_700_000_000_000)).toBeLessThan(2);
  });

  it("tells only what the right password proves", () => {
    expect(reasonOfAdCode("52e")).toBe("wrong_password");
    expect(reasonOfAdCode("525")).toBe("wrong_password");
    expect(reasonOfAdCode("775")).toBe("locked");
    expect(reasonOfAdCode("533")).toBe("disabled");
    expect(reasonOfAdCode("701")).toBe("account_expired");
    expect(reasonOfAdCode("532")).toBe("password_expired");
    expect(reasonOfAdCode("773")).toBe("must_change");
    for (const r of ["wrong_password", "unknown_account", "locked", "throttled", "ambiguous_account"] as const) {
      expect(VERIFIED_REASONS.has(r)).toBe(false);
      expect(loginMessage(r, "ITSM")).toBe(GENERIC_LOGIN_MESSAGE);
    }
    expect(loginMessage("disabled", "ITSM")).not.toBe(GENERIC_LOGIN_MESSAGE);
  });
});

describe("session policy", () => {
  it("bounds what an administrator types and keeps unknown keys out", () => {
    const p = normalizePolicy({ session: { idle_minutes: -5, absolute_hours: 99999, reauth_minutes: "x" }, local_login: "nobody", breakglass: ["not-a-uuid", "01a1c3e0-ea29-7025-b9e9-0029bd6a9c14"], extra: 1 });
    expect(p.session).toEqual({ idle_minutes: 0, absolute_hours: 2160, single_session: false, reauth_minutes: 15, browser_session: false });
    expect(p.local_login).toBe("all");
    expect(p.breakglass).toEqual(["01a1c3e0-ea29-7025-b9e9-0029bd6a9c14"]);
    expect(normalizePolicy(undefined)).toEqual(DEFAULT_POLICY);
  });

  it("takes the strictest of several organisations", () => {
    const s = strictestSession([DEFAULT_POLICY.session, BANK_POLICY.session, { ...DEFAULT_POLICY.session, idle_minutes: 30, reauth_minutes: 0 }]);
    expect(s).toEqual({ idle_minutes: 15, absolute_hours: 10, single_session: true, reauth_minutes: 10, browser_session: true });
    expect(strictestSession([])).toEqual(DEFAULT_POLICY.session);
  });

  it("refuses closing local sign-in without a directory or a break-glass account", () => {
    expect(policyProblems({ ...DEFAULT_POLICY, local_login: "breakglass" }, { directoryLogin: false })).toHaveLength(2);
    expect(policyProblems({ ...DEFAULT_POLICY, local_login: "breakglass", breakglass: ["01a1c3e0-ea29-7025-b9e9-0029bd6a9c14"] }, { directoryLogin: true })).toEqual([]);
  });
});

describe("the SSO checklist", () => {
  it("writes the SPN commands for the host and the service account", () => {
    expect(spnCommands("https://Kariz.Bank.ir/", "BANK\\svc-kariz")).toEqual(["setspn -Q HTTP/kariz.bank.ir", "setspn -S HTTP/kariz.bank.ir BANK\\svc-kariz", "setspn -S HTTP/kariz BANK\\svc-kariz"]);
    expect(spnCommands("kariz", "KARIZ-SRV01$")).toEqual(["setspn -Q HTTP/kariz", "setspn -S HTTP/kariz KARIZ-SRV01$"]);
    expect(spnCommands("", "x")).toEqual([]);
  });
});
