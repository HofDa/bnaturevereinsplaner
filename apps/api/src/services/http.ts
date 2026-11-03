// RFC 6266/5987: ASCII fallback plus the exact UTF-8 filename.
export function attachmentDisposition(filename: string) {
  const fallback = filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}
