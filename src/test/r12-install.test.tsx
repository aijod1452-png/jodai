import { act, cleanup, render, screen, fireEvent } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PwaInstallCard } from '../hub/components/PwaInstallCard';
import type { InstallPromptEvent } from '../hub/use-pwa';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('R12 installation and connectivity', () => {
  it('uses the browser prompt once and only confirms installed after appinstalled', async () => {
    render(<PwaInstallCard />);
    const button = screen.getByRole('button', { name: 'ติดตั้งแอป' });
    expect(button).toBeDisabled();
    const event = new Event('beforeinstallprompt', { cancelable: true }) as InstallPromptEvent;
    event.prompt = vi.fn().mockResolvedValue(undefined);
    event.userChoice = Promise.resolve({ outcome: 'accepted', platform: 'web' });
    act(() => window.dispatchEvent(event));
    expect(event.defaultPrevented).toBe(true);
    expect(button).toBeEnabled();
    await act(async () => fireEvent.click(button));
    expect(event.prompt).toHaveBeenCalledOnce();
    expect(screen.queryByText('ติดตั้งแล้ว')).not.toBeInTheDocument();
    expect(button).toBeDisabled();
    act(() => window.dispatchEvent(new Event('appinstalled')));
    expect(screen.getByText('ติดตั้งแล้ว')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'ติดตั้งแอป' })).not.toBeInTheDocument();
  });
  it('dismissed prompt does not falsely mark installed', async () => {
    render(<PwaInstallCard />);
    const event = new Event('beforeinstallprompt') as InstallPromptEvent;
    event.prompt = vi.fn().mockResolvedValue(undefined);
    event.userChoice = Promise.resolve({ outcome: 'dismissed', platform: 'web' });
    act(() => window.dispatchEvent(event));
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'ติดตั้งแอป' })));
    expect(screen.queryByText('ติดตั้งแล้ว')).not.toBeInTheDocument();
  });
  it('detects standalone at mount', () => {
    vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() } as unknown as MediaQueryList);
    render(<PwaInstallCard />);
    expect(screen.getByText('ติดตั้งแล้ว')).toBeInTheDocument();
  });
  it('tracks connectivity and removes listeners on unmount', () => {
    const online = vi.spyOn(navigator, 'onLine', 'get');
    online.mockReturnValue(true);
    const view = render(<PwaInstallCard />);
    expect(screen.getByText('ออนไลน์')).toBeInTheDocument();
    online.mockReturnValue(false);
    act(() => window.dispatchEvent(new Event('offline')));
    expect(screen.getByText('ออฟไลน์')).toBeInTheDocument();
    online.mockReturnValue(true);
    act(() => window.dispatchEvent(new Event('online')));
    expect(screen.getByText('ออนไลน์')).toBeInTheDocument();
    const remove = vi.spyOn(window, 'removeEventListener');
    view.unmount();
    expect(remove).toHaveBeenCalledWith('beforeinstallprompt', expect.any(Function));
    expect(remove).toHaveBeenCalledWith('appinstalled', expect.any(Function));
    expect(remove).toHaveBeenCalledWith('offline', expect.any(Function));
    expect(remove).toHaveBeenCalledWith('online', expect.any(Function));
  });
});