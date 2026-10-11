import { strict as assert } from 'node:assert';
import type { PoolClient } from 'pg';
import type { CertificateTemplate } from '../types';

process.env.DATABASE_URL = 'postgresql://test:test@127.0.0.1:5432/test';

const [{ pool }, { getCertificateTemplates, saveCertificateTemplate }] = await Promise.all([
  import('./index'),
  import('./certificateTemplates'),
]);

const now = '2026-01-01T00:00:00.000Z';
const legacyRow = {
  code: 'legacy-format',
  name: 'Legacy Barangay Record',
  template_body: 'Original saved text for {{farmer_name}}',
  template_data: {},
  css_styles: {},
  is_active: true,
  created_at: now,
  updated_at: now,
  barangay_id: 'barangay-ambacon',
  barangay_name: 'Ambacon',
  legacy_signatories: [{
    id: 'legacy-signatory',
    name: 'Authorized Officer',
    position: 'Punong Barangay',
    signatureImageUrl: null,
    order: 1,
  }],
};

const fullTemplate: CertificateTemplate = {
  id: 'new-template-id',
  name: 'New certification',
  barangay: 'All',
  documentType: 'Barangay Certification',
  documentTitle: 'Municipal certification',
  titleFont: 'serif_bold',
  language: 'english',
  pageSize: 'Folio',
  orientation: 'portrait',
  header: {
    countryText: 'Republic of the Philippines',
    provinceText: 'Province of Southern Leyte',
    municipalityText: 'Municipality of Hinunangan',
    barangayText: 'All Barangays',
  },
  logos: [],
  watermark: {
    enabled: false,
    type: 'municipality',
    opacity: 0.12,
    position: 'center',
    size: 'large',
  },
  bodyTemplate: 'Saved certificate for {{farmer_name}}',
  signatories: [],
  receipt: { showReceiptBox: false },
  isActive: true,
  createdAt: now,
  updatedAt: now,
};

let rows = [legacyRow];
let failTemplateQuery = false;
const queries: string[] = [];
const client = {
  async query(text: string, values: unknown[] = []) {
    queries.push(text);
    if (text.includes('FROM public.certificate_templates ct')) {
      if (failTemplateQuery) throw Object.assign(new Error('relation does not exist'), { code: '42P01' });
      return { rows };
    }
    if (text.includes('SELECT id FROM public.barangays')) {
      return { rows: [{ id: 'barangay-ambacon' }] };
    }
    if (text.includes('SELECT barangay_id FROM public.certificate_templates')) {
      return { rows: rows.filter(row => row.code === values[0]).map(row => ({ barangay_id: row.barangay_id })) };
    }
    if (text.includes('INSERT INTO public.certificate_templates')) {
      const [barangayId, code, name, body, templateData, isActive] = values as [
        string | null,
        string,
        string,
        string,
        string,
        boolean,
      ];
      const data = JSON.parse(templateData);
      rows = rows.filter(row => row.code !== code);
      rows.push({
        ...legacyRow,
        code,
        name,
        template_body: body,
        template_data: data,
        is_active: isActive,
        barangay_id: barangayId,
        barangay_name: barangayId ? 'Ambacon' : null,
        legacy_signatories: [],
      });
      return { rows: [] };
    }
    return { rows: [] };
  },
  release() {},
};

Object.defineProperty(pool, 'connect', {
  configurable: true,
  value: async () => client as unknown as PoolClient,
});

const loadedLegacy = await getCertificateTemplates();
assert.equal(loadedLegacy.length, 1, 'loads records whose historic template_data is empty');
assert.equal(loadedLegacy[0].id, legacyRow.code, 'keeps the persistent template code');
assert.equal(loadedLegacy[0].bodyTemplate, legacyRow.template_body, 'uses the saved certificate body');
assert.equal(loadedLegacy[0].barangay, legacyRow.barangay_name, 'uses the linked barangay name');
assert.equal(loadedLegacy[0].signatories[0].name, 'Authorized Officer', 'loads legacy relational signatories');
assert.equal(loadedLegacy[0].documentTitle, legacyRow.name, 'provides a usable title for legacy rows');

const savedTemplate = await saveCertificateTemplate(fullTemplate, {
  role: 'admin',
  assignedBarangay: '',
  isAdmin: true,
});
assert.equal(savedTemplate.id, fullTemplate.id, 'returns the database-confirmed template');
assert.equal(savedTemplate.bodyTemplate, fullTemplate.bodyTemplate, 'returns the persisted layout body');
assert.equal(
  queries.some(query => query.includes('UPDATE public.certificate_templates SET is_active')),
  false,
  'saving one template does not deactivate templates omitted from a client payload',
);

const focalTemplate = { ...fullTemplate, id: 'focal-template', barangay: 'Ambacon' };
const savedFocalTemplate = await saveCertificateTemplate(focalTemplate, {
  role: 'focal',
  assignedBarangay: 'Ambacon',
  isAdmin: false,
});
assert.equal(savedFocalTemplate.id, focalTemplate.id, 'allows an assigned focal person to save a barangay template');
await assert.rejects(
  saveCertificateTemplate({ ...focalTemplate, id: 'outside-template', barangay: 'Bugho' }, {
    role: 'focal',
    assignedBarangay: 'Ambacon',
    isAdmin: false,
  }),
  /assigned barangay/,
  'rejects a focal person creating a template for another barangay',
);
await assert.rejects(
  saveCertificateTemplate({ ...fullTemplate, id: 'new-template-id', barangay: 'Ambacon' }, {
    role: 'focal',
    assignedBarangay: 'Ambacon',
    isAdmin: false,
  }),
  /shared template or a template belonging to another barangay/,
  'rejects a focal person editing a shared template',
);
failTemplateQuery = true;
await assert.rejects(
  getCertificateTemplates(),
  error => (error as NodeJS.ErrnoException).code === '42P01',
  'propagates actual database errors instead of returning an empty template list',
);

console.log('All certificate template database workflow tests passed.');
