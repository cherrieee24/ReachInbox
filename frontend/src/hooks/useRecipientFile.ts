import { useCallback, useState } from 'react';
import { ApiError } from '../api';
import { emailService } from '../services/email.service';
import type { RecipientFile } from '../types/email';

const MAX_BYTES = 5 * 1024 * 1024;
const ACCEPTED = ['.csv', '.txt', '.tsv'];

interface UseRecipientFileResult {
  file: RecipientFile | null;
  isParsing: boolean;
  error: string | undefined;
  select: (file: File) => void;
  remove: () => void;
  reset: () => void;
}

function readAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
    reader.onerror = () => reject(new Error('Could not read that file.'));
    reader.readAsText(file);
  });
}

/**
 * Reads a recipient list and has the **server** parse it. The browser only
 * loads the bytes — every count shown to the user, and the address list that
 * eventually gets scheduled, comes back from the API. A tampered client
 * therefore cannot smuggle malformed addresses into a campaign.
 */
export function useRecipientFile(): UseRecipientFileResult {
  const [file, setFile] = useState<RecipientFile | null>(null);
  const [isParsing, setIsParsing] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  const remove = useCallback(() => {
    setFile(null);
    setError(undefined);
  }, []);

  const select = useCallback((selected: File) => {
    setError(undefined);

    const name = selected.name.toLowerCase();
    if (!ACCEPTED.some((ext) => name.endsWith(ext))) {
      setFile(null);
      setError('Unsupported file type. Upload a .csv, .tsv or .txt file.');
      return;
    }
    if (selected.size === 0) {
      setFile(null);
      setError('That file is empty.');
      return;
    }
    if (selected.size > MAX_BYTES) {
      setFile(null);
      setError('File is larger than 5 MB. Split it into smaller lists.');
      return;
    }

    setIsParsing(true);
    void (async () => {
      try {
        const content = await readAsText(selected);
        if (!content.trim()) {
          setFile(null);
          setError('That file has no content.');
          return;
        }

        const report = await emailService.validateRecipientFile(content, selected.name);

        if (report.validCount === 0) {
          setFile(null);
          setError(
            report.invalidCount > 0
              ? `No valid email addresses found — all ${report.invalidCount} row(s) were rejected.`
              : 'No email addresses found in this file.',
          );
          return;
        }

        setFile({ ...report, name: selected.name, size: selected.size });
      } catch (cause) {
        setFile(null);
        setError(
          cause instanceof ApiError
            ? cause.message
            : cause instanceof Error
              ? cause.message
              : 'Could not read that file. Try again.',
        );
      } finally {
        setIsParsing(false);
      }
    })();
  }, []);

  const reset = useCallback(() => {
    setFile(null);
    setError(undefined);
    setIsParsing(false);
  }, []);

  return { file, isParsing, error, select, remove, reset };
}
