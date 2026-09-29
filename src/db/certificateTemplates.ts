import { pool } from './index.ts';
import { CertificateTemplate } from '../types.ts';

const mapTemplate = (row: any): CertificateTemplate => ({
  ...(typeof row.template_data === 'string' ? JSON.parse(row.template_data) : row.template_data || {}),
  id: row.code,
  name: row.name,
  bodyTemplate: row.template_body,
  isActive: row.is_active,
  updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : undefined,
});

export async function getCertificateTemplates(): Promise<CertificateTemplate[]> {
  const client = await pool.connect();
  try {
    const result = await client.query(
      'SELECT code, name, template_body, template_data, is_active, updated_at FROM public.certificate_templates WHERE is_archived = FALSE ORDER BY name'
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
  await client.query(
    `INSERT INTO public.certificate_templates
      (code, name, template_body, template_data, is_active, is_archived, updated_at)
     VALUES ($1, $2, $3, $4::jsonb, $5, FALSE, NOW())
     ON CONFLICT (code) DO UPDATE SET
       name = EXCLUDED.name,
       template_body = EXCLUDED.template_body,
       template_data = EXCLUDED.template_data,
       is_active = EXCLUDED.is_active,
       is_archived = FALSE,
       updated_at = NOW()`,
    [template.id, template.name, template.bodyTemplate, JSON.stringify(snapshot), template.isActive !== false]
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
