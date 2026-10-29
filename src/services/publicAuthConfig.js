function publicAuthConfig(env = process.env) {
    const url = String(env.SUPABASE_URL || '').trim();
    const key = String(env.SUPABASE_PUBLISHABLE_KEY || env.SUPABASE_ANON_KEY || '').trim();
    let isPublic = key.startsWith('sb_publishable_');
    if (!isPublic) {
        try { isPublic = JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString()).role === 'anon'; } catch {}
    }
    if (!/^https:\/\//.test(url) || !isPublic) throw new Error('Public authentication settings are unavailable.');
    return { supabaseUrl: url.replace(/\/$/, ''), supabaseKey: key };
}
module.exports = { publicAuthConfig };
