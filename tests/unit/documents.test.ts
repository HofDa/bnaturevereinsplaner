import { describe, it, expect } from 'vitest';
import {
  detectMediaType,
  filenameSchema,
  encodeDocumentMetadata,
  decodeDocumentMetadata,
  documentInputSchema,
  can,
} from '../../packages/contracts/src';

describe('document contracts', () => {
  it('detects files by signature only', () => {
    expect(detectMediaType(new TextEncoder().encode('%PDF-1.7'))).toBe('application/pdf');
    expect(detectMediaType(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe(
      'image/png',
    );
    expect(detectMediaType(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
    expect(detectMediaType(new TextEncoder().encode('<svg onload=alert(1)>'))).toBeNull();
    expect(detectMediaType(new TextEncoder().encode('%PD'))).toBeNull();
    expect(detectMediaType(new Uint8Array())).toBeNull();
  });
  it('neutralizes path separators and control characters in file names', () => {
    expect(filenameSchema.parse('../../etc/passwd')).toBe('.._.._etc_passwd');
    expect(filenameSchema.parse('C:\\Belege\\Quittung\u0000\u202e.pdf')).toBe(
      'C__Belege_Quittung.pdf',
    );
    expect(filenameSchema.parse('Prüfbericht – Mai.pdf')).toBe('Prüfbericht – Mai.pdf');
    expect(filenameSchema.safeParse('..').success).toBe(false);
    expect(filenameSchema.safeParse(' \u0007 ').success).toBe(false);
    expect(filenameSchema.parse(`${'a'.repeat(300)}.pdf`)).toHaveLength(200);
  });
  it('round-trips UTF-8 metadata through a header-safe encoding', () => {
    const value = {
      title: 'Verbale dell’assemblea – Größe',
      category: 'minutes',
      filename: 'ä.pdf',
    };
    const encoded = encodeDocumentMetadata(value);
    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeDocumentMetadata(encoded)).toEqual(value);
    expect(documentInputSchema.parse(decodeDocumentMetadata(encoded)).cashbookEntryId).toBeNull();
    expect(
      documentInputSchema.safeParse({ ...value, organizationId: crypto.randomUUID() }).success,
    ).toBe(false);
  });
  it('grants document access to administration roles only', () => {
    for (const role of ['admin', 'board', 'treasurer'] as const) {
      expect(can(role, 'documents:read')).toBe(true);
      expect(can(role, 'documents:write')).toBe(true);
    }
    for (const role of ['project_lead', 'member'] as const)
      expect(can(role, 'documents:read')).toBe(false);
  });
});
