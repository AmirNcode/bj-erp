/**
 * Pure device-type detection from a User-Agent string. Provided for future
 * modules that serve mobile-optimized forms vs desktop dashboards (NFR-1).
 * Defaults to 'desktop' when the UA is absent.
 */

export function parseDeviceType(userAgent: string | null | undefined): 'mobile' | 'desktop' {
  if (!userAgent) return 'desktop';
  return /Mobi|Android|iPhone|iPod|iPad|Windows Phone|webOS|BlackBerry/i.test(userAgent)
    ? 'mobile'
    : 'desktop';
}
