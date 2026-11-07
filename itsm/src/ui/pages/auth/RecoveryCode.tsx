import { useState } from "react";
import { Button, Checkbox } from "antd";
import { Copy, Check, Download } from "lucide-react";
import { APP_NAME, APP_NAME_EN } from "@shared/constants";
import { FormAlert, ICON } from "../kit";

/**
 * The recovery code, shown once after sign-up, first run and recovery. Four Latin groups in Geist Mono (the code is
 * Latin by nature), copy and save-as-file, and an acknowledgement before continuing — it is never shown again.
 */
export function RecoveryCode({ code, onDone }: { code: string; onDone: () => void | Promise<void> }) {
  const [copied, setCopied] = useState(false);
  const [kept, setKept] = useState(false);
  const [busy, setBusy] = useState(false);
  const groups = code.split(/[-\s]+/).filter(Boolean);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
    } catch {
      // older shells: select the text so Ctrl C still works
      const r = document.createRange();
      const el = document.getElementById("pg-key-groups");
      if (el) {
        r.selectNodeContents(el);
        window.getSelection()?.removeAllRanges();
        window.getSelection()?.addRange(r);
      }
    }
    setCopied(true);
    setKept(true);
    window.setTimeout(() => setCopied(false), 2000);
  };

  const save = () => {
    const text = `${APP_NAME_EN} recovery code\n\n${code}\n\nکد بازیابی ${APP_NAME} — با این کد می‌توانید رمز عبور تازه بگذارید. آن را جای امنی نگه دارید.\n`;
    const url = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: `${APP_NAME_EN.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-recovery-code.txt` });
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    setKept(true);
  };

  return (
    <div>
      <FormAlert tone="warning">
        <b>فقط همین یک بار</b> نمایش داده می‌شود. اگر رمز عبور را فراموش کنید، تنها با این کد می‌توانید رمز تازه بگذارید.
      </FormAlert>
      <div className="pg-key">
        <div id="pg-key-groups" className="pg-key-groups" aria-label={`کد بازیابی: ${code}`} role="group">
          {groups.map((g, i) => (
            <span key={i} className="pg-key-g">
              {g}
            </span>
          ))}
        </div>
        <div className="pg-key-tools">
          <Button icon={copied ? <Check {...ICON} /> : <Copy {...ICON} />} onClick={copy} aria-live="polite">
            {copied ? "کپی شد" : "کپی"}
          </Button>
          <Button icon={<Download {...ICON} />} onClick={save}>
            ذخیره در فایل
          </Button>
        </div>
      </div>
      <Checkbox className="!mt-5" checked={kept} onChange={(e) => setKept(e.target.checked)}>
        کد را جای امنی نگه داشتم.
      </Checkbox>
      <div className="pg-actions !mt-5">
        <Button
          type="primary"
          size="large"
          block
          disabled={!kept}
          loading={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await onDone();
            } finally {
              setBusy(false);
            }
          }}
        >
          ادامه
        </Button>
      </div>
    </div>
  );
}
