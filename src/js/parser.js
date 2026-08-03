// Green Hole URL Parser Engine (greenhole.online)

export function detectPlatform(url) {
  if (!url || typeof url !== 'string') return null;

  const cleanUrl = url.trim().toLowerCase();

  if (cleanUrl.includes('youtube.com') || cleanUrl.includes('youtu.be')) {
    const isShorts = cleanUrl.includes('/shorts/');
    return {
      id: 'youtube',
      name: isShorts ? 'YouTube Shorts' : 'YouTube',
      badgeClass: 'youtube',
      icon: `<svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14"><path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/></svg>`
    };
  }

  if (cleanUrl.includes('tiktok.com') || cleanUrl.includes('vt.tiktok.com') || cleanUrl.includes('vm.tiktok.com')) {
    return {
      id: 'tiktok',
      name: 'TikTok No Watermark',
      badgeClass: 'tiktok',
      icon: `<svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14"><path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-5.2 1.74 2.89 2.89 0 0 1 2.31-4.64c.29 0 .56.04.83.1v-3.6a6.49 6.49 0 0 0-4.14 11.96 6.49 6.49 0 0 0 9.65-5.65V9.45c1.4.99 3.12 1.57 4.97 1.62v-3.6a4.82 4.82 0 0 1-1.2-.78z"/></svg>`
    };
  }

  if (cleanUrl.includes('instagram.com')) {
    const isReels = cleanUrl.includes('/reel/') || cleanUrl.includes('/reels/');
    return {
      id: 'instagram',
      name: isReels ? 'Instagram Reel' : 'Instagram Video',
      badgeClass: 'instagram',
      icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><rect x="2" y="2" width="20" height="20" rx="5" ry="5"/><path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"/><line x1="17.5" y1="6.5" x2="17.51" y2="6.5"/></svg>`
    };
  }

  if (cleanUrl.includes('facebook.com') || cleanUrl.includes('fb.watch') || cleanUrl.includes('fb.com')) {
    return {
      id: 'facebook',
      name: 'Facebook HD',
      badgeClass: 'facebook',
      icon: `<svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg>`
    };
  }

  return null;
}

export function isValidUrl(string) {
  try {
    const url = new URL(string);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch (_) {
    return false;
  }
}
