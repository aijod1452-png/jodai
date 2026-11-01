import { useEffect, useState } from 'react';

export interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

export function usePwa() {
  const [installEvent, setInstallEvent] = useState<InstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);
  const [online, setOnline] = useState(true);
  const [installing, setInstalling] = useState(false);
  const [installError, setInstallError] = useState('');
  const [ios, setIos] = useState(false);

  useEffect(() => {
    const media = window.matchMedia('(display-mode: standalone)');
    const syncInstalled = () => setInstalled(media.matches || (navigator as Navigator & { standalone?: boolean }).standalone === true);
    const syncOnline = () => setOnline(navigator.onLine);
    const onPrompt = (event: Event) => { event.preventDefault(); setInstallEvent(event as InstallPromptEvent); };
    const onInstalled = () => { setInstalled(true); setInstallEvent(null); };
    syncInstalled(); syncOnline();
    setIos(/iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    window.addEventListener('online', syncOnline);
    window.addEventListener('offline', syncOnline);
    media.addEventListener('change', syncInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
      window.removeEventListener('online', syncOnline);
      window.removeEventListener('offline', syncOnline);
      media.removeEventListener('change', syncInstalled);
    };
  }, []);

  const install = async () => {
    if (!installEvent || installing || installed) return;
    setInstalling(true); setInstallError('');
    try {
      await installEvent.prompt();
      await installEvent.userChoice;
      // Acceptance isn't proof of installation; wait for appinstalled/standalone.
    } catch { setInstallError('เปิดหน้าต่างติดตั้งไม่สำเร็จ กรุณาลองใหม่'); }
    finally { setInstallEvent(null); setInstalling(false); }
  };
  return { installed, online, installing, installError, ios, canInstall: !!installEvent && !installed, install };
}