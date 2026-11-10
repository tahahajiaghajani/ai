// The customer's signature on the technician's screen (FSM-023): a pad drawn with a finger, pen or mouse; «پاک کردن»
// starts again; `onReady` hands the drawing over as a PNG file (uploaded as the visit's attachment by the caller).
import { useEffect, useRef, useState } from "react";
import { Button } from "antd";
import { Eraser } from "lucide-react";
import { ICON } from "../../components/blocks";

export function SignaturePad({ onChange }: { onChange: (file: File | null) => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const [empty, setEmpty] = useState(true);

  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const ratio = window.devicePixelRatio || 1;
    c.width = c.clientWidth * ratio;
    c.height = c.clientHeight * ratio;
    const g = c.getContext("2d");
    if (!g) return;
    g.scale(ratio, ratio);
    g.lineWidth = 2;
    g.lineCap = "round";
    g.lineJoin = "round";
    // the ink of the theme (the canvas inherits --ds-text as its colour); a canvas keeps its default black otherwise
    const ink = getComputedStyle(c).color || getComputedStyle(c).getPropertyValue("--ds-text").trim();
    if (ink) g.strokeStyle = ink;
  }, []);

  const point = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const finish = () => {
    if (!drawing.current) return;
    drawing.current = false;
    ref.current?.toBlob((b) => onChange(b ? new File([b], "signature.png", { type: "image/png" }) : null), "image/png");
  };
  const clear = () => {
    const c = ref.current;
    c?.getContext("2d")?.clearRect(0, 0, c.width, c.height);
    setEmpty(true);
    onChange(null);
  };

  return (
    <div className="fs-sign">
      <canvas
        ref={ref}
        className="text-ink"
        aria-label="محل امضای مشتری"
        onPointerDown={(e) => {
          const g = e.currentTarget.getContext("2d");
          if (!g) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          const p = point(e);
          g.beginPath();
          g.moveTo(p.x, p.y);
          drawing.current = true;
        }}
        onPointerMove={(e) => {
          if (!drawing.current) return;
          const g = e.currentTarget.getContext("2d");
          const p = point(e);
          g?.lineTo(p.x, p.y);
          g?.stroke();
          if (empty) setEmpty(false);
        }}
        onPointerUp={finish}
        onPointerCancel={finish}
        onPointerLeave={finish}
      />
      <div className="flex items-center gap-2 text-[12px] text-ink-3">
        <Button size="small" icon={<Eraser {...ICON} />} onClick={clear} disabled={empty}>پاک کردن</Button>
        <span>{empty ? "مشتری با انگشت یا قلم این‌جا امضا کند." : "امضا ثبت شد؛ برای امضای دوباره پاک کنید."}</span>
      </div>
    </div>
  );
}
