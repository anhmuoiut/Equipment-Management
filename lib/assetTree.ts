/**
 * Quy tắc cây tài sản (docs/DATABASE.md "Cây tài sản") — bản JS của asset_parent_allowed trong database,
 * dùng khi kiểm tra file import (báo lỗi theo dòng trước khi gọi database) và giao diện. Database vẫn là nơi quyết
 * định: mọi đường ghi đều bị chặn ở đó (PARENT_TYPE_INVALID).
 *
 *   Tester ⊃ Base · Fixture · sub-equipment · golden board;  Base ⊃ Fixture;  Fixture ⊃ golden board.
 */
export type AssetKind = 'tester' | 'base' | 'fixture' | 'sub_equipment' | 'golden_board';
export type ParentKind = 'tester' | 'base' | 'fixture';

const ALLOWED: Record<ParentKind, readonly AssetKind[]> = {
  tester: ['base', 'fixture', 'sub_equipment', 'golden_board'],
  base: ['fixture'],
  fixture: ['golden_board'],
};

/** Con loại `child` có được nằm dưới cha loại `parent` không. */
export function parentAllowed(child: AssetKind, parent: string | null | undefined): boolean {
  return !!parent && parent in ALLOWED && ALLOWED[parent as ParentKind].includes(child);
}
