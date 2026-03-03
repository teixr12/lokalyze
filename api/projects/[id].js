import { errorEnvelope, json, okEnvelope, parseJsonBody } from '../_lib/envelope.js';
import { verifyAuthHeader } from '../_lib/firebaseAdmin.js';
import { getSupabaseAdmin } from '../_lib/supabaseAdmin.js';
import { toProject, toRow } from '../_lib/projectsRepo.js';

const methodNotAllowed = (res) => {
  json(res, 405, errorEnvelope('Method not allowed'));
};

const getProjectId = (req) => {
  const idFromQuery = req.query?.id;
  if (typeof idFromQuery === 'string') return idFromQuery;
  if (Array.isArray(idFromQuery) && idFromQuery[0]) return idFromQuery[0];
  return '';
};

export default async function handler(req, res) {
  if (req.method !== 'PATCH' && req.method !== 'DELETE' && req.method !== 'GET') {
    return methodNotAllowed(res);
  }

  try {
    const decoded = await verifyAuthHeader(req.headers.authorization || '');
    const userId = decoded.uid;
    const projectId = getProjectId(req);
    if (!projectId) {
      return json(res, 400, errorEnvelope('Missing project id'));
    }

    const supabase = getSupabaseAdmin();

    if (req.method === 'GET') {
      const { data, error } = await supabase
        .from('projects')
        .select('*')
        .eq('id', projectId)
        .eq('user_id', userId)
        .maybeSingle();
      if (error) throw error;
      if (!data) return json(res, 404, errorEnvelope('Project not found'));
      return json(res, 200, okEnvelope(toProject(data), 'proxy'));
    }

    if (req.method === 'PATCH') {
      const body = parseJsonBody(req);
      const project = body.project || body;
      if (!project || typeof project !== 'object') {
        return json(res, 400, errorEnvelope('Missing project payload'));
      }

      const row = toRow({ ...project, id: projectId }, userId);
      const { data, error } = await supabase
        .from('projects')
        .upsert(row)
        .select('*')
        .single();

      if (error) throw error;
      return json(res, 200, okEnvelope(toProject(data), 'proxy'));
    }

    const { error } = await supabase
      .from('projects')
      .delete()
      .eq('id', projectId)
      .eq('user_id', userId);

    if (error) throw error;
    return json(res, 200, okEnvelope({ deleted: true }, 'proxy'));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Proxy projects request failed';
    const status = message.toLowerCase().includes('unauthorized') ? 401 : 500;
    return json(res, status, errorEnvelope(message));
  }
}

