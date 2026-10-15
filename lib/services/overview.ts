import 'server-only';

/**
 * Overview — bảng thẻ theo Location (docs/UI.md). Không có bảng riêng: một lần gọi hàm overview_board
 * của database (docs/DATABASE.md) trả cả bảng; service chỉ gom các dòng thành Location → cột → thẻ và
 * tính số liệu header. Lọc và tìm chạy trong database (thẻ khớp có thể nằm sau "+N"). Mở một thẻ = mở modal của module
 * sở hữu bản ghi, nên service này chỉ đọc.
 */
import { rpc } from './core/db';
import { AppError } from '@/lib/errors';
import type { AssetKind, AssetType, CalAlert, OverviewBoard, OverviewCard, OverviewColumn, OverviewSection, Usage } from '@/lib/types';

export const OVERVIEW_KINDS: AssetKind[] = ['tester', 'base', 'fixture', 'sub_equipment', 'golden_board'];
export const OVERVIEW_USAGES: Usage[] = ['in_use', 'not_in_use'];
const MAX_QUERY = 100;

export type OverviewFilter = { usage?: Usage | null; kind?: AssetKind | null; q?: string | null };

type DbCard = {
  location_id: string; location: string; root_id: string; asset_type: AssetType; id: string; kind: AssetKind;
  type_name: string | null; part_number: string | null; serial_number: string; usage: Usage; cal_alert: CalAlert | null;
  parent_id: string | null; depth: number; descendants: number; alerts: number; matched: boolean; pos: number;
};

const SEVERITY: Record<CalAlert, number> = { failed: 0, overdue: 1, due_soon: 2 };
const worseOf = (a: CalAlert | null, b: CalAlert | null) => (a && b ? (SEVERITY[a] <= SEVERITY[b] ? a : b) : a ?? b);

/** Kiểm tra bộ lọc trước khi hỏi database (database cũng kiểm tra; ở đây báo lỗi theo từng trường). */
export function assertOverviewFilter(raw: { usage?: string | null; kind?: string | null; q?: string | null }): OverviewFilter {
  const fields: Record<string, string> = {};
  const usage = raw.usage || null;
  const kind = raw.kind || null;
  const q = raw.q?.trim() || null;
  if (usage && !OVERVIEW_USAGES.includes(usage as Usage)) fields.usage = 'invalid';
  if (kind && !OVERVIEW_KINDS.includes(kind as AssetKind)) fields.kind = 'invalid';
  if (q && q.length > MAX_QUERY) fields.q = 'too_long';
  if (Object.keys(fields).length) throw new AppError('VALIDATION_ERROR', { fields });
  return { usage: usage as Usage | null, kind: kind as AssetKind | null, q };
}

/** Cả bảng: Location (theo sort_order) → cột (Tester trước) → thẻ (theo thứ tự vẽ). Có bộ lọc thì chỉ các cột có tài sản khớp. */
export async function overviewBoard(filter: OverviewFilter = {}): Promise<OverviewBoard> {
  const rows = await rpc<DbCard[]>('overview_board', {
    p_usage: filter.usage ?? null, p_kind: filter.kind ?? null, p_q: filter.q?.trim() || null,
  }) ?? [];

  // Database trả các dòng đã sắp: Location → cột → thẻ. Chỉ cần gom theo thứ tự xuất hiện.
  const sections = new Map<string, { section: OverviewSection; columns: Map<string, DbCard[]> }>();
  for (const r of rows) {
    let s = sections.get(r.location_id);
    if (!s) {
      s = { section: { location_id: r.location_id, location: r.location, columns: [], testers: 0, in_use: 0, alerts: 0, worst: null }, columns: new Map() };
      sections.set(r.location_id, s);
    }
    const column = s.columns.get(r.root_id);
    if (column) column.push(r); else s.columns.set(r.root_id, [r]);
  }

  return {
    sections: [...sections.values()].map(({ section, columns }) => {
      for (const list of columns.values()) {
        const cards = list.sort((a, b) => a.pos - b.pos);
        const head = cards[0]!;
        const column: OverviewColumn = {
          root_id: head.root_id,
          cards: cards.map((c): OverviewCard => ({
            asset_type: c.asset_type, id: c.id, kind: c.kind, type_name: c.type_name, part_number: c.part_number,
            serial_number: c.serial_number, usage: c.usage, cal_alert: c.cal_alert, parent_id: c.parent_id, depth: c.depth, matched: c.matched,
          })),
          more: Math.max(0, head.descendants - (cards.length - 1)),
          alerts: head.alerts,
        };
        section.columns.push(column);
        if (head.kind === 'tester') section.testers += 1;
        if (head.usage === 'in_use') section.in_use += 1;
        section.alerts += head.alerts;
        section.worst = worseOf(section.worst, head.cal_alert);
      }
      return section;
    }),
  };
}
