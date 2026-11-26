import React, { useState } from 'react';
import { AVATAR_ASSETS, SHOP_CATALOG } from '../game/constants.ts';

interface PlayerAvatarProps {
  avatarId: string;
  frameId?: string;
  username: string;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  online?: boolean;
}

export const PlayerAvatar: React.FC<PlayerAvatarProps> = ({
  avatarId,
  frameId = 'frame_bronze',
  username,
  size = 'md',
  online,
}) => {
  const [imgError, setImgError] = useState(false);
  const src = AVATAR_ASSETS[avatarId] || AVATAR_ASSETS.avatar_ace;
  const frame = SHOP_CATALOG.find((i) => i.id === frameId);

  const dims =
    size === 'sm'
      ? 'w-9 h-9 text-xs'
      : size === 'md'
        ? 'w-11 h-11 text-sm'
        : size === 'lg'
          ? 'w-16 h-16 text-lg'
          : 'w-20 h-20 text-xl';

  const borderColor = frame?.accentColor || '#d4af37';

  return (
    <div className="relative inline-flex shrink-0">
      <div
        className={`${dims} rounded-full overflow-hidden flex items-center justify-center bg-[#0c261a] font-bold text-amber-200`}
        style={{
          border: `2.5px solid ${borderColor}`,
          boxShadow: `0 0 0 2px rgba(7, 21, 15, 0.9)`,
        }}
      >
        {!imgError && src ? (
          <img
            src={src}
            alt={username}
            referrerPolicy="no-referrer"
            onError={() => setImgError(true)}
            className="w-full h-full object-cover"
          />
        ) : (
          <span>{username.slice(0, 2).toUpperCase()}</span>
        )}
      </div>
      {online !== undefined && (
        <span
          aria-label={online ? 'Online' : 'Offline'}
          className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-[#07150f] ${
            online ? 'bg-emerald-400' : 'bg-slate-500'
          }`}
        />
      )}
    </div>
  );
};
