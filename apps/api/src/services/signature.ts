import { createHash } from 'node:crypto';
import type { DocumentMediaType } from '@bnature/contracts';

// Boundary for later qualified signature (QES) and timestamp (RFC 3161) services.
// The bundled provider only prepares files for an external, manual signing process.
export interface SignatureProvider {
  readonly id: string;
  readonly qualified: boolean;
  requestSignature(file: {
    bytes: Buffer;
    sha256: string;
    filename: string;
  }): Promise<
    | { status: 'external_action_required' }
    | { status: 'signed'; bytes: Buffer; mediaType: DocumentMediaType }
  >;
  requestTimestamp(
    sha256: string,
  ): Promise<{ status: 'external_action_required' } | { status: 'timestamped'; token: Buffer }>;
}
export const manualExternalProvider: SignatureProvider = {
  id: 'manual-external',
  qualified: false,
  async requestSignature() {
    return { status: 'external_action_required' };
  },
  async requestTimestamp() {
    return { status: 'external_action_required' };
  },
};
const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
// Structural checks only. They never replace validation against a trusted list.
export function technicalSignatureChecks(
  kind: 'signed' | 'timestamp',
  original: Buffer,
  file: Buffer,
  mediaType: DocumentMediaType,
  signed: Buffer | null,
) {
  const base = { kind, mediaType, sha256: sha256(file), sizeBytes: file.length };
  if (kind === 'signed' && mediaType === 'application/pdf') {
    const text = file.toString('latin1');
    return {
      ...base,
      signatureDictionary: /\/ByteRange\s*\[/.test(text) && /\/Type\s*\/Sig\b/.test(text),
      // PAdES signatures append an incremental update; the original bytes stay unchanged.
      preservesSnapshot:
        file.length > original.length && file.subarray(0, original.length).equals(original),
    };
  }
  if (kind === 'signed')
    return { ...base, signatureDictionary: null, preservesSnapshot: file.indexOf(original) >= 0 };
  // RFC 3161 tokens contain the message imprint as raw bytes.
  const imprints = [original, ...(signed ? [signed] : [])].map((b) =>
    createHash('sha256').update(b).digest(),
  );
  return { ...base, imprintMatches: imprints.some((imprint) => file.indexOf(imprint) >= 0) };
}
