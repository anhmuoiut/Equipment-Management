'use client';

/**
 * Import Excel (docs/UI.md) — modal cỡ L (`?tool=import`);
 * dùng chung cho Equipment, Calibration và Golden. 1. Tải file mẫu (danh sách chọn
 * lấy từ Configuration ngay lúc tải). 2. Chọn file → server kiểm tra, chưa
 * ghi gì. 3. Hết lỗi → Import: thêm tất cả trong một giao dịch.
 */
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Download, FolderOpen } from 'lucide-react';
import { api, ApiError, errorMessage } from '@/lib/client/api';
import { Button, LoadingOverlay, Modal, Notice, toast } from '@/components/ui';
import { IMPORT_MAX_ROWS, type ImportIssue, type ImportReport, type ImportRowReport } from '@/lib/equipmentImport';

export type ImportModalProps = {
  /** Route của module, ví dụ /api/golden/import (kèm /template cho file mẫu). */
  endpoint: string;
  /** Tiêu đề cột trong file — để báo lỗi theo tên cột. */
  columns: readonly { key: string; header: string }[];
  title: string;
  /** Mô tả bước 1 (file mẫu có những danh sách chọn nào). */
  templateDesc: string;
  /** Tiêu đề cột nhận dạng dòng trong bảng lỗi (mặc định "Serial"; Configuration: "Name"). */
  rowLabel?: string;
  /** Có nút tải về file báo lỗi (dòng lỗi tô đỏ, dòng trùng tô vàng, cột Problem) — server hỗ trợ `report=1`. */
  checkFile?: boolean;
  /**
   * Dòng trùng với dữ liệu có sẵn (Configuration: trùng tên) — báo cho người dùng và hỏi giữ bản gốc hay ghi đè. `skip`: giá trị của lựa chọn
   * bỏ qua các dòng đó (số dòng trên nút Import trừ đi chúng); chỉ một lựa chọn (hoặc không có) thì không hỏi. Gửi lên server là `on_duplicate`.
   */
  duplicates?: {
    skip: string;
    choices: { value: string; label: string }[];
    statLabel: string;
    rowText: string;
    notice: (count: number) => string;
  };
  importLabel: (count: number) => string;
  doneLabel: (count: number, updated: number) => string;
  onClose: () => void;
  onImported: () => void;
};

function formatSize(bytes: number): string {
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function ImportModal({ endpoint, columns, title, templateDesc, rowLabel, checkFile, duplicates, importLabel, doneLabel, onClose, onImported }: ImportModalProps) {
  const { t, i18n } = useTranslation();
  const language = i18n.language === 'vi' ? 'vi' : 'en';
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [report, setReport] = useState<ImportReport | null>(null);
  const [busy, setBusy] = useState<'download' | 'check' | 'import' | 'checkfile' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState(duplicates?.skip ?? '');
  const headers = new Map(columns.map((c) => [c.key, c.header]));

  /** Lỗi khi gửi file (kiểm tra / import). */
  function describe(e: unknown): string {
    const code = e instanceof ApiError ? e.fieldErrors.file : undefined;
    if (e instanceof ApiError && e.code === 'VALIDATION_ERROR' && code) {
      const d = e.details;
      return t(`imp.file.${code}`, {
        max: d.max ?? IMPORT_MAX_ROWS, count: d.count ?? '', columns: Array.isArray(d.columns) ? d.columns.join(', ') : '',
      });
    }
    // Gửi file thất bại: mất mạng, hoặc file đã bị sửa / xóa sau khi chọn (trình duyệt báo cùng một lỗi).
    if (e instanceof ApiError && e.code === 'NETWORK_ERROR') return t('imp.file.sendFailed');
    return errorMessage(e, t);
  }

  async function send(selected: File, commit: boolean): Promise<ImportReport> {
    const form = new FormData();
    form.append('file', selected);
    if (commit) form.append('commit', '1');
    if (duplicates) form.append('on_duplicate', mode);
    return (await api.upload<ImportReport>(endpoint, form)).data;
  }

  async function check(selected: File) {
    setFile(selected);
    setReport(null);
    setError(null);
    setBusy('check');
    try {
      setReport(await send(selected, false));
    } catch (e) {
      setError(describe(e));
    } finally {
      setBusy(null);
    }
  }

  async function commit() {
    if (!file) return;
    setError(null);
    setBusy('import');
    try {
      const result = await send(file, true);
      setReport(result);
      if (result.committed) {
        onImported();
        toast.success(doneLabel(result.created, result.updated ?? 0));
      }
    } catch (e) {
      setError(describe(e));
    } finally {
      setBusy(null);
    }
  }

  async function downloadCheckFile() {
    if (!file) return;
    setError(null);
    setBusy('checkfile');
    try {
      const form = new FormData();
      form.append('file', file);
      form.append('report', '1');
      form.append('lang', language);
      await api.uploadForFile(endpoint, form);
    } catch (e) {
      setError(describe(e));
    } finally {
      setBusy(null);
    }
  }

  async function downloadTemplate() {
    setError(null);
    setBusy('download');
    try {
      await api.download(`${endpoint}/template?lang=${language}`);
    } catch (e) {
      setError(errorMessage(e, t));
    } finally {
      setBusy(null);
    }
  }

  const issueText = (issue: ImportIssue) => t(`imp.issue.${issue.code}`, {
    column: headers.get(issue.column) ?? issue.column, value: issue.value ?? '', max: issue.max ?? '', count: issue.count ?? '',
  });
  const duplicateText = (row: ImportRowReport) => (row.duplicate_of === 'existing'
    ? duplicates?.rowText ?? t('imp.duplicateExisting') : t('imp.duplicateFile', { row: row.duplicate_of }));

  const committed = !!report?.committed;
  // Dòng trùng bị bỏ qua (giữ bản gốc) thì không được tính vào số dòng sẽ import.
  const importCount = report ? report.valid - (duplicates && mode === duplicates.skip ? report.duplicates : 0) : 0;
  const canImport = !!report && !committed && report.invalid === 0 && importCount > 0;

  return (
    <Modal
      // Đang import (một giao dịch, có thể lâu): không đóng modal giữa chừng.
      size="l" title={title} onClose={onClose} busy={busy === 'import'}
      footer={(
        <>
          <Button onClick={onClose} disabled={busy === 'import'}>{committed ? t('common.close') : t('common.cancel')}</Button>
          {!committed && (
            <Button variant="primary" loading={busy === 'import'} disabled={!canImport || (busy !== null && busy !== 'import')}
              onClick={() => void commit()}>
              {importLabel(importCount)}
            </Button>
          )}
        </>
      )}
    >
      <div className="ms imp-body">
        {busy === 'import' && <LoadingOverlay label={t('imp.importing')} />}
        <section className="dp-section">
          <h3 className="dp-section-title">{t('imp.step1')}</h3>
          <p className="imp-desc">{templateDesc}</p>
          <div>
            <Button size="sm" loading={busy === 'download'} disabled={busy !== null && busy !== 'download'} onClick={() => void downloadTemplate()}>
              <Download size={14} aria-hidden="true" />{t('imp.download')}
            </Button>
          </div>
        </section>

        <section className="dp-section">
          <h3 className="dp-section-title">{t('imp.step2')}</h3>
          <p className="imp-desc">{t('imp.step2Desc', { max: IMPORT_MAX_ROWS })}</p>
          <div className="imp-file">
            <input
              ref={inputRef} type="file" hidden
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              onChange={(e) => {
                const selected = e.target.files?.[0];
                e.target.value = ''; // chọn lại đúng file đó (đã sửa) vẫn kiểm tra lại
                if (selected) void check(selected);
              }}
            />
            <Button size="sm" loading={busy === 'check'} disabled={busy !== null && busy !== 'check'} onClick={() => inputRef.current?.click()}>
              <FolderOpen size={14} aria-hidden="true" />{file ? t('imp.change') : t('imp.choose')}
            </Button>
            {file && <span className="imp-file-name" title={file.name}>{file.name} · {formatSize(file.size)}</span>}
          </div>
          {busy === 'check' && <p className="imp-desc" role="status">{t('imp.checking')}</p>}
        </section>

        {error && <Notice tone="alert">{error}</Notice>}

        {report && (
          <section className="dp-section">
            <h3 className="dp-section-title">{t('imp.step3')}</h3>
            <dl className="imp-stats">
              <div><dt>{t('imp.total')}</dt><dd>{report.total}</dd></div>
              <div data-tone="ok"><dt>{t('imp.valid')}</dt><dd>{report.valid}</dd></div>
              <div data-tone={report.invalid ? 'alert' : undefined}><dt>{t('imp.invalid')}</dt><dd>{report.invalid}</dd></div>
              <div data-tone={report.duplicates ? 'warn' : undefined}><dt>{duplicates?.statLabel ?? t('imp.duplicates')}</dt><dd>{report.duplicates}</dd></div>
            </dl>
            {committed
              ? <Notice tone="info">{doneLabel(report.created, report.updated ?? 0)}</Notice>
              : report.invalid
                ? <Notice tone="alert">{t('imp.hasErrors', { count: report.invalid })}</Notice>
                : <Notice tone="info">{t('imp.allGood', { count: report.total })}</Notice>}
            {duplicates && !committed && report.duplicates > 0 && (
              <>
                <Notice tone="warn">{duplicates.notice(report.duplicates)}</Notice>
                {duplicates.choices.length > 1 && (
                  <div className="dp-radios" role="radiogroup">
                    {duplicates.choices.map((c) => (
                      <label key={c.value}>
                        <input type="radio" name="imp-duplicate-mode" checked={mode === c.value} onChange={() => setMode(c.value)} />
                        {c.label}
                      </label>
                    ))}
                  </div>
                )}
              </>
            )}
            {report.ignored_columns.length > 0 && (
              <Notice tone="warn">{t('imp.ignoredColumns', { columns: report.ignored_columns.join(', ') })}</Notice>
            )}
            {checkFile && !committed && report.rows.length > 0 && (
              <div>
                <Button size="sm" loading={busy === 'checkfile'} disabled={busy !== null && busy !== 'checkfile'} onClick={() => void downloadCheckFile()}>
                  <Download size={14} aria-hidden="true" />{t('imp.checkFile')}
                </Button>
              </div>
            )}
            {report.rows.length > 0 && (
              <div className="imp-table-wrap">
                <table className="imp-table">
                  <thead>
                    <tr><th>{t('imp.colRow')}</th><th>{rowLabel ?? t('imp.colSerial')}</th><th>{t('imp.colProblem')}</th></tr>
                  </thead>
                  <tbody>
                    {/* Dòng lỗi lên trước (nền đỏ), rồi tới dòng chỉ cảnh báo (nền vàng) — cùng thứ tự số dòng trong file. */}
                    {[...report.rows].sort((a, b) => Number(b.issues.length > 0) - Number(a.issues.length > 0) || a.row - b.row).map((r) => (
                      <tr key={r.row} data-tone={r.issues.length > 0 ? 'alert' : 'warn'}>
                        <td className="imp-num">{r.row}</td>
                        <td className="imp-serial">{r.serial_number ?? '—'}</td>
                        <td>
                          <ul>
                            {r.issues.map((issue, i) => <li key={i} data-tone="alert">{issueText(issue)}</li>)}
                            {r.duplicate_of !== null && <li data-tone="warn">{duplicateText(r)}</li>}
                          </ul>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}
      </div>
    </Modal>
  );
}
