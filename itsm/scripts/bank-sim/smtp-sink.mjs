// The bank's internal mail relay of the simulation (docs/qa/BANK_SIM_FA.md): a small SMTP server on the runner's LAN
// address that accepts every message and writes it to a JSON-lines file. Port 587 offers and requires STARTTLS with a
// certificate the bank's test CA issued (smtp.bank.local, like an Exchange receive connector with an internal
// certificate); port 25 accepts plain SMTP (and offers STARTTLS too), like a relay that trusts the server's address.
// TLS failures (for example a client that does not trust the bank's CA) are logged with their reason.
//
//   node smtp-sink.mjs --host 10.1.0.5 --pfx smtp.pfx --passphrase … --out mail.jsonl [--ports 25,587]
import net from "node:net";
import tls from "node:tls";
import { appendFileSync, readFileSync } from "node:fs";
import { parseArgs, log } from "./lib.mjs";

const a = parseArgs();
const host = String(a.host ?? "127.0.0.1");
const ports = String(a.ports ?? "25,587").split(",").map(Number);
const out = String(a.out ?? "mail.jsonl");
const secureContext = tls.createSecureContext({ pfx: readFileSync(String(a.pfx)), passphrase: String(a.passphrase ?? "") });

function serve(raw, port) {
  let sock = raw;
  let secure = false;
  let buf = "";
  let inData = false;
  let data = [];
  let env = { from: "", rcpt: [] };
  const peer = `${raw.remoteAddress}:${raw.remotePort}`;
  const say = (line) => sock.write(`${line}\r\n`);
  const requireTls = port === 587;
  const reset = () => {
    env = { from: "", rcpt: [] };
    data = [];
  };
  const onLine = (line) => {
    if (inData) {
      if (line === ".") {
        inData = false;
        const text = data.join("\r\n");
        const subject = /^subject:\s*(.*)$/im.exec(text)?.[1] ?? "";
        const rec = { at: new Date().toISOString(), port, tls: secure, peer, from: env.from, rcpt: env.rcpt, size: text.length, subject, headers: text.split("\r\n\r\n")[0].slice(0, 4000) };
        appendFileSync(out, `${JSON.stringify(rec)}\n`);
        log(`smtp: message on ${port}${secure ? " (TLS)" : ""} from ${env.from} to ${env.rcpt.join(", ")} (${text.length} bytes)`);
        reset();
        return say("250 2.0.0 queued");
      }
      data.push(line.startsWith("..") ? line.slice(1) : line);
      return;
    }
    const cmd = line.slice(0, 4).toUpperCase();
    if (cmd === "EHLO" || cmd === "HELO") {
      if (cmd === "HELO") return say("250 smtp.bank.local");
      sock.write(`250-smtp.bank.local\r\n250-SIZE 52428800\r\n250-8BITMIME\r\n250-SMTPUTF8\r\n${secure ? "" : "250-STARTTLS\r\n"}250 OK\r\n`);
      return;
    }
    if (cmd === "STAR") {
      if (secure) return say("503 5.5.1 already in TLS");
      say("220 2.0.0 ready to start TLS");
      sock.removeAllListeners("data");
      const s = new tls.TLSSocket(sock, { isServer: true, secureContext, minVersion: "TLSv1.2" });
      s.on("secure", () => log(`smtp: TLS ${s.getProtocol()} with ${peer} on ${port}`));
      s.on("error", (e) => log(`smtp: TLS failed with ${peer} on ${port}: ${e.message}`));
      s.on("data", onData);
      sock = s;
      secure = true;
      buf = "";
      reset();
      return;
    }
    if (requireTls && !secure && ["MAIL", "RCPT", "DATA", "AUTH"].includes(cmd)) return say("530 5.7.0 Must issue a STARTTLS command first");
    if (cmd === "MAIL") {
      env.from = (/<([^>]*)>/.exec(line)?.[1] ?? "").toLowerCase();
      return say("250 2.1.0 sender ok");
    }
    if (cmd === "RCPT") {
      env.rcpt.push((/<([^>]*)>/.exec(line)?.[1] ?? "").toLowerCase());
      return say("250 2.1.5 recipient ok");
    }
    if (cmd === "DATA") {
      inData = true;
      return say("354 end data with <CR><LF>.<CR><LF>");
    }
    if (cmd === "RSET") {
      reset();
      return say("250 2.0.0 ok");
    }
    if (cmd === "NOOP") return say("250 2.0.0 ok");
    if (cmd === "QUIT") {
      say("221 2.0.0 bye");
      return sock.end();
    }
    if (cmd === "AUTH") return say("235 2.7.0 accepted");
    return say("502 5.5.2 command not recognised");
  };
  const onData = (d) => {
    buf += d.toString("utf8");
    let i;
    while ((i = buf.indexOf("\r\n")) >= 0) {
      const line = buf.slice(0, i);
      buf = buf.slice(i + 2);
      onLine(line);
    }
  };
  raw.on("data", onData);
  raw.on("error", (e) => log(`smtp: connection error with ${peer}: ${e.message}`));
  say("220 smtp.bank.local ESMTP bank simulation relay");
}

for (const port of ports) {
  const server = net.createServer((s) => serve(s, port));
  server.listen(port, host, () => log(`smtp: listening on ${host}:${port}${port === 587 ? " (STARTTLS required)" : ""}`));
  server.on("error", (e) => {
    log(`smtp: cannot listen on ${host}:${port}: ${e.message}`);
    process.exit(2);
  });
}
