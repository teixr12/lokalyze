import { createClient } from '@supabase/supabase-js';
import type { Project } from './types';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || '';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

export const isSupabaseConfigured = !!(supabaseUrl && supabaseAnonKey);

export const supabase = isSupabaseConfigured
    ? createClient(supabaseUrl, supabaseAnonKey)
    : null;

// --- CLOUD DB ADAPTER (SUPABASE) ---
export const cloudHelper = {
    getAll: async (userId: string): Promise<Project[]> => {
        if (!supabase || !userId) return [];
        try {
            const { data, error } = await supabase
                .from('projects')
                .select('*')
                .eq('user_id', userId)
                .order('created_at', { ascending: false });
            if (error) throw error;
            // Map snake_case columns back to camelCase
            return (data || []).map(row => ({
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
            })) as Project[];
        } catch (e) {
            console.error('[Supabase] getAll failed', e);
            return [];
        }
    },

    save: async (project: Project, userId: string): Promise<void> => {
        if (!supabase || !userId) return;
        try {
            const { error } = await supabase.from('projects').upsert({
                id: project.id,
                user_id: userId,
                name: project.name,
                created_at: project.createdAt,
                last_modified: project.lastModified,
                source_html: project.sourceHtml,
                global_css: project.globalCss,
                detected_images: project.detectedImages,
                detected_iframes: project.detectedIframes || [],
                jobs: project.jobs,
                selected_langs: project.selectedLangs,
            });
            if (error) throw error;
        } catch (e) {
            console.error('[Supabase] save failed', e);
        }
    },

    delete: async (id: string, userId: string): Promise<void> => {
        if (!supabase || !userId) return;
        try {
            const { error } = await supabase
                .from('projects')
                .delete()
                .eq('id', id)
                .eq('user_id', userId);
            if (error) throw error;
        } catch (e) {
            console.error('[Supabase] delete failed', e);
        }
    },
};
