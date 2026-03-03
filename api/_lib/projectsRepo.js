const nowMs = () => Date.now();

export const toProject = (row) => ({
  id: row.id,
  name: row.name,
  createdAt: row.created_at,
  lastModified: row.last_modified,
  sourceHtml: row.source_html,
  globalCss: row.global_css,
  detectedImages: row.detected_images || [],
  detectedIframes: row.detected_iframes || [],
  jobs: row.jobs || {},
  selectedLangs: row.selected_langs || [],
});

export const toRow = (project, userId) => {
  const createdAt = Number(project.createdAt) || nowMs();
  const lastModified = Number(project.lastModified) || nowMs();

  return {
    id: String(project.id || ''),
    user_id: userId,
    name: String(project.name || 'Untitled'),
    created_at: createdAt,
    last_modified: lastModified,
    source_html: String(project.sourceHtml || ''),
    global_css: String(project.globalCss || ''),
    detected_images: Array.isArray(project.detectedImages) ? project.detectedImages : [],
    detected_iframes: Array.isArray(project.detectedIframes) ? project.detectedIframes : [],
    jobs: project.jobs && typeof project.jobs === 'object' ? project.jobs : {},
    selected_langs: Array.isArray(project.selectedLangs) ? project.selectedLangs : [],
  };
};

