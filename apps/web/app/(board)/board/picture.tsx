'use client';

import { Icon, ICON_NAMES, type IconName } from '@familywise/ui';
import Image from 'next/image';
import { useState } from 'react';

/** An icon the board knows by name, or the plain one. */
export const iconOf = (icon: string | null, fallback: IconName = 'list-check'): IconName =>
  icon && (ICON_NAMES as readonly string[]).includes(icon) ? (icon as IconName) : fallback;

/** Signed links to photos in the private rewards bucket, by path; null while there is none (offline). */
export type PhotoUrl = (path: string) => string | null;

/**
 * [PTS-03] A reward's or goal's photo when the board has a link for it, else its icon: offline, or
 * when the photo can't be read, the icon stands in (the snapshot works without photos).
 */
export function Picture({
  icon,
  photo,
  size,
  photoUrl,
  fallback = 'gift',
}: {
  icon: string;
  photo?: string | null;
  size: number;
  photoUrl?: PhotoUrl;
  fallback?: IconName;
}) {
  const [broken, setBroken] = useState<string | null>(null);
  const url = photo && photoUrl ? photoUrl(photo) : null;
  if (url && broken !== url) {
    return (
      <Image
        src={url}
        alt=""
        width={size}
        height={size}
        unoptimized
        className="fw-board-photo"
        style={{ width: size, height: size }}
        onError={() => setBroken(url)}
      />
    );
  }
  return <Icon name={iconOf(icon, fallback)} size={size} />;
}
