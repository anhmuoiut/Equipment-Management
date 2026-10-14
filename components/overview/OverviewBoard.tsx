'use client';

/**
 * Bảng thẻ của Overview (docs/UI.md "Overview board"): Location → cột → thẻ.
 * Một cột = một tài sản gốc (thẻ đậm) + tối đa 2 thẻ khác (3 thẻ kể cả thẻ gốc) nối bằng đường cây + "+N thiết bị". Thẻ không có icon:
 * dòng 1 Type, dòng 2 PN, dòng 3 SN, rồi tag vận hành + hạn hiệu chuẩn; viền trái là trạng thái vận hành.
 * Thuần hiển thị — dữ liệu và URL do OverviewPage giữ.
 */
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronRight, TriangleAlert } from 'lucide-react';
import { CalibrationStatusTag, UsageTag } from '@/components/ui/tags';
import type { CalAlert, OverviewCard, OverviewColumn, OverviewSection } from '@/lib/types';

/** Mở modal của một thẻ; `tab` = tab mở sẵn (Cây thiết bị). */
export type OpenCard = (card: Pick<OverviewCard, 'asset_type' | 'id'>, tab?: string) => void;

type Guide = 'line' | 'blank' | 'mid' | 'last';
type Entry = { key: string; card: OverviewCard | null; guides: Guide[] };

const toneOf = (alert: CalAlert | null) => (alert === null ? undefined : alert === 'due_soon' ? 'warn' : 'alert');

/**
 * Các dòng dưới thẻ gốc, theo thứ tự vẽ, kèm ô đường cây của từng dòng: mỗi cấp một ô — `line` (đường dọc của một thẻ cha
 * còn anh em phía sau), `blank`, và ô cuối `mid` (├) / `last` (└). "+N" là con cuối "ảo" của thẻ gốc, nên thẻ con cuối thật có ├.
 */
export function columnEntries(column: OverviewColumn): Entry[] {
  const root = column.cards[0];
  if (!root) return [];
  const items = column.cards.slice(1).map((card) => ({ id: card.id, parent: card.parent_id, card: card as OverviewCard | null }));
  if (column.more > 0) items.push({ id: 'more', parent: root.id, card: null });
  const byId = new Map(items.map((item) => [item.id, item]));
  return items.map((item, index) => {
    const laterSibling = (parent: string | null) => items.some((x, j) => j > index && x.parent === parent);
    const chain: typeof items = [];
    for (let cur: typeof item | undefined = item; cur; cur = cur.parent ? byId.get(cur.parent) : undefined) chain.unshift(cur);
    const guides = chain.map((node, i): Guide => (i === chain.length - 1 ? (laterSibling(node.parent) ? 'mid' : 'last') : laterSibling(node.parent) ? 'line' : 'blank'));
    return { key: item.id, card: item.card, guides };
  });
}

function useCardTexts() {
  const { t } = useTranslation();
  const typeText = (card: OverviewCard) => {
    if (card.kind === 'golden_board') return t('ov.golden');
    if (card.kind === 'sub_equipment') return card.type_name ? t('ov.subType', { type: card.type_name }) : t('ov.kinds.sub_equipment');
    return card.type_name ?? t(`ov.kinds.${card.kind}`);
  };
  return { t, typeText };
}

const BoardCard = memo(function BoardCard({ card, root, highlight, parentSerial, tab, onOpen }: {
  card: OverviewCard;
  root: boolean;
  highlight: boolean;
  parentSerial: string | null;
  /** Tab mở sẵn khi bấm thẻ này. */
  tab?: string;
  onOpen: OpenCard;
}) {
  const { t, typeText } = useCardTexts();
  const type = typeText(card);
  const pn = card.part_number ?? '—';
  const alertText = card.cal_alert ? t(`cal.status.${card.cal_alert}`) : null;
  const name = [
    `${type} ${card.serial_number}`, `${t('ov.pn')} ${pn}`, t(`values.${card.usage}`),
    alertText && `${t('ov.alert')}: ${alertText}`,
    parentSerial && t('ov.childOf', { serial: parentSerial }), highlight && card.matched && t('ov.matched'),
  ].filter(Boolean).join(', ');
  return (
    <button type="button" className="ob-card" data-root={root || undefined} data-matched={(highlight && card.matched) || undefined}
      data-status-color={card.usage === 'in_use' ? 'green' : 'gray'} aria-label={name} onClick={() => onOpen(card, tab)}>
      <span className="ob-line">
        <span className="ob-type" title={type}>{type}</span>
      </span>
      <span className="ob-line"><span className="ob-label" aria-hidden="true">{t('ov.pn')}</span><span className="ob-val" title={pn}>{pn}</span></span>
      <span className="ob-line"><span className="ob-label" aria-hidden="true">{t('ov.sn')}</span><span className="ob-val" title={card.serial_number}>{card.serial_number}</span></span>
      <span className="ob-statuses">
        <UsageTag usage={card.usage} />
        {card.cal_alert && <CalibrationStatusTag status={card.cal_alert} />}
      </span>
    </button>
  );
});

const BoardColumn = memo(function BoardColumn({ column, highlight, onOpen }: {
  column: OverviewColumn;
  highlight: boolean;
  onOpen: OpenCard;
}) {
  const { t } = useTranslation();
  const root = column.cards[0]!;
  const serials = new Map(column.cards.map((c) => [c.id, c.serial_number]));
  // Thẻ gốc có con (còn "+N" hoặc có thẻ con hiện) và là thiết bị: bấm mở thẳng tab Cây thiết bị.
  const treeTab = root.asset_type === 'equipment' && (column.cards.length > 1 || column.more > 0) ? 'tree' : undefined;
  return (
    <div className="ob-col" role="group" aria-label={root.serial_number}>
      <BoardCard card={root} root highlight={highlight} parentSerial={null} tab={treeTab} onOpen={onOpen} />
      {columnEntries(column).map(({ key, card, guides }) => (
        <div className="ob-row" key={key}>
          {guides.map((kind, i) => <span key={i} className="ob-guide" data-kind={kind === 'blank' ? undefined : kind} aria-hidden="true" />)}
          {card ? (
            <BoardCard card={card} root={false} highlight={highlight} parentSerial={card.parent_id ? serials.get(card.parent_id) ?? null : null}
              onOpen={onOpen} />
          ) : (
            <button type="button" className="ob-more" aria-label={t('ov.moreLabel', { count: column.more, serial: root.serial_number })}
              onClick={() => onOpen(root, treeTab)}>
              {t('ov.more', { count: column.more })}
            </button>
          )}
        </div>
      ))}
    </div>
  );
});

export function BoardSection({ section, open, onToggle, highlight, onOpen }: {
  section: OverviewSection;
  open: boolean;
  onToggle: () => void;
  /** Tô thẻ khớp (khi đang lọc theo Loại hoặc tìm chữ). */
  highlight: boolean;
  onOpen: OpenCard;
}) {
  const { t } = useTranslation();
  const id = `ob-${section.location_id}`;
  const tone = section.alerts > 0 ? toneOf(section.worst) : undefined;
  // Match the existing In use count: root columns, including assets whose children are behind +N.
  const notInUse = section.columns.filter((column) => column.cards[0]?.usage === 'not_in_use').length;
  return (
    <section className="ob-section" aria-labelledby={`${id}-h`}>
      <h2 className="ob-head" id={`${id}-h`}>
        <button type="button" aria-expanded={open} aria-controls={`${id}-grid`} onClick={onToggle}>
          {open ? <ChevronDown size={15} aria-hidden="true" /> : <ChevronRight size={15} aria-hidden="true" />}
          <span className="ob-head-location">
            <span className="ob-head-name">{section.location}</span>
            <span className="ob-head-total">{t('ov.testers', { count: section.testers })}</span>
          </span>
          <span className="ob-head-counts">
            <span className="ob-head-usage" data-status-color="green">
              <span className="ob-head-dot" aria-hidden="true" />{t('ov.inUse', { count: section.in_use })}
            </span>
            <span className="ob-head-usage" data-status-color="gray">
              <span className="ob-head-dot" aria-hidden="true" />{t('ov.notInUse', { count: notInUse })}
            </span>
            <span className="ob-head-alerts" data-tone={tone} title={t('ov.alerts', { count: section.alerts })} aria-label={t('ov.alerts', { count: section.alerts })}>
              <TriangleAlert size={12} aria-hidden="true" />{section.alerts}
            </span>
          </span>
        </button>
      </h2>
      {open && (
        <div className="ob-grid" id={`${id}-grid`}>
          {section.columns.map((column) => <BoardColumn key={column.root_id} column={column} highlight={highlight} onOpen={onOpen} />)}
        </div>
      )}
    </section>
  );
}

/** Khung xương lần tải đầu: hai section, mỗi section vài cột. */
export function BoardSkeleton() {
  return (
    <div className="ob-skeleton" aria-hidden="true">
      {[0, 1].map((s) => (
        <div key={s} className="ob-section">
          <span className="ui-skeleton ob-skel-head" />
          <div className="ob-grid">
            {Array.from({ length: 7 }, (_, i) => <span key={i} className="ui-skeleton ob-skel-col" data-tall={(i + s) % 3 === 0 || undefined} />)}
          </div>
        </div>
      ))}
    </div>
  );
}
