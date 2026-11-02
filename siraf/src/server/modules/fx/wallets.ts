// Crypto wallets: live on-chain balance next to the book balance (the wallet's detail account on
// «کیف‌پول‌های رمزارز»). Public endpoints only, no keys:
//   BTC / LTC  esplora (mempool.space, litecoinspace.org): funded − spent, mempool included
//   DOGE       BlockCypher
//   EVM        publicnode JSON-RPC (eth_getBalance; ERC20 balanceOf / decimals via eth_call)
//   TRON       TronGrid (TRX in sun, TRC20 list)
//   SOL        publicnode JSON-RPC (getBalance, getTokenAccountsByOwner for SPL tokens)
//   TON        toncenter (native TON)
import type { Ctx } from "../../context";
import { bad, notFound } from "../../http/errors";
import { D } from "@shared/money";
import { isUuid } from "@shared/id";
import { formatNumber } from "@shared/format";
import { LIVE } from "./common";
import { bigIntField, fetchJson, fromUnits, hexToDec, jsonRpc, mapLimit, NetError, type Fetch } from "./net";

export interface WalletTx {
  hash: string;
  time: string | null;
  /** signed amount for this wallet (+ received, − sent) */
  amount: string;
  confirmed: boolean;
  counterparty?: string | null;
}

export interface ChainBalance {
  balance: string;
  source: string;
  /** native coin balance when the wallet holds a token (gas money) */
  native?: { code: string; balance: string } | null;
  txs?: WalletTx[];
}

export const EVM_RPC: Record<string, string> = {
  ETH: "https://ethereum-rpc.publicnode.com",
  BSC: "https://bsc-rpc.publicnode.com",
  POLYGON: "https://polygon-bor-rpc.publicnode.com",
  ARBITRUM: "https://arbitrum-one-rpc.publicnode.com",
  BASE: "https://base-rpc.publicnode.com",
};
export const SOL_RPC = "https://solana-rpc.publicnode.com";

/** Native coin of each chain (the wallet's asset code(s) that mean "not a token"). */
export const NATIVE: Record<string, string[]> = {
  BTC: ["BTC"], LTC: ["LTC"], DOGE: ["DOGE"], ETH: ["ETH"], BSC: ["BNB"], POLYGON: ["POL", "MATIC"], ARBITRUM: ["ETH"], BASE: ["ETH"], TRON: ["TRX"], SOL: ["SOL"], TON: ["TON"],
};

/** Well-known token contracts (used when the wallet has no contract of its own). */
export const TOKENS: Record<string, Record<string, { contract: string; decimals: number }>> = {
  ETH: { USDT: { contract: "0xdAC17F958D2ee523a2206206994597C13D831ec7", decimals: 6 }, USDC: { contract: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", decimals: 6 } },
  BSC: { USDT: { contract: "0x55d398326f99059fF775485246999027B3197955", decimals: 18 }, USDC: { contract: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d", decimals: 18 } },
  POLYGON: { USDT: { contract: "0xc2132D05D31c914a87C6611C10748AEb04B58e8F", decimals: 6 }, USDC: { contract: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359", decimals: 6 } },
  ARBITRUM: { USDT: { contract: "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9", decimals: 6 }, USDC: { contract: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831", decimals: 6 } },
  BASE: { USDC: { contract: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", decimals: 6 } },
  TRON: { USDT: { contract: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t", decimals: 6 }, USDC: { contract: "TEkxiTehnzSmSe2XqrBj4w32RUN966rdz8", decimals: 6 } },
  SOL: { USDT: { contract: "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB", decimals: 6 }, USDC: { contract: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", decimals: 6 } },
};

export interface WalletRef {
  chain: string;
  address: string;
  token_contract?: string | null;
  code: string;
  decimals: number;
}

function token(w: WalletRef): { contract: string; decimals: number | null } | null {
  if (NATIVE[w.chain]?.includes(w.code.toUpperCase())) return null;
  if (w.token_contract?.trim()) {
    const known = Object.values(TOKENS[w.chain] ?? {}).find((t) => t.contract.toLowerCase() === w.token_contract!.trim().toLowerCase());
    return { contract: w.token_contract.trim(), decimals: known?.decimals ?? null };
  }
  const known = TOKENS[w.chain]?.[w.code.toUpperCase()];
  if (known) return known;
  throw new NetError(`برای ${w.code} روی شبکه‌ی ${w.chain} نشانی قرارداد توکن را در کیف‌پول وارد کنید`);
}

// ---------------------------------------------------------------- adapters

/** Chains without tokens (UTXO coins): the wallet's asset must be the chain's own coin. */
function nativeOnly(w: WalletRef) {
  if (!NATIVE[w.chain]?.includes(w.code.toUpperCase())) throw new NetError(`روی شبکه‌ی ${w.chain} فقط ${NATIVE[w.chain]?.join("/") ?? w.chain} نگهداری می‌شود، نه ${w.code}`);
}

/** decimals() of a TRC20 contract (TronGrid's account answer does not carry it). */
async function trc20Decimals(f: Fetch, owner: string, contract: string): Promise<number> {
  const { json } = await fetchJson(f, "https://api.trongrid.io/wallet/triggerconstantcontract", "TronGrid", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ owner_address: owner, contract_address: contract, function_selector: "decimals()", parameter: "", visible: true }),
  });
  const hex = Array.isArray(json?.constant_result) ? String(json.constant_result[0] ?? "") : "";
  if (json?.result?.result !== true || !/^[0-9a-fA-F]{1,64}$/.test(hex)) throw new NetError("TronGrid: تعداد اعشار توکن خوانده نشد");
  const n = Number(BigInt(`0x${hex}`));
  if (!Number.isFinite(n) || n > 36) throw new NetError("TronGrid: تعداد اعشار توکن معتبر نیست");
  return n;
}

async function esplora(f: Fetch, host: string, label: string, w: WalletRef, withTxs: boolean): Promise<ChainBalance> {
  nativeOnly(w);
  const { text } = await fetchJson(f, `${host}/api/address/${encodeURIComponent(w.address)}`, label);
  const chainPart = text.slice(text.indexOf('"chain_stats"'), text.indexOf('"mempool_stats"') > 0 ? text.indexOf('"mempool_stats"') : undefined);
  const memPart = text.indexOf('"mempool_stats"') >= 0 ? text.slice(text.indexOf('"mempool_stats"')) : "";
  const num = (part: string, key: string) => {
    const m = new RegExp(`"${key}"\\s*:\\s*(\\d+)`).exec(part);
    return BigInt(m ? m[1] : "0");
  };
  if (!chainPart.includes("funded_txo_sum")) throw new NetError(`${label}: پاسخ معتبر نیست`);
  const sats = num(chainPart, "funded_txo_sum") - num(chainPart, "spent_txo_sum") + num(memPart, "funded_txo_sum") - num(memPart, "spent_txo_sum");
  const out: ChainBalance = { balance: fromUnits(sats, 8), source: label };
  if (withTxs) {
    try {
      const { json } = await fetchJson<any[]>(f, `${host}/api/address/${encodeURIComponent(w.address)}/txs`, label);
      out.txs = (Array.isArray(json) ? json : []).slice(0, 10).map((tx) => {
        let net = 0n;
        for (const o of tx.vout ?? []) if (o?.scriptpubkey_address === w.address) net += BigInt(Math.round(Number(o.value) || 0));
        for (const i of tx.vin ?? []) if (i?.prevout?.scriptpubkey_address === w.address) net -= BigInt(Math.round(Number(i.prevout.value) || 0));
        return {
          hash: String(tx.txid ?? ""),
          time: tx.status?.block_time ? new Date(Number(tx.status.block_time) * 1000).toISOString() : null,
          amount: fromUnits(net, 8),
          confirmed: !!tx.status?.confirmed,
        };
      });
    } catch {
      out.txs = [];
    }
  }
  return out;
}

async function doge(f: Fetch, w: WalletRef): Promise<ChainBalance> {
  nativeOnly(w);
  const { json, text } = await fetchJson(f, `https://api.blockcypher.com/v1/doge/main/addrs/${encodeURIComponent(w.address)}/balance`, "BlockCypher");
  if (json?.final_balance === undefined && json?.balance === undefined) throw new NetError("BlockCypher: پاسخ معتبر نیست");
  const raw = json.final_balance !== undefined ? bigIntField(json.final_balance, text, "final_balance") : bigIntField(json.balance, text, "balance");
  return { balance: fromUnits(raw, 8), source: "BlockCypher" };
}

function padAddress(addr: string): string {
  return addr.toLowerCase().replace(/^0x/, "").padStart(64, "0");
}

async function evm(f: Fetch, w: WalletRef): Promise<ChainBalance> {
  const url = EVM_RPC[w.chain];
  const label = `RPC ${w.chain}`;
  const t = token(w);
  const { result: nativeHex } = await jsonRpc<string>(f, url, label, "eth_getBalance", [w.address, "latest"]);
  const native = { code: NATIVE[w.chain][0], balance: fromUnits(hexToDec(nativeHex), 18) };
  if (!t) return { balance: native.balance, source: label };
  let decimals = t.decimals;
  if (decimals === null) {
    const { result } = await jsonRpc<string>(f, url, label, "eth_call", [{ to: t.contract, data: "0x313ce567" }, "latest"]);
    decimals = Number(hexToDec(result));
    if (!Number.isFinite(decimals) || decimals > 36) throw new NetError(`${label}: تعداد اعشار توکن معتبر نیست`);
  }
  const { result } = await jsonRpc<string>(f, url, label, "eth_call", [{ to: t.contract, data: `0x70a08231${padAddress(w.address)}` }, "latest"]);
  return { balance: fromUnits(hexToDec(result), decimals), source: label, native };
}

async function tron(f: Fetch, w: WalletRef, withTxs: boolean): Promise<ChainBalance> {
  const { json, text } = await fetchJson(f, `https://api.trongrid.io/v1/accounts/${encodeURIComponent(w.address)}`, "TronGrid");
  if (json?.success === false) throw new NetError("TronGrid: پاسخ ناموفق");
  const acc = Array.isArray(json?.data) ? json.data[0] : null; // empty list = account not activated yet
  const sun = acc ? bigIntField(acc.balance ?? 0, text, "balance") : "0";
  const native = { code: "TRX", balance: fromUnits(sun, 6) };
  const t = token(w);
  if (!t) return { balance: native.balance, source: "TronGrid" };
  // an unknown contract: its own decimals, never the currency's display decimals
  const decimals = t.decimals ?? (await trc20Decimals(f, w.address, t.contract));
  let raw = "0";
  for (const entry of acc?.trc20 ?? []) {
    for (const [contract, value] of Object.entries(entry as Record<string, string>)) if (contract === t.contract) raw = String(value);
  }
  const out: ChainBalance = { balance: fromUnits(/^\d+$/.test(raw) ? raw : "0", decimals), source: "TronGrid", native };
  if (withTxs) {
    try {
      const { json: tj } = await fetchJson(f, `https://api.trongrid.io/v1/accounts/${encodeURIComponent(w.address)}/transactions/trc20?limit=10&contract_address=${encodeURIComponent(t.contract)}`, "TronGrid");
      out.txs = (Array.isArray(tj?.data) ? tj.data : []).map((x: any) => {
        const incoming = x.to === w.address;
        const amt = fromUnits(/^\d+$/.test(String(x.value)) ? String(x.value) : "0", Number(x.token_info?.decimals ?? decimals));
        return { hash: String(x.transaction_id ?? ""), time: x.block_timestamp ? new Date(Number(x.block_timestamp)).toISOString() : null, amount: incoming ? amt : D(amt).neg().toFixed(), confirmed: true, counterparty: incoming ? x.from : x.to };
      });
    } catch {
      out.txs = [];
    }
  }
  return out;
}

async function solana(f: Fetch, w: WalletRef): Promise<ChainBalance> {
  const { result, text } = await jsonRpc<{ value: number }>(f, SOL_RPC, "RPC Solana", "getBalance", [w.address]);
  const native = { code: "SOL", balance: fromUnits(bigIntField(result?.value ?? 0, text, "value"), 9) };
  const t = token(w);
  if (!t) return { balance: native.balance, source: "RPC Solana" };
  const { result: accounts } = await jsonRpc<{ value: any[] }>(f, SOL_RPC, "RPC Solana", "getTokenAccountsByOwner", [w.address, { mint: t.contract }, { encoding: "jsonParsed" }]);
  let total = D(0);
  for (const a of accounts?.value ?? []) {
    const ta = a?.account?.data?.parsed?.info?.tokenAmount;
    if (!ta) continue;
    total = total.plus(ta.amount !== undefined ? D(fromUnits(String(ta.amount), Number(ta.decimals ?? t.decimals ?? 6))) : D(ta.uiAmountString ?? 0));
  }
  return { balance: total.toFixed(), source: "RPC Solana", native };
}

async function ton(f: Fetch, w: WalletRef): Promise<ChainBalance> {
  if (token(w)) throw new NetError("موجودی توکن‌های شبکه‌ی TON هنوز پشتیبانی نمی‌شود");
  const { json } = await fetchJson(f, `https://toncenter.com/api/v2/getAddressBalance?address=${encodeURIComponent(w.address)}`, "toncenter");
  if (!json?.ok || !/^\d+$/.test(String(json.result))) throw new NetError("toncenter: پاسخ معتبر نیست");
  return { balance: fromUnits(String(json.result), 9), source: "toncenter" };
}

/** Live balance of one address on its chain (and the last transactions where it is cheap). */
export async function chainBalance(f: Fetch, w: WalletRef, opts: { txs?: boolean } = {}): Promise<ChainBalance> {
  switch (w.chain) {
    case "BTC":
      return esplora(f, "https://mempool.space", "mempool.space", w, !!opts.txs);
    case "LTC":
      return esplora(f, "https://litecoinspace.org", "litecoinspace", w, !!opts.txs);
    case "DOGE":
      return doge(f, w);
    case "ETH":
    case "BSC":
    case "POLYGON":
    case "ARBITRUM":
    case "BASE":
      return evm(f, w);
    case "TRON":
      return tron(f, w, !!opts.txs);
    case "SOL":
      return solana(f, w);
    case "TON":
      return ton(f, w);
    default:
      throw new NetError(`شبکه‌ی ${w.chain} پشتیبانی نمی‌شود`);
  }
}

// ---------------------------------------------------------------- service

interface WalletRow {
  id: string;
  name: string;
  code: string | null;
  chain: string;
  address: string;
  token_contract: string | null;
  kind: string;
  currency_id: string | null;
  currency_code: string | null;
  currency_decimals: number | null;
  detail_id: string | null;
  owner_party_id: string | null;
  owner_name: string | null;
  last_balance: string | null;
  last_checked_at: string | null;
  last_error: string | null;
  auto_check: boolean;
  notes: string | null;
}

const WALLET_SELECT = `
  select w.id, w.name, w.code, w.chain, w.address, w.token_contract, w.kind, w.currency_id, c.code as currency_code, c.decimals as currency_decimals,
         w.detail_id, w.owner_party_id, p.name as owner_name, w.last_balance, w.last_checked_at, w.last_error, w.auto_check, w.notes
  from tz_wallets w left join tz_currencies c on c.id = w.currency_id left join tz_parties p on p.id = w.owner_party_id`;

/** Book balance of wallets: Σ amount and Σ base on «کیف‌پول‌های رمزارز» per wallet detail. */
async function bookBalances(ctx: Ctx, wallets: WalletRow[]): Promise<Map<string, { fx: string; base: string }>> {
  const details = wallets.map((w) => w.detail_id).filter(Boolean) as string[];
  if (!details.length) return new Map();
  const rows = await ctx.db.query<{ detail_id: string; currency_id: string; fx: string; base: string }>(
    `select l.detail_id, l.currency_id, sum(l.fx_debit - l.fx_credit) as fx, sum(l.debit - l.credit) as base
     from tz_voucher_lines l join tz_vouchers v on v.id = l.voucher_id join tz_accounts a on a.id = l.account_id
     where l.org_id = $1 and a.system_key = 'crypto_wallets' and l.detail_id = any($2::uuid[]) and ${LIVE}
     group by l.detail_id, l.currency_id`,
    [ctx.org.id, `{${details.join(",")}}`],
  );
  const out = new Map<string, { fx: string; base: string }>();
  for (const w of wallets) {
    const r = rows.find((x) => x.detail_id === w.detail_id && x.currency_id === w.currency_id);
    out.set(w.id, { fx: r?.fx ?? "0", base: r?.base ?? "0" });
  }
  return out;
}

function shape(w: WalletRow, book: { fx: string; base: string } | undefined) {
  const live = w.last_balance;
  const b = book?.fx ?? "0";
  return {
    ...w,
    book_balance: b,
    book_value: book?.base ?? "0",
    difference: live === null || live === undefined ? null : D(live).minus(D(b)).toFixed(),
  };
}

export async function listWallets(ctx: Ctx) {
  ctx.need("fx", "view");
  const wallets = await ctx.db.query<WalletRow>(`${WALLET_SELECT} where w.org_id = $1 and w.deleted_at is null order by w.name`, [ctx.org.id]);
  const books = await bookBalances(ctx, wallets);
  return { rows: wallets.map((w) => shape(w, books.get(w.id))) };
}

async function check(ctx: Ctx, w: WalletRow, withTxs: boolean): Promise<{ id: string; balance: string | null; error: string | null; result: ChainBalance | null }> {
  if (!w.currency_code) return { id: w.id, balance: null, error: "دارایی کیف‌پول مشخص نیست", result: null };
  try {
    const result = await chainBalance(ctx.cfg.fetch, { chain: w.chain, address: w.address, token_contract: w.token_contract, code: w.currency_code, decimals: Number(w.currency_decimals ?? 8) }, { txs: withTxs });
    return { id: w.id, balance: result.balance, error: null, result };
  } catch (e) {
    return { id: w.id, balance: null, error: e instanceof NetError ? e.message : "بررسی موجودی ممکن نشد", result: null };
  }
}

/** Network calls first, then one short write with the results (never hold the database while waiting). */
async function store(ctx: Ctx, results: { id: string; balance: string | null; error: string | null }[]) {
  const now = new Date().toISOString();
  await ctx.write(async (tx) => {
    for (const r of results) {
      if (r.balance !== null) {
        await tx.query(`update tz_wallets set last_balance = $3, last_checked_at = $4, last_error = null, origin = $5 where id = $1 and org_id = $2`, [r.id, ctx.org.id, r.balance, now, ctx.cfg.origin]);
      } else {
        await tx.query(`update tz_wallets set last_checked_at = $3, last_error = $4, origin = $5 where id = $1 and org_id = $2`, [r.id, ctx.org.id, now, r.error, ctx.cfg.origin]);
      }
    }
  });
}

export async function refreshWallet(ctx: Ctx, id: string) {
  ctx.need("fx", "view");
  if (!isUuid(id)) throw notFound("کیف‌پول پیدا نشد");
  const w = await ctx.db.one<WalletRow>(`${WALLET_SELECT} where w.id = $1 and w.org_id = $2 and w.deleted_at is null`, [id, ctx.org.id]);
  if (!w) throw notFound("کیف‌پول پیدا نشد");
  const r = await check(ctx, w, true);
  await store(ctx, [r]);
  const fresh = (await ctx.db.one<WalletRow>(`${WALLET_SELECT} where w.id = $1`, [id]))!;
  const books = await bookBalances(ctx, [fresh]);
  return {
    wallet: shape(fresh, books.get(id)),
    live: r.balance,
    error: r.error,
    source: r.result?.source ?? null,
    native: r.result?.native ?? null,
    txs: r.result?.txs ?? [],
    message: r.error ? r.error : `موجودی زنده: ${formatNumber(r.balance!, { dp: Number(w.currency_decimals ?? 8) })} ${w.currency_code}`,
  };
}

export async function refreshAllWallets(ctx: Ctx) {
  ctx.need("fx", "view");
  const wallets = await ctx.db.query<WalletRow>(`${WALLET_SELECT} where w.org_id = $1 and w.deleted_at is null and w.auto_check order by w.name`, [ctx.org.id]);
  if (!wallets.length) throw bad("کیف‌پولی با «بررسی خودکار موجودی» ثبت نشده است");
  const results = await mapLimit(wallets, 4, (w) => check(ctx, w, false));
  await store(ctx, results);
  const list = await listWallets(ctx);
  return { ...list, checked: results.length, failed: results.filter((r) => r.error).length };
}
