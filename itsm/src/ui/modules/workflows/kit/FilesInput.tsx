// `FilesInput` (design F §3.1 «پیوست»): the value of an attachments field — json storage holding the ids of the same
// record's attachments (check `attachments`: at most `max` files, of the `accept` kinds). A drop zone with a real
// button (keyboard and screen readers) adds files: each is checked here first (kind and count, the server checks
// again), uploaded, and its id joins the value. Removing a file from the field leaves it among the record's
// attachments. Without an uploader (a record not saved yet) the zone says when files can be added.
//   · `FilesInput`        the control itself: the files the value may name and an uploader are given to it;
//   · `RecordFilesInput`  a record's field: the record's attachments and the record API's upload (FieldInput uses it);
//   · `FilesValue`        a stored value read-only: the files' names when known, else how many there are.
import { useRef, useState, type DragEvent } from "react";
import { Button } from "antd";
import { FileText, Paperclip, Upload, X } from "lucide-react";
import { faDigits } from "@shared/format";
import { ApiError } from "../../../lib/api";
import { useOrg } from "../../../lib/org";
import { cx } from "../../../components/blocks";
import { Loader } from "../../../components/display";
import { attachmentUrl } from "../../../records/data/api";
import { useAttachments, useRecordActions } from "../../../records/data/hooks";
import { displayOf } from "../../../records/model/schema";
import type { DisplayMap } from "../../../records/model/types";
import { acceptAttr, acceptText, fileIds, fileProblem, filesMax, sizeText } from "./files";
import "./kit.css";

const I14 = { size: 14, strokeWidth: 1.5, absoluteStrokeWidth: true } as const;

export interface FileItem {
  id: string;
  name: string;
  size?: number;
}

export interface FilesFieldLike {
  label: string;
  max?: number | null;
  accept?: string[] | null;
  required?: boolean;
}

export interface FilesInputProps {
  /** the stored value: attachment ids (or `{ id }` objects) */
  value: unknown;
  onChange: (ids: string[] | null) => void;
  field: FilesFieldLike;
  /** the files the value may name (the record's attachments) */
  files: readonly FileItem[];
  /** adds a file and returns it; absent: files cannot be added now */
  upload?: (file: File, signal: AbortSignal) => Promise<FileItem>;
  /** opens a file */
  hrefOf?: (id: string) => string;
  /** why files cannot be added now (without `upload`) */
  unavailable?: string;
  /** the files are still loading */
  loading?: boolean;
  disabled?: boolean;
  id?: string;
  status?: "error" | "warning";
  "aria-label"?: string;
}

interface Pending {
  key: string;
  name: string;
  error?: string;
  ctl?: AbortController;
}

export function FilesInput({ value, onChange, field, files, upload, hrefOf, unavailable, loading, disabled, id, status, "aria-label": aria }: FilesInputProps) {
  const ids = fileIds(value);
  const input = useRef<HTMLInputElement | null>(null);
  const [over, setOver] = useState(false);
  const [pending, setPending] = useState<Pending[]>([]);
  const max = filesMax(field);
  const canAdd = !!upload && !disabled;
  const kinds = acceptText(field.accept);
  const label = aria ?? field.label;
  const byId = new Map(files.map((f) => [f.id.toLowerCase(), f]));
  const busy = pending.filter((p) => !p.error).length;

  const add = async (list: FileList | File[]) => {
    if (!upload) return;
    let current = [...ids];
    for (const file of Array.from(list)) {
      const key = `${file.name}:${file.size}:${Math.random()}`;
      const problem = fileProblem(field, file.name, current.length + 1 + pending.filter((p) => !p.error).length);
      if (problem) {
        setPending((p) => [...p, { key, name: file.name, error: problem }]);
        continue;
      }
      const ctl = new AbortController();
      setPending((p) => [...p, { key, name: file.name, ctl }]);
      try {
        const saved = await upload(file, ctl.signal);
        current = [...current.filter((x) => x !== saved.id.toLowerCase()), saved.id.toLowerCase()];
        onChange(current);
        setPending((p) => p.filter((x) => x.key !== key));
      } catch (e) {
        if (ctl.signal.aborted) setPending((p) => p.filter((x) => x.key !== key));
        else setPending((p) => p.map((x) => (x.key === key ? { ...x, error: e instanceof ApiError ? e.message : `بارگذاری «${file.name}» انجام نشد` } : x)));
      }
    }
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    if (canAdd && e.dataTransfer.files?.length) void add(e.dataTransfer.files);
  };

  return (
    <div className={cx("wfk-files", status === "error" && "has-error")} id={id} role="group" aria-label={label}>
      {ids.map((fid) => {
        const f = byId.get(fid);
        const name = f?.name ?? (loading ? "…" : "پیوستی که دیگر در این رکورد نیست");
        return (
          <div key={fid} className="wfk-file">
            <FileText {...I14} aria-hidden />
            {f && hrefOf ? (
              <a className="wfk-file-n ds-link" href={hrefOf(fid)} target="_blank" rel="noopener noreferrer" dir="auto">
                {name}
              </a>
            ) : (
              <span className="wfk-file-n" dir="auto">
                {name}
              </span>
            )}
            {f?.size ? <span className="wfk-file-s">{sizeText(f.size)}</span> : null}
            {disabled ? null : (
              <button type="button" aria-label={`برداشتن «${name}» از ${field.label}`} onClick={() => onChange(ids.filter((x) => x !== fid).length ? ids.filter((x) => x !== fid) : null)}>
                <X {...I14} aria-hidden />
              </button>
            )}
          </div>
        );
      })}
      {pending.map((p) => (
        <div key={p.key} className={cx("wfk-file", p.error && "is-error")} role={p.error ? "alert" : undefined}>
          {p.error ? <X {...I14} aria-hidden /> : <Loader label="در حال بارگذاری" />}
          <span className="wfk-file-n" dir="auto">
            {p.error ?? p.name}
          </span>
          <button
            type="button"
            aria-label={p.error ? `بستن پیام «${p.name}»` : `لغو بارگذاری «${p.name}»`}
            onClick={() => {
              p.ctl?.abort();
              setPending((x) => x.filter((y) => y.key !== p.key));
            }}
          >
            <X {...I14} aria-hidden />
          </button>
        </div>
      ))}
      {disabled ? null : (
        <div
          className={cx("wfk-drop", over && "is-over", !canAdd && "is-off")}
          onDragOver={(e) => {
            if (!canAdd) return;
            e.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={onDrop}
        >
          {canAdd ? (
            <>
              <Button size="small" icon={<Upload {...I14} />} onClick={() => input.current?.click()} disabled={ids.length + busy >= max} aria-label={`افزودن پرونده به ${field.label}`}>
                افزودن پرونده
              </Button>
              <span>یا پرونده‌ها را این‌جا رها کنید</span>
              <small>
                {kinds ? `${kinds}؛ ` : ""}حداکثر {faDigits(max)} پرونده
              </small>
              <input
                ref={input}
                type="file"
                multiple={max > 1}
                hidden
                accept={acceptAttr(field.accept) || undefined}
                onChange={(e) => {
                  if (e.target.files?.length) void add(e.target.files);
                  e.target.value = "";
                }}
              />
            </>
          ) : (
            <span>
              <Paperclip {...I14} aria-hidden /> {unavailable ?? "پس از ذخیرهٔ رکورد می‌توانید پرونده بیفزایید."}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

/** A record's attachments field: the record's own attachments, uploads through the record API. */
export function RecordFilesInput({ table, recordId, ...rest }: Omit<FilesInputProps, "files" | "upload" | "hrefOf" | "loading"> & { table: string; recordId: string | null | undefined }) {
  const { orgId } = useOrg();
  const list = useAttachments(table, recordId);
  const actions = useRecordActions(table);
  const files = (list.data?.attachments ?? []).map((a) => ({ id: a.id, name: a.name, size: a.size }));
  return (
    <FilesInput
      {...rest}
      files={files}
      loading={list.isLoading && !!recordId}
      hrefOf={(fid) => attachmentUrl(orgId, fid)}
      upload={recordId ? async (file, signal) => {
        const a = await actions.upload(recordId, file, signal);
        return { id: a.id, name: a.name, size: a.size };
      } : undefined}
    />
  );
}

/** A stored attachments value read-only: the names when the display map knows them, else the count. */
export function FilesValue({ value, display, compact }: { value: unknown; display?: DisplayMap; compact?: boolean }) {
  const ids = fileIds(value);
  if (!ids.length) return null;
  const names = ids.map((x) => displayOf(display, x));
  if (!compact && names.every(Boolean))
    return (
      <span className="wfk-files-v">
        {names.map((n, i) => (
          <span key={ids[i]}>
            <Paperclip {...I14} aria-hidden /> <bdi dir="auto">{n}</bdi>
          </span>
        ))}
      </span>
    );
  return (
    <span className="wfk-files-v">
      <Paperclip {...I14} aria-hidden />
      <span>{faDigits(ids.length)} پرونده</span>
    </span>
  );
}
