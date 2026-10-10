'use client';

import { Button, Icon } from '@familywise/ui';
import { useRouter } from 'next/navigation';
import { useState, useSyncExternalStore } from 'react';
import { deviceLabel } from '@/lib/reminder-settings';
import { saveSubscription } from './actions';

type Support = 'yes' | 'home-screen' | 'no' | 'unknown';

const never = () => () => undefined;
/** Whether this browser can take push reminders; an iPhone or iPad needs the Home Screen app. */
function readSupport(): Support {
  const ios = /iPhone|iPad/.test(navigator.userAgent);
  const push = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  if (push) return 'yes';
  return ios ? 'home-screen' : 'no';
}

function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const pad = '='.repeat((4 - (base64url.length % 4)) % 4);
  const raw = atob((base64url + pad).replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

async function registration(): Promise<ServiceWorkerRegistration> {
  const existing = await navigator.serviceWorker.getRegistration();
  return existing ?? (await navigator.serviceWorker.register('/sw.js'));
}

/**
 * [CHR-15][US-317] "Turn on reminders" on this phone or computer: the browser asks for permission
 * only after that tap (06: no prompt on page load), then this device is saved as the person's and
 * their reminders are on. An iPhone needs FamilyWise added to its Home Screen first.
 */
export function ThisDevice({
  vapidKey,
  label,
}: {
  /** The deployment's public VAPID key; null where reminders aren't set up yet. */
  vapidKey: string | null;
  /** The button's words: "Turn on reminders", or "Add this device". */
  label: string;
}) {
  const router = useRouter();
  const support = useSyncExternalStore<Support>(never, readSupport, () => 'unknown');
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function turnOn() {
    if (!vapidKey) return;
    setWorking(true);
    setMessage(null);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        setMessage(
          'Notifications are blocked for FamilyWise in this browser. Allow them in its settings, then try again.',
        );
        return;
      }
      const reg = await registration();
      await navigator.serviceWorker.ready;
      const subscription =
        (await reg.pushManager.getSubscription()) ??
        (await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: keyBytes(vapidKey),
        }));
      const saved = await saveSubscription(subscription.toJSON(), deviceLabel(navigator.userAgent));
      if (!saved.ok) {
        setMessage(saved.message);
        return;
      }
      router.replace('/admin/reminders?did=device');
      router.refresh();
    } catch {
      setMessage('This browser couldn’t turn on notifications. Try again, or try another browser.');
    } finally {
      setWorking(false);
    }
  }

  if (!vapidKey) {
    return <p className="fw-muted">Reminders aren’t set up on this site yet.</p>;
  }
  return (
    <div className="fw-reminders__device">
      {support === 'home-screen' ? (
        <p className="fw-muted">
          On an iPhone or iPad, add FamilyWise to your Home Screen first: tap Share, then Add to
          Home Screen, and open it from there.
        </p>
      ) : support === 'no' ? (
        <p className="fw-muted">This browser can’t show reminders.</p>
      ) : (
        <Button icon="bell" onClick={turnOn} disabled={working || support !== 'yes'}>
          {working ? 'Turning on…' : label}
        </Button>
      )}
      {/* Not a second status region (the page's banner is the one): a polite live line. */}
      <div aria-live="polite">
        {message ? (
          <p className="fw-banner fw-banner--notice">
            <Icon name="info" className="fw-banner__icon" />
            <span>{message}</span>
          </p>
        ) : null}
      </div>
    </div>
  );
}
