'use client';

/**
 * Danh sách con bên trái của trang Configuration (docs/UI.md):
 * gom nhóm, bấm tên nhóm để mở / đóng; nhóm chứa trang đang xem luôn mở.
 * Trên điện thoại đổi thành ô chọn thả xuống, các mục chia theo nhóm.
 */
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { SearchableSelect } from '@/components/ui/SearchableSelect';
import { CONFIG_GROUPS, CONFIG_LISTS, ERROR_LOG_PATH, configPath, type ConfigGroup } from '@/lib/configuration';

const STORAGE_KEY = 'configuration-nav-closed';

type Item = { path: string; label: string };

export function ConfigNav() {
  const { t } = useTranslation();
  const pathname = usePathname();
  const router = useRouter();
  const [closed, setClosed] = useState<ConfigGroup[]>([]);

  useEffect(() => {
    try { setClosed(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]') as ConfigGroup[]); } catch {}
  }, []);

  const groups: { key: ConfigGroup; items: Item[] }[] = CONFIG_GROUPS.map((group) => ({
    key: group,
    items: group === 'system'
      ? [{ path: ERROR_LOG_PATH, label: t('cfg.list.error-log') }]
      : CONFIG_LISTS.filter((l) => l.group === group).map((l) => ({ path: configPath(l.key), label: t(`cfg.list.${l.key}`) })),
  }));
  const currentGroup = groups.find((g) => g.items.some((i) => i.path === pathname))?.key;

  function toggle(group: ConfigGroup) {
    const next = closed.includes(group) ? closed.filter((g) => g !== group) : [...closed, group];
    setClosed(next);
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch {}
  }

  return (
    <nav className="cfg-nav" aria-label={t('nav.configuration')}>
      <SearchableSelect className="cfg-nav-select" value={pathname} onChange={(value) => router.push(value)}
        ariaLabel={t('nav.configuration')}
        options={groups.flatMap((g) => g.items.map((item) => ({
          value: item.path, label: item.label, group: t(`cfg.group.${g.key}`),
        })))} />
      <div className="cfg-nav-groups">
        {groups.map((g) => {
          const open = g.key === currentGroup || !closed.includes(g.key);
          return (
            <div key={g.key} className="cfg-nav-group" data-open={open}>
              <button type="button" className="cfg-nav-toggle" aria-expanded={open} onClick={() => toggle(g.key)}
                disabled={g.key === currentGroup}>
                {open ? <ChevronDown size={14} aria-hidden="true" /> : <ChevronRight size={14} aria-hidden="true" />}
                <span>{t(`cfg.group.${g.key}`)}</span>
                {!open && <span className="cfg-nav-count">({g.items.length})</span>}
              </button>
              {open && (
                <ul>
                  {g.items.map((i) => (
                    <li key={i.path}>
                      <Link href={i.path} className="cfg-nav-link" aria-current={pathname === i.path ? 'page' : undefined}>{i.label}</Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </div>
    </nav>
  );
}
