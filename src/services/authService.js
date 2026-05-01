/**
 * authService.js
 * Verifies Supabase JWTs issued by the client-side Supabase auth library.
 * Uses the ANON key (not the service key) so RLS is still enforced on the anon client.
 * The verification call reaches Supabase's auth server to validate the token.
 */
const { createClient } = require('@supabase/supabase-js');

// Separate client using the ANON key — used only for JWT verification.
// This does NOT bypass Row Level Security.
const anonClient = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_ANON_KEY
);

/**
 * Verifies a Supabase access token (JWT) and returns the user object.
 * @param {string} token - The Bearer token from the Authorization header
 * @returns {Promise<object|null>} - Supabase user object, or null if invalid/expired
 */
async function verifySupabaseJwt(token) {
    if (!token) return null;
    try {
        const { data, error } = await anonClient.auth.getUser(token);
        if (error || !data?.user) {
            // Token is expired, malformed, or revoked — not an unexpected server error
            return null;
        }
        return data.user;
    } catch (err) {
        console.error('[AUTH] JWT verification threw unexpectedly:', err.message);
        return null;
    }
}

module.exports = { verifySupabaseJwt };
