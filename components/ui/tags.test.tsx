// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { CalibrationStatusTag, DueDate, StatusTag, UsageTag } from './tags';
import { ManualTagColorPicker, TagPicker } from './TagPicker';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

describe('manual tags are separate from operating and deadline statuses', () => {
  it.each([
    ['Upcoming receive', 'red', 'blue'], ['Normal', 'green', 'green'],
    ['Deactivated', 'red', 'gray'], ['Wait for registration', 'yellow', 'purple'],
    ['  WAIT FOR   REGISTRATION ', 'blue', 'purple'], ['Chờ đăng ký', 'blue', 'purple'],
    ['Custom red tag', 'red', 'red'], ['Custom yellow tag', 'yellow', 'yellow'],
    ['Custom purple tag', 'purple', 'purple'],
  ] as const)('%s uses its manual palette, including canonical names with old colors', (name, color, palette) => {
    render(<StatusTag name={name} color={color} />);
    const tag = screen.getByText(name.trim().replace(/\s+/g, ' '));
    expect(tag.getAttribute('data-manual-color')).toBe(palette);
    expect(tag.querySelector('svg, .tag-dot')).toBeNull();
  });

  it('In use and Overdue can appear together; Overdue keeps its warning color', () => {
    const { container } = render(<><UsageTag usage="in_use" /><CalibrationStatusTag status="overdue" /></>);
    expect(screen.getByText('values.in_use')).toBeTruthy();
    const overdue = screen.getByText('cal.status.overdue');
    expect(overdue.getAttribute('data-status-color')).toBe('red');
    expect(overdue.getAttribute('data-manual-color')).toBeNull();
    expect(container.querySelectorAll('.tag-dot')).toHaveLength(1);
  });

  it('a deadline uses the same calibration tag, and a missing date stays empty', () => {
    const { rerender, container } = render(<DueDate date="2026-10-01" status="overdue" />);
    expect(screen.getByText('cal.status.overdue').getAttribute('data-cal-status')).toBe('overdue');
    rerender(<DueDate date={null} status="overdue" />);
    expect(container.textContent).toBe('');
  });

  it('offers all six palettes and keeps red and yellow selections distinct from purple', () => {
    const onChange = vi.fn();
    render(<ManualTagColorPicker id="color" value="red" onChange={onChange} label="Color" />);
    const picker = screen.getByRole('radiogroup', { name: 'Color' });
    expect(within(picker).getAllByRole('radio').map((r) => (r as HTMLInputElement).value)).toEqual(['blue', 'green', 'gray', 'purple', 'yellow', 'red']);
    expect((within(picker).getByRole('radio', { checked: true }) as HTMLInputElement).value).toBe('red');
    fireEvent.click(within(picker).getByRole('radio', { name: 'cfg.tagPalette.yellow' }));
    expect(onChange).toHaveBeenLastCalledWith('yellow');
    fireEvent.click(within(picker).getByRole('radio', { name: 'cfg.tagPalette.purple' }));
    expect(onChange).toHaveBeenLastCalledWith('purple');
  });

  it('manual selection keeps its label and aria-pressed without adding icons', () => {
    const onChange = vi.fn();
    render(<TagPicker id="tags" value={['normal']} onChange={onChange} label="Tags" tags={[
      { id: 'normal', display_name: 'Normal', sort_order: 0, color: 'green' },
    ]} />);
    const button = screen.getByRole('button', { name: 'Normal' });
    expect(button.getAttribute('aria-pressed')).toBe('true');
    expect(button.querySelector('svg')).toBeNull();
    fireEvent.click(button);
    expect(onChange).toHaveBeenCalledWith([]);
  });
});
