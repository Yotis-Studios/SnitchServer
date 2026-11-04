const crypto = require('crypto');

// Staff sign-in through Yotis Online. The dashboard sends the browser to the site's /staff page;
// the account API mints a token for this service (its "aud") and sends the browser back to the
// registered callback with it. The token is checked here against the account API's public keys,
// so this server holds no secret for it and cannot mint one. Copied from yo-account-api's
// lib/staffTokens.js verify(), which is kept dependency-free for exactly this.
const ISSUER = 'yotisonline';

function verify(token, jwks, audience, now = Math.floor(Date.now() / 1000)) {
    const parts = typeof token === 'string' ? token.split('.') : [];
    if (parts.length !== 3) throw new Error('Malformed token');
    const header = JSON.parse(Buffer.from(parts[0], 'base64url'));
    const key = header.alg === 'EdDSA' && jwks.keys.find((k) => k.kid === header.kid && k.crv === 'Ed25519');
    if (!key) throw Object.assign(new Error('Unknown key'), { unknownKey: true });
    const publicKey = crypto.createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: key.x }, format: 'jwk' });
    if (!crypto.verify(null, Buffer.from(parts[0] + '.' + parts[1]), publicKey, Buffer.from(parts[2], 'base64url'))) throw new Error('Bad signature');
    const claims = JSON.parse(Buffer.from(parts[1], 'base64url'));
    if (claims.iss !== ISSUER || claims.kind !== 'staff' || typeof claims.sub !== 'string' || !(claims.exp > now)) throw new Error('Expired or foreign token');
    if (claims.aud !== audience) throw new Error('Token for another service');
    return claims;
}

// The keys, fetched when first needed and again when a token names a key we do not have (the
// account API rotated), at most once a minute so a stream of junk tokens cannot make this
// server hammer the account API.
function createVerifier({ jwksUrl, service, fetchJwks }) {
    const get = fetchJwks || (async () => {
        const res = await fetch(jwksUrl, { signal: AbortSignal.timeout(5000) });
        if (!res.ok) throw new Error(`staff JWKS answered ${res.status}`);
        return res.json();
    });
    let jwks = null;
    let fetchedAt = 0;
    async function refresh() {
        if (Date.now() - fetchedAt < 60000 && jwks) return false;
        fetchedAt = Date.now();
        jwks = await get();
        return true;
    }
    return async function check(token) {
        if (!jwks) await refresh();
        try {
            return verify(token, jwks, service);
        } catch (err) {
            if (err.unknownKey && await refresh()) return verify(token, jwks, service);
            throw err;
        }
    };
}

module.exports = { verify, createVerifier };
