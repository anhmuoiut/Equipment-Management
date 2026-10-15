// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }) }));

import { ErrorState } from './index';

afterEach(() => { vi.unstubAllGlobals(); });

describe('ErrorState', () => {
  it('shows a title and the plain message, with a Retry that calls back', () => {
    const retry = vi.fn();
    render(<ErrorState message="Could not load the list." onRetry={retry} />);
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByText('common.errorTitle')).toBeTruthy();
    expect(screen.getByText('Could not load the list.')).toBeTruthy();
    expect(screen.queryByText('common.errorReference')).toBeNull(); // no reference, no reference row
    fireEvent.click(screen.getByRole('button', { name: /common.retry/ }));
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it('without onRetry there is no Retry button', () => {
    render(<ErrorState message="Not found." />);
    expect(screen.queryByRole('button', { name: /common.retry/ })).toBeNull();
  });

  it('a server error\'s "(req_…)" becomes a separate, copyable reference — not part of the sentence — with a hint for the admin', async () => {
    const writeText = vi.fn(async () => {});
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    render(<ErrorState message="System error. Please try again. (req_8d22f1ae-1821-42d4-9b5c-d9861a780dec)" onRetry={() => {}} />);
    expect(screen.getByText('System error. Please try again.')).toBeTruthy();
    expect(screen.getByText('req_8d22f1ae-1821-42d4-9b5c-d9861a780dec').tagName).toBe('CODE');
    expect(screen.getByText('common.errorHint')).toBeTruthy();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'common.copy' })); });
    expect(writeText).toHaveBeenCalledWith('req_8d22f1ae-1821-42d4-9b5c-d9861a780dec');
    expect(screen.getByRole('button', { name: 'common.copied' })).toBeTruthy();
  });

  it('when the clipboard is blocked nothing breaks (the reference is still selectable text)', async () => {
    vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn(async () => { throw new Error('denied'); }) } });
    render(<ErrorState message="Oops (req_abc-123)" />);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'common.copy' })); });
    expect(screen.getByText('req_abc-123')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'common.copy' })).toBeTruthy(); // still "Copy", not "Copied"
  });

  it('only a trailing "(req_…)" is taken as the reference; text in the middle of a sentence is left alone', () => {
    render(<ErrorState message="Value (req_x) was refused for this field." />);
    expect(screen.getByText('Value (req_x) was refused for this field.')).toBeTruthy();
    expect(screen.queryByText('common.errorReference')).toBeNull();
  });
});
