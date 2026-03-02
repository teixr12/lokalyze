// --- CONFIGURATION & CONSTANTS ---

export const LANGUAGES = [
    "English", "Spanish", "French", "German", "Chinese (Simplified)",
    "Chinese (Traditional)", "Japanese", "Korean", "Portuguese", "Italian",
    "Russian", "Arabic", "Hindi", "Turkish", "Dutch", "Polish", "Vietnamese",
    "Thai", "Indonesian", "Swedish", "Danish", "Finnish", "Norwegian",
    "Greek", "Czech", "Romanian", "Ukrainian", "Hebrew", "Malay"
];

export const MAX_CONCURRENT_JOBS = 5;

export const KEYS = {
    HTML: 'lokalyze_source_html',
    CSS: 'lokalyze_global_css',
    JOBS: 'lokalyze_jobs_history',
    ASSETS: 'lokalyze_asset_map',
    IFRAMES: 'lokalyze_iframe_map',
    SOUND: 'lokalyze_sound_enabled'
};

export const DB_CONFIG = {
    NAME: 'LOKALYZE_DB',
    VERSION: 1,
    STORE: 'projects'
};
