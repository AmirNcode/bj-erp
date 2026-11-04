'use client';

/**
 * A person's face (FR-82), or their initials while it loads / when there is none.
 *
 * `version`: a number → the photo exists, URL is cache-forever; `null` → known to have no photo,
 * no request at all; omitted → looked up through the batched usePhotoVersion store (one call per
 * screen), initials meanwhile.
 *
 * Decorative: every screen shows the name next to it, so it is hidden from screen readers.
 */

import { useState } from 'react';
import { avatarColor, initials } from '@/lib/photo/initials';
import { usePhotoVersion } from '@/lib/photo/usePhotoVersion';
import { cn } from '@/lib/utils';

const SIZES = {
  xs: 'size-6 text-[10px]',
  sm: 'size-8 text-xs',
  md: 'size-10 text-sm',
  lg: 'size-14 text-lg',
  xl: 'size-24 text-2xl',
} as const;

export type AvatarSize = keyof typeof SIZES;

export function photoUrl(id: string, version?: number | null) {
  return version ? `/api/photo/${id}?v=${version}` : `/api/photo/${id}`;
}

export function PersonAvatar({
  id,
  name,
  version,
  size = 'sm',
  className,
}: {
  id: string;
  name: string | null | undefined;
  version?: number | null;
  size?: AvatarSize;
  className?: string;
}) {
  const looked = usePhotoVersion(id, version === undefined);
  const known = version === undefined ? looked : version;
  const src = known ? photoUrl(id, known) : null;
  // Keyed on the URL, so a new version starts hidden again.
  const [state, setState] = useState<{ src: string | null; status: 'loading' | 'loaded' | 'failed' }>({
    src,
    status: 'loading',
  });
  const status = state.src === src ? state.status : 'loading';
  if (state.src !== src) setState({ src, status: 'loading' });

  return (
    <span
      className={cn(
        'relative inline-flex shrink-0 select-none items-center justify-center overflow-hidden rounded-full font-semibold leading-none',
        SIZES[size],
        status === 'loaded' ? 'bg-muted' : avatarColor(id),
        className
      )}
      aria-hidden="true"
      data-testid="person-avatar"
    >
      <span className={cn(status === 'loaded' && 'invisible')}>
        {initials(name)}
      </span>
      {src && status !== 'failed' && (
        // A same-origin, already-small JPEG; nothing for the image optimizer to do.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt=""
          loading="lazy"
          decoding="async"
          draggable={false}
          // A server-rendered <img> can finish before hydration attaches onLoad: check on mount.
          ref={(el) => {
            if (el && status === 'loading' && el.complete && el.naturalWidth > 0) setState({ src, status: 'loaded' });
          }}
          onLoad={() => setState({ src, status: 'loaded' })}
          onError={() => setState({ src, status: 'failed' })}
          className={cn('absolute inset-0 size-full object-cover', status !== 'loaded' && 'opacity-0')}
        />
      )}
    </span>
  );
}
