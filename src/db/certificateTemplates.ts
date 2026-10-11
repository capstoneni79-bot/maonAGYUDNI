import { pool } from './index.ts';
import { CertificateTemplate } from '../types.ts';

interface CertificateTemplateRow {
  code: string;
  name: string;
  template_body: string;
  template_data: unknown;
  is_active: boolean;
  updated_at: Date | string | null;
  barangay_id: string | null;
  barangay_name: string | null;
}

function isTemplatePayload(value: unknown): value is CertificateTemplate {
  if (!value || typeof value !== 'object') return false;
  const template = value as Partial<CertificateTemplate>;
  return Boolean(
    template.header &&
    Array.isArray(template.logos) &&
    template.watermark &&
    typeof template.bodyTemplate === 'string' &&
    Array.isArray(template.signatories) &&
    template.receipt
  );
}

const mapTemplate = (row: CertificateTemplateRow): CertificateTemplate => {
  const parsedData: unknown = typeof row.template_data === 'string'
    ? JSON.parse(row.template_data)
    : row.template_data;
  if (!isTemplatePayload(parsedData)) {
    throw new Error(`Saved certificate template "${row.code}" has an incomplete configuration.`);
  }
  return {
    ...parsedData,
    id: row.code,
    name: row.name,
    barangay: row.barangay_id
      ? row.barangay_name || parsedData.barangay || ''
      : parsedData.barangay || 'All',
    barangayId: row.barangay_id || undefined,
    bodyTemplate: row.template_body,
    isActive: row.is_active,
    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : undefined,
  } as CertificateTemplate;
};

export async function getCertificateTemplates(): Promise<CertificateTemplate[]> {
  const client = await pool.connect();
  try {
    const result = await client.query(
      `SELECT ct.code, ct.name, ct.template_body, ct.template_data, ct.is_active, ct.updated_at,
              ct.barangay_id, b.name AS barangay_name
       FROM public.certificate_templates ct
       LEFT JOIN public.barangays b ON b.id = ct.barangay_id
       WHERE ct.is_archived = FALSE
       ORDER BY ct.name`
    );
    if (result.rows.length > 0) return result.rows.map(mapTemplate);

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
    await client.query('COMMIT');
    return templates;
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch { /* transaction may not have started */ }
    throw error;
  } finally {
    client.release();
  }
}

async function upsertTemplate(client: any, template: CertificateTemplate): Promise<void> {
  if (!template.id || !template.name || typeof template.bodyTemplate !== 'string') {
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
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
  return getCertificateTemplates();
}
