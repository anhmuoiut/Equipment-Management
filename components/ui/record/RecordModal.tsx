'use client';

/**
 * RecordModal — modal của MỘT bản ghi (docs/DETAIL_MODEL.md mục 3): một màn hình hiện tại
 * (chi tiết · sửa · thêm mới · thao tác · xóa), ngăn xếp quay lại bằng breadcrumb `← SN-001 › Sửa`,
 * footer chung, ‹ › và phím ← →, và "Hủy bỏ thay đổi?" ngay trong modal khi có thay đổi chưa lưu.
 *
 * Module chỉ khai báo nhóm trường, tab, thao tác; khung lo phần còn lại. Cỡ modal là prop, đặt lúc mở
 * và không đổi; thêm mới luôn cỡ M (xong thì nơi gọi mở lại modal L của bản ghi vừa tạo).
 */
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, ChevronLeft, ChevronRight, Pencil, Trash2 } from 'lucide-react';
import { ApiError, errorMessage } from '@/lib/client/api';
import { usePhone } from '@/lib/client/usePhone';
import { Button, ErrorState, Modal, ModalFooter, ModalSuspend, Notice, Skeleton, toast, type ModalSize } from '@/components/ui';
import { ActionMenu, type MoreItem } from '@/components/ui/ActionMenu';
import { DetailHistory } from '@/components/ui/detail/DetailHistory';
import { ActionScreen, DiscardScreen } from './ActionScreen';
import { RecordContext, useLeaveGuard, useRecordBusy, type LeaveGuard, type RecordContextValue } from './context';
import {
  DetailSection, FieldEditor, FieldView, SystemInfoSection, isEmpty, same,
  type Draft, type FieldDef, type SectionDef,
} from './fields';
import type { Audit } from '@/lib/types';

/** Thứ module truyền vào màn hình thao tác. */
export type ActionCtx<R> = {
  record: R;
  /** Quay lại chi tiết, không làm gì. */
  cancel: () => void;
  /** Xong: toast + quay lại chi tiết (+ cập nhật dòng nếu có `updated`). */
  done: (updated?: R, message?: string) => void;
  /** Bản ghi không còn nữa (xóa): toast + đóng modal. */
  removed: (message?: string) => void;
  /** Thao tác đổi cả các dòng khác (Swap, Move, xóa cả cây…): tải lại danh sách và bản ghi. */
  reload: () => void;
};

export type ActionDef<R> = {
  key: string;
  label: string;
  icon?: ReactNode;
  /** Nút ở footer bên phải (sau [Sửa]; nút ngoài cùng là nút chính). Mặc định nằm trong [Thao tác ▾]. */
  primary?: boolean;
  /** Không hiện ở footer / menu; chỉ mở được từ chỗ khác trong chi tiết (openAction), ví dụ sửa một lần hiệu chuẩn. */
  hidden?: boolean;
  visible?: (record: R) => boolean;
  /** Màn hình thao tác thay thân modal. */
  screen?: (ctx: ActionCtx<R>) => ReactNode;
  /** Thao tác chạy ngay (ví dụ Ẩn / Hiện lại). */
  run?: (record: R) => Promise<R | void>;
  /** Thao tác mở chỗ khác (ví dụ form Thêm thiết bị con). */
  onClick?: (record: R) => void;
  /** Màu đỏ, nằm cuối danh sách Thao tác. */
  danger?: boolean;
  runMessage?: string;
};

export type Heading = { title: string; tags?: ReactNode; subtitle?: ReactNode; meta?: ReactNode };

export type TrailItem = { label: string; onClick: () => void };

export type RecordModalProps<R extends { id: string } & Audit> = {
  /** Cỡ khi xem chi tiết (thêm mới luôn là M). */
  size: ModalSize;
  record: R | null;
  creating?: boolean;
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  heading: (record: R) => Heading;
  /** Tiêu đề form thêm mới. */
  createTitle?: string;
  sections: SectionDef<R>[];
  extraTabs?: { key: string; label: string; render: (record: R) => ReactNode }[];
  /** Tab mở sẵn khi mở một bản ghi (Overview mở tab Cây thiết bị); không có trong `extraTabs` thì tab Thông tin. */
  initialTab?: string;
  historyUrl?: (record: R) => string;
  historyFilter?: { label: string; param: string };
  /** Nhãn trường cho tab Lịch sử (ngoài các trường đã khai báo). */
  historyLabels?: Record<string, string>;
  canEdit: boolean;
  defaults?: Draft;
  validate?: (draft: Draft, record: R | null) => Record<string, string>;
  /** `extra` (nếu có) chuyển sang `savedScreen` thay vì xong ngay — ví dụ mật khẩu tạm của tài khoản vừa tạo. */
  onSave: (payload: Draft, record: R | null) => Promise<{ row: R; message?: string; extra?: unknown }>;
  /** Kiểm tra trước khi lưu: trả nội dung cảnh báo (ví dụ serial đã có ở bản ghi khác) thì form hiện cảnh báo và nút thành "Vẫn lưu"; bấm lần nữa mới lưu. */
  beforeSave?: (payload: Draft, record: R | null) => Promise<ReactNode | null>;
  /** Màn hình hiện sau khi Thêm mới thành công khi `onSave` trả `extra`; `done` = xong, mở chi tiết bản ghi vừa tạo. */
  savedScreen?: (info: { row: R; extra: unknown; done: () => void }) => ReactNode;
  actions?: ActionDef<R>[];
  canDelete?: boolean;
  /** Nhãn mục xóa trong [Thao tác ▾] (mặc định "Xóa"). */
  deleteLabel?: string;
  onDelete?: (record: R) => Promise<void>;
  deleteWarning?: (record: R) => string;
  /** ‹ › theo thứ tự masterlist. */
  nav?: { onPrev?: () => void; onNext?: () => void };
  /** Đường mở bản ghi liên quan: `← SN-001 › SN-002` (cũ nhất trước). */
  trail?: TrailItem[];
  onClose: () => void;
  /** `open = false` (thêm mới): chỉ cập nhật danh sách, chưa chuyển sang chi tiết (còn màn hình `savedScreen`). */
  onSaved: (record: R, created: boolean, open?: boolean) => void;
  onDeleted?: (record: R) => void;
  /** Tải lại danh sách và bản ghi. */
  reload?: () => void;
};

type View = { kind: 'detail' } | { kind: 'edit' } | { kind: 'create' } | { kind: 'action'; key: string } | { kind: 'delete' };
type Pending = { go: () => void; guard: LeaveGuard };

export function RecordModal<R extends { id: string } & Audit>(props: RecordModalProps<R>) {
  const {
    size, record, creating, loading, error, onRetry, heading, createTitle, sections, extraTabs, initialTab, historyUrl, historyFilter,
    historyLabels, canEdit, defaults, validate, beforeSave, onSave, savedScreen, actions = [], canDelete, deleteLabel, onDelete, deleteWarning,
    nav, trail = [], onClose, onSaved, onDeleted, reload,
  } = props;
  const { t } = useTranslation();
  const phone = usePhone();
  const [view, setView] = useState<View>(creating ? { kind: 'create' } : { kind: 'detail' });
  const startTab = initialTab && extraTabs?.some((x) => x.key === initialTab) ? initialTab : 'info';
  const [tab, setTab] = useState(startTab);
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);
  /** Thao tác chạy ngay (ActionDef.run) đang gửi — khóa nút Thao tác và modal. */
  const [running, setRunning] = useState(false);
  const [saved, setSaved] = useState<{ row: R; message?: string; extra: unknown } | null>(null);
  const guardRef = useRef<LeaveGuard | null>(null);
  const headRef = useRef<HTMLDivElement>(null);
  const leaveRef = useRef<(go: () => void) => void>(() => {});
  const openActionRef = useRef<(key: string) => void>(() => {});

  const context = useMemo<RecordContextValue>(() => ({
    setGuard: (guard) => { guardRef.current = guard; },
    setBusy,
    requestLeave: (go) => leaveRef.current(go),
    openAction: (key) => openActionRef.current(key),
  }), []);

  // Tải lại ngầm (record còn, loading bật) không được nháy về khung xương: chỉ khi chưa có bản ghi mới chờ / báo lỗi.
  const loaded = !!record;
  const head = record && view.kind !== 'create' ? heading(record) : null;
  const viewKey = view.kind === 'action' ? `action:${view.key}` : view.kind;

  // Đổi bản ghi (‹ ›, mở bản ghi liên quan) / mở thêm mới → về màn hình ban đầu.
  useEffect(() => {
    setTab(startTab);
    setPending(null);
    setView(creating ? { kind: 'create' } : { kind: 'detail' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [record?.id, creating]);

  // Chuyển màn hình → focus về tiêu đề màn hình mới; thân cuộn lại từ đầu.
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      headRef.current?.querySelector<HTMLElement>('h2')?.focus();
      headRef.current?.closest('.modal-dialog')?.querySelector('.modal-body')?.scrollTo?.({ top: 0 });
    });
    return () => cancelAnimationFrame(frame);
  }, [viewKey, record?.id]);

  /** Rời màn hình hiện tại: có thay đổi chưa lưu thì hỏi trước (màn hình "Hủy bỏ thay đổi?"). */
  function leave(go: () => void) {
    const guard = guardRef.current;
    if (guard) setPending({ go, guard });
    else go();
  }
  leaveRef.current = leave;
  const backToDetail = () => setView({ kind: 'detail' });

  // ← / → : bản ghi trước / sau — chỉ ở màn hình chi tiết, ngoài ô nhập.
  useEffect(() => {
    if (view.kind !== 'detail' || pending) return;
    function onKey(e: KeyboardEvent) {
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      const target = e.target instanceof Element ? e.target : null;
      if (target?.closest('input, textarea, select, [contenteditable="true"], [role="listbox"], [role="menu"], .tree')) return;
      if (e.key === 'ArrowLeft' && nav?.onPrev && !trail.length) { e.preventDefault(); nav.onPrev(); }
      if (e.key === 'ArrowRight' && nav?.onNext && !trail.length) { e.preventDefault(); nav.onNext(); }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [view.kind, pending, nav, trail.length]);

  const visibleActions = record ? actions.filter((a) => !a.visible || a.visible(record)) : [];

  async function runAction(action: ActionDef<R>) {
    if (!record || !action.run || running) return;
    setRunning(true);
    try {
      const updated = await action.run(record);
      toast.success(action.runMessage ?? t('dp.saved'));
      if (updated) onSaved(updated, false);
    } catch (e) {
      toast.error(errorMessage(e, t));
    } finally {
      setRunning(false);
    }
  }

  function trigger(action: ActionDef<R>) {
    if (action.screen) setView({ kind: 'action', key: action.key });
    else if (action.onClick && record) action.onClick(record);
    else void runAction(action);
  }
  openActionRef.current = (key) => {
    const action = canEdit ? visibleActions.find((a) => a.key === key) : undefined;
    if (action) trigger(action);
  };

  const fieldLabel = (key: string) => {
    const fields = sections.flatMap((s) => s.fields ?? []);
    return historyLabels?.[key] ?? fields.find((f) => f.key === key || f.key === `${key}_id`)?.label ?? t(`fields.${key}`, { defaultValue: key });
  };

  // ---------------------------------------------------------------- Header
  const skeletonTitle = <Skeleton className="h-5" style={{ width: 160 }} />;
  const crumbs = trail.map((c, i) => (
    <span key={i} className="rm-crumbwrap">
      <button type="button" className="rm-crumb" onClick={c.onClick}>{c.label}</button>
      <ChevronRight size={14} aria-hidden="true" />
    </span>
  ));
  const backButton = (onClick: () => void) => (
    <button type="button" className="dp-icon-btn rm-back" onClick={onClick} aria-label={t('dp.back')} title={t('dp.back')}>
      <ArrowLeft size={18} aria-hidden="true" />
    </button>
  );
  const viewLabel = view.kind === 'edit' ? t('common.edit')
    : view.kind === 'delete' ? (deleteLabel ?? t('common.delete'))
      : view.kind === 'action' ? (visibleActions.find((a) => a.key === view.key)?.label ?? '') : '';

  let header: ReactNode;
  if (!head) {
    header = (
      <div className="rm-head" ref={headRef}>
        <div className="rm-titles"><div className="rm-line1"><h2 tabIndex={-1}>{creating ? createTitle : skeletonTitle}</h2></div></div>
      </div>
    );
  } else if (view.kind === 'detail') {
    const showNav = !trail.length && !!nav && !!(nav.onPrev || nav.onNext);
    header = (
      <div className="rm-head" ref={headRef}>
        {trail.length > 0 && backButton(trail[trail.length - 1]!.onClick)}
        {showNav && nav && (
          <div className="rm-nav">
            <button type="button" className="dp-icon-btn" onClick={nav.onPrev} disabled={!nav.onPrev} aria-label={t('dp.prev')} title={t('dp.prev')}>
              <ChevronLeft size={18} aria-hidden="true" />
            </button>
            <button type="button" className="dp-icon-btn" onClick={nav.onNext} disabled={!nav.onNext} aria-label={t('dp.next')} title={t('dp.next')}>
              <ChevronRight size={18} aria-hidden="true" />
            </button>
          </div>
        )}
        <div className="rm-titles">
          <div className="rm-line1">
            {crumbs}
            <h2 tabIndex={-1}>{head.title}</h2>
            {head.tags && <div className="dp-tags">{head.tags}</div>}
          </div>
          {(head.subtitle || head.meta) && (
            <div className="rm-sub">
              {head.subtitle && <div className="rm-subtitle">{head.subtitle}</div>}
              {head.meta && <div className="dp-meta">{head.meta}</div>}
            </div>
          )}
        </div>
      </div>
    );
  } else {
    header = (
      <div className="rm-head" ref={headRef}>
        {backButton(() => leave(backToDetail))}
        <div className="rm-titles">
          <div className="rm-line1">
            {crumbs}
            <button type="button" className="rm-crumb" onClick={() => leave(backToDetail)}>{head.title}</button>
            <ChevronRight size={14} aria-hidden="true" className="rm-sep" />
            <h2 tabIndex={-1}>{viewLabel}</h2>
          </div>
        </div>
      </div>
    );
  }

  // ------------------------------------------------------------------ Tab
  const tabs = view.kind === 'detail' && loaded ? [
    { key: 'info', label: t('dp.tabInfo') },
    ...(extraTabs ?? []).map((x) => ({ key: x.key, label: x.label })),
    ...(historyUrl ? [{ key: 'history', label: t('dp.tabHistory') }] : []),
  ] : [];
  const tabsRow = tabs.length > 1 ? (
    <div className="modal-tabs" role="tablist">
      {tabs.map((x) => (
        <button key={x.key} type="button" role="tab" aria-selected={tab === x.key} className="modal-tab" onClick={() => setTab(x.key)}>{x.label}</button>
      ))}
    </div>
  ) : undefined;

  // ------------------------------------------------------------------ Thân
  let body: ReactNode;
  if (creating && saved && savedScreen) {
    body = savedScreen({ row: saved.row, extra: saved.extra, done: () => { toast.success(saved.message ?? t('dp.saved')); onSaved(saved.row, true); } });
  } else if (creating && view.kind === 'create') {
    body = (
      <FormScreen<R> record={null} creating sections={sections} defaults={defaults} validate={validate} beforeSave={beforeSave} onSave={onSave}
        onCancel={() => leave(onClose)}
        onDone={(row, message, extra) => {
          if (savedScreen && extra !== undefined) { onSaved(row, true, false); setSaved({ row, message, extra }); return; }
          toast.success(message ?? t('dp.saved'));
          onSaved(row, true);
        }} />
    );
  } else if (!record) {
    body = error ? <ErrorState message={error} onRetry={onRetry} /> : (
      <div className="dp-skeleton">
        {[0, 1, 2].map((i) => (
          <div key={i} className="dp-section">
            <Skeleton className="h-3" style={{ width: 90 }} />
            <div className="dp-grid">{[0, 1, 2, 3].map((j) => <Skeleton key={j} className="h-8" />)}</div>
          </div>
        ))}
      </div>
    );
  } else if (view.kind === 'edit') {
    body = (
      <FormScreen<R> record={record} sections={sections} validate={validate} beforeSave={beforeSave} onSave={onSave} onCancel={() => leave(backToDetail)}
        onDone={(row, message) => { toast.success(message ?? t('dp.saved')); setView({ kind: 'detail' }); onSaved(row, false); }} />
    );
  } else if (view.kind === 'delete' && onDelete) {
    body = (
      <ActionScreen danger confirmLabel={deleteLabel ?? t('common.delete')} onCancel={backToDetail}
        description={deleteWarning?.(record) ?? t('dp.confirmDelete', { name: heading(record).title })}
        onConfirm={async () => { await onDelete(record); toast.success(t('dp.deleted')); onDeleted?.(record); }} />
    );
  } else if (view.kind === 'action') {
    const action = visibleActions.find((a) => a.key === view.key);
    body = action?.screen ? action.screen({
      record,
      cancel: backToDetail,
      done: (updated, message) => {
        toast.success(message ?? t('dp.saved'));
        setView({ kind: 'detail' });
        if (updated) onSaved(updated, false);
      },
      removed: (message) => { toast.success(message ?? t('dp.deleted')); onDeleted?.(record); },
      reload: () => reload?.(),
    }) : null;
  } else if (tab !== 'info') {
    const extra = extraTabs?.find((x) => x.key === tab);
    body = extra ? extra.render(record)
      : historyUrl ? <DetailHistory url={historyUrl(record)} fieldLabel={fieldLabel} filter={historyFilter} /> : null;
  } else {
    body = (
      <div className="rm-info" data-mode="view">
        {sections.map((section) => {
          if (section.render) {
            const content = section.render(record);
            return content ? <DetailSection key={section.key} title={section.title}>{content}</DetailSection> : null;
          }
          const fields = (section.fields ?? []).filter((f) => !f.createOnly && !f.when);
          if (fields.length === 0) return null;
          return (
            <DetailSection key={section.key} title={section.title}>
              {fields.map((f) => <FieldView key={f.key} field={f} record={record} draft={{}} editing={false} />)}
              {section.viewExtra?.(record)}
            </DetailSection>
          );
        })}
        <SystemInfoSection record={record} />
      </div>
    );
  }

  // ---------------------------------------------------------- Footer chi tiết
  let detailFooter: ReactNode = null;
  if (view.kind === 'detail' && loaded && record) {
    const toMore = (a: ActionDef<R>): MoreItem => ({ key: a.key, label: a.label, icon: a.icon, danger: a.danger, onClick: () => trigger(a) });
    const buttons = canEdit ? [
      { key: 'edit', label: t('common.edit'), icon: <Pencil size={14} aria-hidden="true" />, onClick: () => setView({ kind: 'edit' }) },
      ...visibleActions.filter((a) => a.primary && !a.hidden).map((a) => ({ key: a.key, label: a.label, icon: a.icon, onClick: () => trigger(a) })),
    ] : [];
    // Điện thoại: chỗ chỉ đủ cho nút chính; [Sửa] và các nút còn lại vào menu Thao tác.
    const demoted = phone && buttons.length > 1 ? buttons.slice(0, -1) : [];
    const shown = phone && buttons.length > 1 ? buttons.slice(-1) : buttons;
    const menu: MoreItem[] = canEdit ? [
      ...demoted.map((b) => ({ key: b.key, label: b.label, icon: b.icon, onClick: b.onClick })),
      ...visibleActions.filter((a) => !a.primary && !a.hidden).map(toMore),
      ...(canDelete && onDelete ? [{ key: 'delete', label: deleteLabel ?? t('common.delete'), icon: <Trash2 size={14} aria-hidden="true" />, danger: true, onClick: () => setView({ kind: 'delete' }) }] : []),
    ] : [];
    detailFooter = (
      <ModalFooter>
        <div className="mf-left">{menu.length > 0 && <ActionMenu items={menu} busy={running} />}</div>
        <div className="mf-right">
          {shown.length === 0
            ? <Button onClick={onClose}>{t('common.close')}</Button>
            : shown.map((b, i) => (
              <Button key={b.key} variant={i === shown.length - 1 ? 'primary' : 'quiet'} disabled={running} onClick={b.onClick}>{b.icon}{b.label}</Button>
            ))}
        </div>
      </ModalFooter>
    );
  } else if (!creating && !record) {
    detailFooter = <ModalFooter><Button onClick={onClose}>{t('common.close')}</Button></ModalFooter>;
  }

  const guardText = pending?.guard === true || !pending ? null : pending.guard;
  const modalSize: ModalSize = creating ? 'm' : size;
  return (
    <RecordContext.Provider value={context}>
      <Modal
        size={modalSize} title={head?.title ?? createTitle ?? t('common.loadingEllipsis')} header={header} tabs={tabsRow}
        busy={busy || running} onClose={() => (pending ? setPending(null) : leave(onClose))}
      >
        <ModalSuspend suspended={!!pending}>
          <div hidden={!!pending} className="rm-screen">{body}{detailFooter}</div>
        </ModalSuspend>
        {pending && (
          <DiscardScreen
            title={guardText?.title ?? t('dp.discardTitle')} message={guardText?.message ?? t('dp.unsaved')}
            stayLabel={guardText?.stay ?? t('dp.stay')} leaveLabel={guardText?.leave ?? t('dp.discard')}
            onStay={() => setPending(null)} onLeave={() => { const go = pending.go; setPending(null); go(); }}
          />
        )}
      </Modal>
    </RecordContext.Provider>
  );
}

/**
 * Form Sửa / Thêm mới: cùng nhóm và thứ tự trường như màn hình chi tiết, nhưng là ô nhập. Bắt buộc có `*`,
 * lỗi hiện ngay dưới ô; có thay đổi chưa lưu thì báo cho khung (đóng / ← sẽ hỏi trước).
 */
function FormScreen<R extends { id: string } & Audit>({ record, creating, sections, defaults, validate, beforeSave, onSave, onCancel, onDone }: {
  record: R | null;
  creating?: boolean;
  sections: SectionDef<R>[];
  defaults?: Draft;
  validate?: (draft: Draft, record: R | null) => Record<string, string>;
  beforeSave?: (payload: Draft, record: R | null) => Promise<ReactNode | null>;
  onSave: (payload: Draft, record: R | null) => Promise<{ row: R; message?: string; extra?: unknown }>;
  onCancel: () => void;
  onDone: (row: R, message?: string, extra?: unknown) => void;
}) {
  const { t } = useTranslation();
  const formId = useId();
  const fields = useMemo(() => sections.flatMap((s) => s.fields ?? []), [sections]);
  const [initial] = useState<Draft>(() => {
    if (!record) return { ...(defaults ?? {}) };
    const start: Draft = {};
    fields.forEach((f) => { if (!f.createOnly && !f.readOnly) start[f.key] = (record as Record<string, unknown>)[f.key] ?? null; });
    return start;
  });
  const [draft, setDraft] = useState<Draft>(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  /** Cảnh báo của beforeSave: đã hiện thì lần bấm Lưu kế tiếp lưu thật (đổi ô nào thì kiểm tra lại). */
  const [warning, setWarning] = useState<ReactNode | null>(null);

  const inUse = (f: FieldDef<R>) => !f.when || f.when(draft, record);
  const editableFields = fields.filter((f) => !f.readOnly && !(!creating && f.createOnly) && !(creating && f.hideInCreate) && inUse(f));
  const dirty = editableFields.some((f) => !same(draft[f.key], initial[f.key]));
  useLeaveGuard(dirty && !saving ? true : null);
  useRecordBusy(saving);

  const requiredOf = (f: FieldDef<R>) => (typeof f.required === 'function' ? f.required(draft) : !!f.required);

  async function save() {
    if (saving) return;
    const nextErrors: Record<string, string> = {};
    editableFields.forEach((f) => {
      if (f.lock?.(record, draft)) return;
      if (requiredOf(f) && isEmpty(draft[f.key])) nextErrors[f.key] = t('dp.required');
    });
    Object.assign(nextErrors, validate?.(draft, record) ?? {});
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) { setFormError(t('dp.fixErrors')); return; }

    const payload: Draft = {};
    editableFields.forEach((f) => {
      if (f.lock?.(record, draft)) return;
      const value = draft[f.key];
      const normalized = typeof value === 'string' && f.kind !== 'password' ? (value.trim() === '' ? null : value.trim()) : value;
      if (creating ? !isEmpty(normalized) || f.kind === 'boolean' || f.kind === 'number' : !same(normalized, initial[f.key])) {
        payload[f.key] = normalized === undefined ? null : normalized;
      }
    });

    setSaving(true);
    setFormError(null);
    if (beforeSave && !warning) {
      try {
        const found = await beforeSave(payload, creating ? null : record);
        if (found) { setWarning(found); setSaving(false); return; }
      } catch { /* không kiểm tra được: cứ lưu, database vẫn là nơi quyết định */ }
    }
    try {
      const { row, message, extra } = await onSave(payload, creating ? null : record);
      onDone(row, message, extra);
    } catch (e) {
      if (e instanceof ApiError) {
        const mapped: Record<string, string> = {};
        Object.entries(e.fieldErrors).forEach(([k, v]) => { mapped[k] = t(`dp.fieldError.${v}`, { defaultValue: v }); });
        setErrors(mapped);
      }
      setFormError(errorMessage(e, t));
      setSaving(false);
    }
  }

  return (
    <form id={formId} className="ms rm-form" noValidate onSubmit={(e) => { e.preventDefault(); void save(); }}>
      {formError && <Notice tone="alert">{formError}</Notice>}
      {warning && <Notice tone="warn">{warning}</Notice>}
      {sections.map((section) => {
        if (creating && section.hideInCreate) return null;
        if (section.render) return null;
        const sectionFields = (section.fields ?? []).filter((f) =>
          !(creating && f.hideInCreate) && !(!creating && f.createOnly) && inUse(f));
        if (sectionFields.length === 0) return null;
        return (
          <DetailSection key={section.key} title={section.title}>
            {sectionFields.map((f) => !f.readOnly
              ? <FieldEditor key={f.key} field={f} record={record} draft={draft} required={requiredOf(f)} error={errors[f.key]}
                  onChange={(v) => {
                    setWarning(null);
                    setDraft((d) => ({ ...d, [f.key]: v, ...f.afterChange?.(v, d, record) }));
                    setErrors((er) => { const n = { ...er }; delete n[f.key]; return n; });
                  }} />
              : <FieldView key={f.key} field={f} record={record} draft={draft} editing />)}
          </DetailSection>
        );
      })}
      <ModalFooter>
        {dirty && <span className="mf-note">{t('dp.unsavedShort')}</span>}
        {dirty && !creating && <Button onClick={() => { setDraft(initial); setErrors({}); setFormError(null); }} disabled={saving}>{t('dp.undo')}</Button>}
        <Button onClick={onCancel} disabled={saving}>{t('common.cancel')}</Button>
        <Button type="submit" form={formId} variant="primary" loading={saving} disabled={!creating && !dirty}>{warning ? t('dp.saveAnyway') : t('common.save')}</Button>
      </ModalFooter>
    </form>
  );
}
