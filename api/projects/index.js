import { errorEnvelope, json, okEnvelope, parseJsonBody } from '../_lib/envelope.js';
import { verifyAuthHeader } from '../_lib/firebaseAdmin.js';
import { getSupabaseAdmin } from '../_lib/supabaseAdmin.js';
import { toProject, toRow } from '../_lib/projectsRepo.js';

const methodNotAllowed = (res) => {
  json(res, 405, errorEnvelope('Method not allowed'));
};

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return methodNotAllowed(res);
  }

  try {
    const decoded = await verifyAuthHeader(req.headers.authorization || '');
    const userId = decoded.uid;
    const supabase = getSupabaseAdmin();

    if (req.method === 'GET') {
      const { data, error } = await supabase
        .from('projects')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false });

      if (error) throw error;
      return json(res, 200, okEnvelope((data || []).map(toProject), 'proxy'));
    }

    const body = parseJsonBody(req);
    const project = body.project || body;
    if (!project || typeof project !== 'object') {
      return json(res, 400, errorEnvelope('Missing project payload'));
    }

    const row = toRow(project, userId);
    const { data, error } = await supabase
      .from('projects')
      .upsert(row)
      .select('*')
      .single();

    if (error) throw error;
    return json(res, 200, okEnvelope(toProject(data), 'proxy'));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Proxy projects request failed';
    const status = message.toLowerCase().includes('unauthorized') ? 401 : 500;
    return json(res, status, errorEnvelope(message));
  }
}

