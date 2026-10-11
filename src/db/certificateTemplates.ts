import { pool } from './index.ts';
import { CertificateTemplate } from '../types.ts';
import type { PoolClient } from 'pg';

interface CertificateTemplateRow {
  code: string;
  name: string;
  template_body: string;
  template_data: unknown;
  is_active: boolean;
  updated_at: Date | string | null;
  created_at: Date | string | null;
  barangay_id: string | null;
  barangay_name: string | null;
  css_styles: unknown;
  legacy_signatories: unknown;
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function dateValue(value: Date | string | null, fallback: string): string {
  if (!value) return fallback;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? fallback : date.toISOString();
}

function mapLegacySignatories(value: unknown): CertificateTemplate['signatories'] {
  if (!Array.isArray(value)) return [];
  return value.map((item, index) => {
    const signatory = objectValue(item);
    return {
      id: String(signatory.id || `legacy-signatory-${index + 1}`),
      name: String(signatory.name || ''),
      position: String(signatory.position || ''),
      signatureImageUrl: typeof signatory.signatureImageUrl === 'string' ? signatory.signatureImageUrl : undefined,
      showSignatureImage: Boolean(signatory.signatureImageUrl),
      showSignatureLine: true,
      order: Number(signatory.order) || index + 1,
    };
  });
}

const mapTemplate = (row: CertificateTemplateRow): CertificateTemplate => {
  const parsedValue: unknown = typeof row.template_data === 'string'
    ? JSON.parse(row.template_data)
    : row.template_data;
  if (parsedValue !== null && (typeof parsedValue !== 'object' || Array.isArray(parsedValue))) {
    throw new Error(`Saved certificate template "${row.code}" has invalid configuration data.`);
  }
  const templateData = objectValue(parsedValue);
  const cssStyles = objectValue(row.css_styles);
  const createdAt = dateValue(row.created_at, new Date(0).toISOString());
  const updatedAt = dateValue(row.updated_at, createdAt);
  const barangay = row.barangay_id
    ? row.barangay_name || (typeof templateData.barangay === 'string' ? templateData.barangay : '')
    : typeof templateData.barangay === 'string' && templateData.barangay
      ? templateData.barangay
      : 'All';
  const header = objectValue(templateData.header);
  const watermark = objectValue(templateData.watermark);
  const receipt = objectValue(templateData.receipt);
  const legacySignatories = mapLegacySignatories(row.legacy_signatories);

  if (typeof row.template_body !== 'string' || !row.template_body.trim()) {
    throw new Error(`Saved certificate template "${row.code}" has no certificate body.`);
  }

  return {
    ...templateData,
    id: row.code,
    name: row.name,
    barangay,
    barangayId: row.barangay_id || undefined,
    bodyTemplate: row.template_body,
    documentType: typeof templateData.documentType === 'string'
      ? templateData.documentType
      : typeof cssStyles.documentType === 'string' ? cssStyles.documentType : '',
    documentTitle: typeof templateData.documentTitle === 'string' && templateData.documentTitle
      ? templateData.documentTitle
      : row.name,
    titleFont: templateData.titleFont === 'gothic' || templateData.titleFont === 'serif_underline' ||
      templateData.titleFont === 'sans_bold' ? templateData.titleFont : 'serif_bold',
    language: templateData.language === 'bisaya' || templateData.language === 'filipino' ||
      templateData.language === 'custom' ? templateData.language : 'english',
    pageSize: templateData.pageSize === 'A4' || templateData.pageSize === 'Letter' ? templateData.pageSize : 'Folio',
    orientation: templateData.orientation === 'landscape' ? 'landscape' : 'portrait',
    header: {
      countryText: typeof header.countryText === 'string' ? header.countryText : 'Republic of the Philippines',
      provinceText: typeof header.provinceText === 'string' ? header.provinceText : 'Province of Southern Leyte',
      municipalityText: typeof header.municipalityText === 'string' ? header.municipalityText : 'Municipality of Hinunangan',
      barangayText: typeof header.barangayText === 'string' ? header.barangayText : (barangay === 'All' ? '' : `Barangay ${barangay}`),
      ...header,
    },
    logos: Array.isArray(templateData.logos) ? templateData.logos : [],
    watermark: {
      enabled: false,
      type: 'municipality',
      opacity: 0.12,
      position: 'center',
      size: 'large',
      ...watermark,
    } as CertificateTemplate['watermark'],
    signatories: Array.isArray(templateData.signatories) ? templateData.signatories : legacySignatories,
    receipt: {
      showReceiptBox: false,
      ...receipt,
    } as CertificateTemplate['receipt'],
    isActive: row.is_active,
    createdAt: typeof templateData.createdAt === 'string' ? templateData.createdAt : createdAt,
    updatedAt,
  } as CertificateTemplate;
};

async function readStoredTemplates(client: PoolClient): Promise<CertificateTemplate[]> {
  const result = await client.query<CertificateTemplateRow>(
    `SELECT ct.code, ct.name, ct.template_body, ct.template_data, ct.css_styles,
            ct.is_active, ct.created_at, ct.updated_at, ct.barangay_id,
            b.name AS barangay_name,
            COALESCE((
              SELECT jsonb_agg(jsonb_build_object(
                'id', s.id,
                'name', s.full_name,
                'position', COALESCE(s.position_title, ''),
                'signatureImageUrl', s.signature_image_url,
                'order', cs.display_order
              ) ORDER BY cs.display_order)
              FROM public.certificate_signatories cs
              JOIN public.signatories s ON s.id = cs.signatory_id
              WHERE cs.template_id = ct.id AND s.is_active = TRUE
            ), '[]'::jsonb) AS legacy_signatories
     FROM public.certificate_templates ct
     LEFT JOIN public.barangays b ON b.id = ct.barangay_id
     WHERE ct.is_archived = FALSE
     ORDER BY ct.name`
  );
  return result.rows.map(mapTemplate);
}

export async function getCertificateTemplates(): Promise<CertificateTemplate[]> {
  const client = await pool.connect();
  try {
    const storedTemplates = await readStoredTemplates(client);
    if (storedTemplates.length > 0) return storedTemplates;

    const legacy = await client.query(
      "SELECT value FROM public.system_settings WHERE key = 'certificate_templates' LIMIT 1"
    );
    const legacyData = legacy.rows[0]?.value;
    const templates = Array.isArray(legacyData)
      ? legacyData
      : typeof legacyData === 'string'
        ? JSON.parse(legacyData)
        : [];
    if (templates.length === 0) return [];

    await client.query('BEGIN');
    for (const template of templates) {
      await upsertTemplate(client, template);
    }
    await client.query("DELETE FROM public.system_settings WHERE key = 'certificate_templates'");
    const migratedTemplates = await readStoredTemplates(client);
    await client.query('COMMIT');
    return migratedTemplates;
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch { /* transaction may not have started */ }
    throw error;
  } finally {
    client.release();
  }
}

async function upsertTemplate(client: PoolClient, template: CertificateTemplate): Promise<void> {
  if (!template.id || !template.name || typeof template.bodyTemplate !== 'string' || !template.bodyTemplate.trim()) {
    throw new Error('Each certificate template requires an id, name, and body.');
  }
  const snapshot = { ...template, updatedAt: new Date().toISOString() };
  const barangayName = typeof template.barangay === 'string' ? template.barangay.trim() : '';
  const barangayResult = barangayName && barangayName.toLowerCase() !== 'all'
    ? await client.query(
      'SELECT id FROM public.barangays WHERE lower(name) = lower($1) LIMIT 1',
      [barangayName]
    )
    : null;
  if (barangayName && barangayName.toLowerCase() !== 'all' && !barangayResult?.rows[0]?.id) {
    throw new Error(`No database barangay matches the template scope "${barangayName}".`);
  }
  const barangayId = !barangayName
    ? template.barangayId || null
    : barangayName.toLowerCase() === 'all'
      ? null
      : barangayResult?.rows[0]?.id || null;
  await client.query(
    `INSERT INTO public.certificate_templates
      (barangay_id, code, name, template_body, template_data, is_active, is_archived, updated_at)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6, FALSE, NOW())
     ON CONFLICT (code) DO UPDATE SET
       barangay_id = EXCLUDED.barangay_id,
       name = EXCLUDED.name,
       template_body = EXCLUDED.template_body,
       template_data = EXCLUDED.template_data,
       is_active = EXCLUDED.is_active,
       is_archived = FALSE,
       updated_at = NOW()`,
    [barangayId, template.id, template.name, template.bodyTemplate, JSON.stringify(snapshot), template.isActive !== false]
  );
}

export async function saveCertificateTemplates(templates: CertificateTemplate[]): Promise<CertificateTemplate[]> {
  if (!Array.isArray(templates)) throw new Error('Certificate templates must be an array.');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const template of templates) await upsertTemplate(client, template);
    const activeIds = templates.map(template => template.id);
    await client.query(
      'UPDATE public.certificate_templates SET is_active = FALSE, updated_at = NOW() WHERE is_archived = FALSE AND NOT (code = ANY($1::text[]))',
      [activeIds]
    );
    const savedTemplates = await readStoredTemplates(client);
    await client.query('COMMIT');
    return savedTemplates;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
