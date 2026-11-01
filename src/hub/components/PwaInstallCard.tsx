import { CheckCircle2, Download, Smartphone, Wifi, WifiOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { usePwa } from '../use-pwa';

export function PwaInstallCard() {
  const pwa = usePwa();
  return <section aria-label="ติดตั้ง JodAI" className="space-y-3 border-b border-border py-4">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-3">
        <Smartphone className="text-primary" size={22} />
        <div><h3 className="text-sm font-semibold">JodAI บนอุปกรณ์ของคุณ</h3>
          <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground" role="status">
            {pwa.online ? <Wifi size={13} /> : <WifiOff size={13} />}{pwa.online ? 'ออนไลน์' : 'ออฟไลน์'}
          </p>
        </div>
      </div>
      {pwa.installed ? <span className="inline-flex items-center gap-2 text-sm text-primary" role="status"><CheckCircle2 size={16} />ติดตั้งแล้ว</span> :
        <Button onClick={pwa.install} disabled={!pwa.canInstall || pwa.installing} size="sm"><Download />{pwa.installing ? 'กำลังติดตั้ง…' : 'ติดตั้งแอป'}</Button>}
    </div>
    {!pwa.installed && !pwa.canInstall && <p className="text-xs text-muted-foreground">{pwa.ios ? 'ติดตั้งผ่านเมนูแชร์ของ Safari → เพิ่มไปยังหน้าจอโฮม' : 'ยังไม่มีคำเชิญติดตั้งจากเบราว์เซอร์'}</p>}
    {pwa.installError && <p role="alert" className="text-xs text-destructive">{pwa.installError}</p>}
  </section>;
}