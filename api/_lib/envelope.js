const randomId = () => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `req_${Math.random().toString(36).slice(2, 10)}`;
};

export const json = (res, statusCode, payload) => {
  res.status(statusCode).setHeader('Content-Type', 'application/json; charset=utf-8');
  res.send(JSON.stringify(payload));
};

export const okEnvelope = (data, source = 'proxy') => ({
  data,
  source,
  requestId: randomId(),
});

export const errorEnvelope = (error) => ({
  error,
  requestId: randomId(),
});

export const parseJsonBody = (req) => {
  if (!req?.body) return {};
  if (typeof req.body === 'string') {
    try {
      return JSON.parse(req.body);
    } catch {
      return {};
    }
  }
  return req.body;
};

