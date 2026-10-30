import { describe, it, expect } from 'vitest';
import {
  assessCoverage,
  uncoveredPeriods,
  netMinutes,
  confirmedTotal,
  formatMinutes,
  registerDataIssues,
  timeEntryInputSchema,
  annualDate,
  dueDateFor,
  nextReminder,
  detectSignatureMediaType,
  type CoverageInput,
} from '../../packages/contracts/src';
import { technicalSignatureChecks } from '../../apps/api/src/services/signature';
import { renderPdf } from '../../apps/api/src/modules/finance/pdf';
import de from '../../apps/web/src/locales/volunteers-de';
import italian from '../../apps/web/src/locales/volunteers-it';

const policy = (patch: Partial<CoverageInput['coverages'][number]['policy']> = {}) => ({
  status: 'active',
  startsOn: '2026-01-01',
  endsOn: '2026-12-31',
  coverageTypes: ['accident', 'illness', 'liability'] as ('accident' | 'illness' | 'liability')[],
  hasDocument: true,
  ...patch,
});
const base: CoverageInput = {
  date: '2026-06-01',
  engagement: { volunteerType: 'regular', startedOn: '2026-02-01', endedOn: null },
  registeredOn: '2026-02-01',
  coverages: [{ coveredFrom: '2026-02-01', coveredTo: null, notified: true, policy: policy() }],
};
describe('indicative insurance assessment', () => {
  it('never claims more than a possible coverage and requires all formal prerequisites', () => {
    expect(assessCoverage(base).status).toBe('possibly_covered');
    expect(assessCoverage({ ...base, coverages: [] }).status).toBe('none');
    const notNotified = assessCoverage({
      ...base,
      coverages: [{ ...base.coverages[0]!, notified: false }],
    });
    expect(notNotified).toMatchObject({ status: 'assigned', reasons: ['coverageNotNotified'] });
    expect(assessCoverage({ ...base, registeredOn: null }).reasons).toContain(
      'coverageNotRegistered',
    );
    // D.M. 6.10.2021 art. 2 c. 4: protection starts at 24:00 of the registration day.
    expect(assessCoverage({ ...base, registeredOn: '2026-06-01' }).reasons).toContain(
      'coverageRegistrationSameDay',
    );
    expect(
      assessCoverage({
        ...base,
        engagement: { ...base.engagement, volunteerType: 'occasional' },
        registeredOn: null,
      }).status,
    ).toBe('possibly_covered');
  });
  it('reports missing risks and periods as unclear with concrete gaps', () => {
    const liability = assessCoverage({
      ...base,
      coverages: [{ ...base.coverages[0]!, policy: policy({ coverageTypes: ['liability'] }) }],
    });
    expect(liability.status).toBe('unclear');
    expect(liability.gaps.map((g) => g.type)).toEqual(['accident', 'illness']);
    const late = assessCoverage({
      ...base,
      coverages: [{ ...base.coverages[0]!, coveredFrom: '2026-03-01' }],
    });
    expect(late.status).toBe('assigned');
    expect(late.gaps).toContainEqual({ type: 'accident', from: '2026-02-01', to: '2026-02-28' });
    expect(assessCoverage({ ...base, date: '2027-01-15' }).status).toBe('unclear');
    expect(
      assessCoverage({
        ...base,
        coverages: [{ ...base.coverages[0]!, policy: policy({ status: 'cancelled' }) }],
      }).status,
    ).toBe('unclear');
  });
  it('computes uncovered inclusive date ranges', () => {
    expect(
      uncoveredPeriods({ from: '2026-01-01', to: '2026-01-31' }, [
        { from: '2026-01-05', to: '2026-01-10' },
        { from: '2026-01-11', to: null },
      ]),
    ).toEqual([{ from: '2026-01-01', to: '2026-01-04' }]);
    expect(uncoveredPeriods({ from: '2026-01-01', to: '2026-01-10' }, [])).toEqual([
      { from: '2026-01-01', to: '2026-01-10' },
    ]);
  });
});
describe('volunteer hours', () => {
  it('subtracts breaks and sums only confirmed entries', () => {
    expect(netMinutes('2026-05-01T08:00:00Z', '2026-05-01T11:30:00Z', 30)).toBe(180);
    expect(
      confirmedTotal([
        { status: 'confirmed', minutes: 60 },
        { status: 'draft', minutes: 500 },
        { status: 'submitted', minutes: 30 },
        { status: 'confirmed', minutes: 45 },
      ]),
    ).toBe(105);
    expect(formatMinutes(150)).toBe('2:30');
  });
  it('rejects invalid time entries', () => {
    const entry = {
      engagementId: crypto.randomUUID(),
      actualStart: '2026-05-01T08:00:00Z',
      actualEnd: '2026-05-01T09:00:00Z',
    };
    expect(timeEntryInputSchema.safeParse(entry).success).toBe(true);
    expect(timeEntryInputSchema.safeParse({ ...entry, breakMinutes: 60 }).success).toBe(false);
    expect(
      timeEntryInputSchema.safeParse({ ...entry, actualEnd: '2026-05-01T07:00:00Z' }).success,
    ).toBe(false);
    expect(
      timeEntryInputSchema.safeParse({ ...entry, actualEnd: '2026-05-02T09:00:01Z' }).success,
    ).toBe(false);
  });
});
describe('register data requirements (D.M. 6.10.2021 art. 3 c. 4)', () => {
  const person = {
    firstName: 'Anna',
    lastName: 'Huber',
    fiscalCode: '',
    dateOfBirth: null,
    birthPlace: '',
    street: '',
    postalCode: '',
    city: '',
    country: 'IT',
    domicile: '',
  };
  it('accepts fiscal code or identity with birth data, and residence or domicile', () => {
    expect(registerDataIssues(person)).toEqual([
      'registerIdentificationMissing',
      'registerResidenceMissing',
    ]);
    expect(
      registerDataIssues({
        ...person,
        fiscalCode: 'HBRNNA80A41A952X',
        domicile: 'Via Roma 1, Bolzano',
      }),
    ).toEqual([]);
    expect(
      registerDataIssues({
        ...person,
        dateOfBirth: '1980-01-01',
        birthPlace: 'Brixen',
        street: 'Domplatz 1',
        city: 'Brixen',
      }),
    ).toEqual([]);
  });
});
describe('deadline calculation', () => {
  it('adds offsets, clamps calendar days and finds the next reminder', () => {
    expect(dueDateFor({ basis: 'fiscal_year_end', offsetDays: 180 }, '2025-12-31')).toBe(
      '2026-06-29',
    );
    expect(dueDateFor({ basis: 'fiscal_year_end', offsetDays: 180 }, '2023-12-31')).toBe(
      '2024-06-28',
    );
    expect(dueDateFor({ basis: 'board_mandate_end', offsetDays: -60 }, '2027-02-28')).toBe(
      '2026-12-30',
    );
    expect(annualDate(2026, 2, 31)).toBe('2026-02-28');
    expect(nextReminder('2026-12-31', [30, 7], '2026-12-10')).toBe('2026-12-24');
    expect(nextReminder('2026-12-31', [30, 7], '2027-01-01')).toBeNull();
  });
});
describe('signature files', () => {
  const pdf = Buffer.from('%PDF-1.7\nsnapshot\n%%EOF');
  it('detects signature containers by content and declared type', () => {
    const der = Buffer.concat([Buffer.from([0x30, 0x82, 0x01, 0x00]), Buffer.alloc(80)]);
    expect(detectSignatureMediaType(der, 'application/pkcs7-mime')).toBe('application/pkcs7-mime');
    expect(detectSignatureMediaType(der, 'application/pdf')).toBeNull();
    expect(
      detectSignatureMediaType(
        Buffer.from('plain text pretending to be DER....................................'),
        'application/timestamp-reply',
      ),
    ).toBeNull();
    expect(detectSignatureMediaType(der, 'image/png')).toBeNull();
  });
  it('checks structure without claiming legal validity', () => {
    const signed = Buffer.concat([
      pdf,
      Buffer.from('\n<< /Type /Sig /ByteRange [0 1 2 3] >>\n%%EOF'),
    ]);
    expect(technicalSignatureChecks('signed', pdf, signed, 'application/pdf', null)).toMatchObject({
      signatureDictionary: true,
      preservesSnapshot: true,
    });
    expect(
      technicalSignatureChecks(
        'signed',
        pdf,
        Buffer.from('%PDF-1.7\nother'),
        'application/pdf',
        null,
      ),
    ).toMatchObject({ preservesSnapshot: false });
    const p7m = Buffer.concat([Buffer.from([0x30, 0x80]), pdf, Buffer.alloc(64)]);
    expect(
      technicalSignatureChecks('signed', pdf, p7m, 'application/pkcs7-mime', null),
    ).toMatchObject({ preservesSnapshot: true });
  });
  it('renders byte-identical PDFs for identical snapshot input', async () => {
    const date = new Date('2026-10-30T10:00:00Z');
    const a = await renderPdf('Register', 'Verein', ['#1 Huber Anna'], 'de', 'Hinweis', date);
    const b = await renderPdf('Register', 'Verein', ['#1 Huber Anna'], 'de', 'Hinweis', date);
    expect(a.equals(b)).toBe(true);
  });
});
describe('volunteer texts', () => {
  it('provides every German key in Italian and never claims certification', () => {
    expect(Object.keys(italian).sort()).toEqual(Object.keys(de).sort());
    for (const value of [...Object.values(de), ...Object.values(italian)])
      expect(value).not.toMatch(/rechtskonform zertifiziert|certificato a norma/i);
  });
});
