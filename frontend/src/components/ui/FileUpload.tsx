import { AlertTriangle, ChevronDown, FileSpreadsheet, Trash2, UploadCloud } from 'lucide-react';
import { useId, useRef, useState, type DragEvent } from 'react';
import type { RecipientFile } from '../../types/email';
import { cn } from '../../utils/cn';
import { formatFileSize, formatNumber } from '../../utils/format';
import { Spinner } from './Spinner';

export interface FileUploadProps {
  label: string;
  hint?: string;
  accept?: string;
  file: RecipientFile | null;
  isParsing?: boolean;
  error?: string;
  onFileSelected: (file: File) => void;
  onRemove: () => void;
}

export function FileUpload({
  label,
  hint,
  accept = '.csv,.tsv,.txt',
  file,
  isParsing = false,
  error,
  onFileSelected,
  onRemove,
}: FileUploadProps) {
  const inputId = useId();
  const detailsId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [showInvalid, setShowInvalid] = useState(false);

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setIsDragging(false);
    const dropped = event.dataTransfer.files?.[0];
    if (dropped) onFileSelected(dropped);
  }

  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-sm font-medium text-slate-700">{label}</span>

      {file ? (
        <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
          <div className="flex items-start gap-3 p-4">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
              <FileSpreadsheet className="h-5 w-5" aria-hidden="true" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-slate-900">{file.name}</p>
              <p className="mt-0.5 text-xs text-slate-500">
                {formatFileSize(file.size)} · {formatNumber(file.totalLines)} row
                {file.totalLines === 1 ? '' : 's'} read
              </p>
            </div>
            <button
              type="button"
              onClick={onRemove}
              className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-red-50 hover:text-red-600"
              aria-label={`Remove ${file.name}`}
            >
              <Trash2 className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>

          <p className="border-t border-slate-100 px-4 py-2.5 text-sm text-slate-900">
            <span className="font-semibold">{formatNumber(file.validCount)}</span> email address
            {file.validCount === 1 ? '' : 'es'} detected
            {file.invalidCount + file.duplicateCount > 0 ? (
              <span className="text-slate-500">
                {' '}· {formatNumber(file.invalidCount)} invalid,{' '}
                {formatNumber(file.duplicateCount)} duplicate
                {file.duplicateCount === 1 ? '' : 's'} removed
              </span>
            ) : null}
          </p>

          {file.truncated ? (
            <p
              role="alert"
              className="flex items-start gap-2 border-t border-amber-100 bg-amber-50 px-4 py-2.5 text-xs text-amber-800"
            >
              <AlertTriangle className="mt-px h-4 w-4 shrink-0" aria-hidden="true" />
              <span>
                A campaign holds up to {formatNumber(file.maxRecipients)} recipients. The first{' '}
                {formatNumber(file.schedulableCount)} will be scheduled — split the rest into
                another campaign.
              </span>
            </p>
          ) : null}

          {file.invalidEntries.length > 0 ? (
            <div className="border-t border-slate-100">
              <button
                type="button"
                onClick={() => setShowInvalid((open) => !open)}
                aria-expanded={showInvalid}
                aria-controls={detailsId}
                className="flex w-full items-center justify-between px-4 py-2.5 text-left text-xs font-medium text-slate-600 transition-colors hover:bg-slate-50"
              >
                <span>
                  Review {formatNumber(file.invalidEntries.length)} skipped row
                  {file.invalidEntries.length === 1 ? '' : 's'}
                </span>
                <ChevronDown
                  className={cn('h-4 w-4 transition-transform', showInvalid && 'rotate-180')}
                  aria-hidden="true"
                />
              </button>

              {showInvalid ? (
                <ul
                  id={detailsId}
                  className="max-h-44 divide-y divide-slate-100 overflow-y-auto border-t border-slate-100 bg-slate-50/60"
                >
                  {file.invalidEntries.map((entry) => (
                    <li
                      key={`${entry.line}-${entry.value}`}
                      className="flex items-baseline gap-3 px-4 py-2 text-xs"
                    >
                      <span className="shrink-0 tabular-nums text-slate-400">
                        Line {entry.line}
                      </span>
                      <span className="min-w-0 flex-1 truncate font-mono text-slate-700">
                        {entry.value || '(empty)'}
                      </span>
                      <span className="shrink-0 text-amber-700">{entry.reason}</span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : (
        <div
          onDragOver={(event) => {
            event.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={handleDrop}
          className={cn(
            'flex flex-col items-center justify-center rounded-lg border-2 border-dashed px-6 py-8 text-center transition-colors',
            isDragging ? 'border-brand-500 bg-brand-50' : 'border-slate-300 bg-slate-50/60',
            error && !isDragging && 'border-red-300 bg-red-50/40',
          )}
        >
          {isParsing ? (
            <>
              <Spinner size="lg" className="text-brand-600" label="Checking addresses" />
              <p className="mt-3 text-sm text-slate-600">Checking addresses…</p>
            </>
          ) : (
            <>
              <span className="flex h-11 w-11 items-center justify-center rounded-full bg-white text-slate-500 shadow-sm ring-1 ring-slate-200">
                <UploadCloud className="h-5 w-5" aria-hidden="true" />
              </span>
              <p className="mt-3 text-sm font-medium text-slate-700">
                Drag &amp; drop your recipient list here
              </p>
              <p className="mt-1 text-xs text-slate-500">
                CSV, TSV or TXT — one address per row, up to 5 MB
              </p>
              <label
                htmlFor={inputId}
                className="mt-4 inline-flex h-9 cursor-pointer items-center rounded-lg border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 shadow-sm transition-colors hover:bg-slate-50 focus-within:ring-2 focus-within:ring-brand-500 focus-within:ring-offset-2"
              >
                Browse files
              </label>
            </>
          )}
          <input
            ref={inputRef}
            id={inputId}
            type="file"
            accept={accept}
            className="sr-only"
            disabled={isParsing}
            onChange={(event) => {
              const selected = event.target.files?.[0];
              if (selected) onFileSelected(selected);
              event.target.value = '';
            }}
          />
        </div>
      )}

      {error ? (
        <p role="alert" className="text-xs font-medium text-red-600">
          {error}
        </p>
      ) : hint ? (
        <p className="text-xs text-slate-500">{hint}</p>
      ) : null}
    </div>
  );
}
