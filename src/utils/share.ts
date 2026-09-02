export const X_PROFILE = '@YuhgoSlavia';
export const X_PROFILE_URL = 'https://x.com/YuhgoSlavia';

export async function shareToX(text: string): Promise<void> {
  const url = `https://x.com/intent/post?text=${encodeURIComponent(text)}`;
  window.open(url, '_blank', 'noopener,noreferrer');
}

export async function followYuhgo(): Promise<void> {
  window.open(X_PROFILE_URL, '_blank', 'noopener,noreferrer');
}
