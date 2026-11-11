// «شمارش با گوشی»: a physical audit counted on a phone. The camera reads QR codes and barcodes through the
// browser's BarcodeDetector (no library, nothing fetched from a CDN); where the browser has none, a keyboard-wedge
// scanner or typing works the same way. Each code goes to the audit's scan endpoint (the counter's own access: an asset
// they may not read is «ثبت‌نشده»), with a vibration for the result and the running counts.
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { App, Button, Input, type InputRef } from "antd";
import { Camera, CameraOff, ScanBarcode } from "lucide-react";
import type { ScanResult } from "@shared/itam/api";
import { useOrg } from "../../lib/org";
import { fa } from "../../lib/fa";
import { PageHeader } from "../../components/layout";
import { Note } from "../../components/blocks";
import { Chip, Loader, StatCard } from "../../components/display";
import { recordsApi } from "../../records";
import { itamApi } from "./api";
import { ICON } from "./parts";

interface DetectedBarcode { rawValue: string }
interface BarcodeDetectorLike { detect(source: CanvasImageSource): Promise<DetectedBarcode[]> }
type DetectorCtor = new (opts?: { formats?: string[] }) => BarcodeDetectorLike;

const FORMATS = ["qr_code", "code_128", "code_39", "ean_13", "ean_8", "data_matrix", "itf"];
const RESULT: Record<ScanResult["result"], [string, "in" | "warning" | "danger" | "neutral" | "accent"]> = {
  found: ["دیده شد", "in"], moved: ["جابه‌جا", "warning"], unexpected: ["ناشناخته", "danger"], duplicate: ["تکراری", "neutral"], unknown: ["ثبت‌نشده", "danger"],
};

const detectorCtor = (): DetectorCtor | null => (typeof window !== "undefined" && "BarcodeDetector" in window ? ((window as unknown as { BarcodeDetector: DetectorCtor }).BarcodeDetector) : null);

export default function MobileScan() {
  const { id = "" } = useParams();
  const { api, orgId } = useOrg();
  const { message } = App.useApp();
  const nav = useNavigate();
  const audit = useQuery({ queryKey: ["itam", orgId, "audit", id], queryFn: () => recordsApi.get(api, "inventory_audit", id) });
  const [log, setLog] = useState<(ScanResult & { code: string })[]>([]);
  const [code, setCode] = useState("");
  const [camera, setCamera] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const timer = useRef<number | null>(null);
  const last = useRef<{ code: string; at: number }>({ code: "", at: 0 });
  const input = useRef<InputRef>(null);
  const scan = useMutation({
    mutationFn: (c: string) => itamApi.scan(api, id, c),
    onSuccess: (r, c) => {
      setLog((xs) => [{ ...r, code: c }, ...xs].slice(0, 30));
      try {
        navigator.vibrate?.(r.result === "found" ? 60 : [60, 60, 60]);
      } catch {
        /* no vibration */
      }
    },
    onError: (e: Error) => message.error(e.message),
  });
  const submit = useCallback((raw: string) => {
    const c = raw.trim();
    if (!c) return;
    const now = Date.now();
    if (c === last.current.code && now - last.current.at < 2500) return;
    last.current = { code: c, at: now };
    scan.mutate(c);
  }, [scan]);
  const stop = useCallback(() => {
    if (timer.current) window.clearInterval(timer.current);
    timer.current = null;
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    setCamera(false);
  }, []);
  const start = async () => {
    const Ctor = detectorCtor();
    if (!Ctor) {
      setProblem("این مرورگر خواندن بارکد با دوربین را ندارد؛ از Chrome یا Edge روی اندروید استفاده کنید یا کد را با بارکدخوان یا تایپ وارد کنید.");
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setProblem("دسترسی به دوربین در این صفحه ممکن نیست (برای دوربین، سامانه باید با HTTPS باز شده باشد).");
      return;
    }
    try {
      const detector = new Ctor({ formats: FORMATS });
      const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
      stream.current = s;
      if (video.current) {
        video.current.srcObject = s;
        await video.current.play().catch(() => undefined);
      }
      setProblem(null);
      setCamera(true);
      timer.current = window.setInterval(() => {
        const v = video.current;
        if (!v || v.readyState < 2) return;
        void detector.detect(v).then((codes) => {
          if (codes[0]?.rawValue) submit(codes[0].rawValue);
        }).catch(() => undefined);
      }, 350);
    } catch (e) {
      setProblem(`دوربین باز نشد: ${(e as Error).message}`);
      stop();
    }
  };
  useEffect(() => stop, [stop]);
  const row = audit.data?.row as Record<string, any> | undefined;
  const counts = log[0]?.counts ?? (row ? { expected: Number(row.expected_count ?? 0), found: Number(row.found_count ?? 0), missing: Number(row.missing_count ?? 0), unexpected: Number(row.unexpected_count ?? 0) } : null);
  return (
    <div className="itam-scan">
      <PageHeader title={row ? `شمارش ${row.number ?? ""}` : "شمارش با گوشی"} back={`/${orgId}/itam/audits/${id}`} />
      {audit.isLoading ? <Loader /> : !row ? <Note tone="warning">شمارش پیدا نشد.</Note> : row.state !== "in_progress" ? (
        <Note tone="warning" action={<Button size="small" onClick={() => nav(`/${orgId}/itam/audits/${id}`)}>بازگشت</Button>}>این شمارش در حال انجام نیست.</Note>
      ) : (
        <div className="flex flex-col gap-3">
          {counts ? (
            <div className="itam-scan-counts">
              <StatCard title="مورد انتظار" value={fa(counts.expected)} />
              <StatCard title="دیده‌شده" value={fa(counts.found)} />
              <StatCard title="ناشناخته" value={fa(counts.unexpected)} />
            </div>
          ) : null}
          <div className="itam-scan-view" data-on={camera ? "1" : "0"}>
            <video ref={video} playsInline muted aria-label="تصویر دوربین" />
            {!camera ? <ScanBarcode size={40} strokeWidth={1.2} aria-hidden /> : <span className="itam-scan-frame" aria-hidden />}
          </div>
          {problem ? <Note tone="warning">{problem}</Note> : null}
          <Button size="large" block type={camera ? "default" : "primary"} icon={camera ? <CameraOff {...ICON} /> : <Camera {...ICON} />} onClick={() => (camera ? stop() : void start())}>
            {camera ? "بستن دوربین" : "اسکن با دوربین"}
          </Button>
          <Input.Search
            ref={input}
            size="large"
            dir="ltr"
            value={code}
            enterButton="ثبت"
            placeholder="پلاک، سریال یا پیوند QR"
            aria-label="کد"
            onChange={(e) => setCode(e.target.value)}
            onSearch={(v) => {
              submit(v);
              setCode("");
              input.current?.focus();
            }}
          />
          <ul className="itam-list" aria-live="polite">
            {log.map((r, i) => (
              <li key={`${r.code}-${i}`}>
                <span className="flex flex-col">
                  <span>{r.asset ? r.asset.name : r.message}</span>
                  <span className="text-[12px] text-ink-3" dir="ltr">{r.asset?.asset_tag ?? r.code}</span>
                </span>
                <Chip tone={RESULT[r.result][1]}>{RESULT[r.result][0]}</Chip>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
