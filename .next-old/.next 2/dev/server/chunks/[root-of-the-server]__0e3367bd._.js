module.exports = [
"[externals]/next/dist/compiled/next-server/app-route-turbo.runtime.dev.js [external] (next/dist/compiled/next-server/app-route-turbo.runtime.dev.js, cjs)", ((__turbopack_context__, module, exports) => {

const mod = __turbopack_context__.x("next/dist/compiled/next-server/app-route-turbo.runtime.dev.js", () => require("next/dist/compiled/next-server/app-route-turbo.runtime.dev.js"));

module.exports = mod;
}),
"[externals]/next/dist/compiled/next-server/app-page-turbo.runtime.dev.js [external] (next/dist/compiled/next-server/app-page-turbo.runtime.dev.js, cjs)", ((__turbopack_context__, module, exports) => {

const mod = __turbopack_context__.x("next/dist/compiled/next-server/app-page-turbo.runtime.dev.js", () => require("next/dist/compiled/next-server/app-page-turbo.runtime.dev.js"));

module.exports = mod;
}),
"[externals]/next/dist/server/app-render/work-unit-async-storage.external.js [external] (next/dist/server/app-render/work-unit-async-storage.external.js, cjs)", ((__turbopack_context__, module, exports) => {

const mod = __turbopack_context__.x("next/dist/server/app-render/work-unit-async-storage.external.js", () => require("next/dist/server/app-render/work-unit-async-storage.external.js"));

module.exports = mod;
}),
"[externals]/next/dist/server/app-render/work-async-storage.external.js [external] (next/dist/server/app-render/work-async-storage.external.js, cjs)", ((__turbopack_context__, module, exports) => {

const mod = __turbopack_context__.x("next/dist/server/app-render/work-async-storage.external.js", () => require("next/dist/server/app-render/work-async-storage.external.js"));

module.exports = mod;
}),
"[externals]/next/dist/shared/lib/no-fallback-error.external.js [external] (next/dist/shared/lib/no-fallback-error.external.js, cjs)", ((__turbopack_context__, module, exports) => {

const mod = __turbopack_context__.x("next/dist/shared/lib/no-fallback-error.external.js", () => require("next/dist/shared/lib/no-fallback-error.external.js"));

module.exports = mod;
}),
"[externals]/next/dist/server/app-render/after-task-async-storage.external.js [external] (next/dist/server/app-render/after-task-async-storage.external.js, cjs)", ((__turbopack_context__, module, exports) => {

const mod = __turbopack_context__.x("next/dist/server/app-render/after-task-async-storage.external.js", () => require("next/dist/server/app-render/after-task-async-storage.external.js"));

module.exports = mod;
}),
"[externals]/crypto [external] (crypto, cjs)", ((__turbopack_context__, module, exports) => {

const mod = __turbopack_context__.x("crypto", () => require("crypto"));

module.exports = mod;
}),
"[project]/src/lib/wardrobe-hash.ts [app-route] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "computeWardrobeHash",
    ()=>computeWardrobeHash
]);
var __TURBOPACK__imported__module__$5b$externals$5d2f$crypto__$5b$external$5d$__$28$crypto$2c$__cjs$29$__ = __turbopack_context__.i("[externals]/crypto [external] (crypto, cjs)");
;
function computeWardrobeHash(wardrobeItemIds) {
    const sorted = Object.fromEntries(Object.entries(wardrobeItemIds).filter(([, v])=>v).sort(([a], [b])=>a.localeCompare(b)));
    return __TURBOPACK__imported__module__$5b$externals$5d2f$crypto__$5b$external$5d$__$28$crypto$2c$__cjs$29$__["default"].createHash('md5').update(JSON.stringify(sorted)).digest('hex').substring(0, 12);
}
}),
"[externals]/stream [external] (stream, cjs)", ((__turbopack_context__, module, exports) => {

const mod = __turbopack_context__.x("stream", () => require("stream"));

module.exports = mod;
}),
"[externals]/url [external] (url, cjs)", ((__turbopack_context__, module, exports) => {

const mod = __turbopack_context__.x("url", () => require("url"));

module.exports = mod;
}),
"[externals]/util [external] (util, cjs)", ((__turbopack_context__, module, exports) => {

const mod = __turbopack_context__.x("util", () => require("util"));

module.exports = mod;
}),
"[externals]/events [external] (events, cjs)", ((__turbopack_context__, module, exports) => {

const mod = __turbopack_context__.x("events", () => require("events"));

module.exports = mod;
}),
"[externals]/querystring [external] (querystring, cjs)", ((__turbopack_context__, module, exports) => {

const mod = __turbopack_context__.x("querystring", () => require("querystring"));

module.exports = mod;
}),
"[externals]/child_process [external] (child_process, cjs)", ((__turbopack_context__, module, exports) => {

const mod = __turbopack_context__.x("child_process", () => require("child_process"));

module.exports = mod;
}),
"[externals]/fs [external] (fs, cjs)", ((__turbopack_context__, module, exports) => {

const mod = __turbopack_context__.x("fs", () => require("fs"));

module.exports = mod;
}),
"[externals]/https [external] (https, cjs)", ((__turbopack_context__, module, exports) => {

const mod = __turbopack_context__.x("https", () => require("https"));

module.exports = mod;
}),
"[externals]/os [external] (os, cjs)", ((__turbopack_context__, module, exports) => {

const mod = __turbopack_context__.x("os", () => require("os"));

module.exports = mod;
}),
"[externals]/process [external] (process, cjs)", ((__turbopack_context__, module, exports) => {

const mod = __turbopack_context__.x("process", () => require("process"));

module.exports = mod;
}),
"[externals]/path [external] (path, cjs)", ((__turbopack_context__, module, exports) => {

const mod = __turbopack_context__.x("path", () => require("path"));

module.exports = mod;
}),
"[externals]/buffer [external] (buffer, cjs)", ((__turbopack_context__, module, exports) => {

const mod = __turbopack_context__.x("buffer", () => require("buffer"));

module.exports = mod;
}),
"[externals]/http [external] (http, cjs)", ((__turbopack_context__, module, exports) => {

const mod = __turbopack_context__.x("http", () => require("http"));

module.exports = mod;
}),
"[externals]/tls [external] (tls, cjs)", ((__turbopack_context__, module, exports) => {

const mod = __turbopack_context__.x("tls", () => require("tls"));

module.exports = mod;
}),
"[externals]/net [external] (net, cjs)", ((__turbopack_context__, module, exports) => {

const mod = __turbopack_context__.x("net", () => require("net"));

module.exports = mod;
}),
"[externals]/zlib [external] (zlib, cjs)", ((__turbopack_context__, module, exports) => {

const mod = __turbopack_context__.x("zlib", () => require("zlib"));

module.exports = mod;
}),
"[externals]/http2 [external] (http2, cjs)", ((__turbopack_context__, module, exports) => {

const mod = __turbopack_context__.x("http2", () => require("http2"));

module.exports = mod;
}),
"[externals]/dns [external] (dns, cjs)", ((__turbopack_context__, module, exports) => {

const mod = __turbopack_context__.x("dns", () => require("dns"));

module.exports = mod;
}),
"[externals]/assert [external] (assert, cjs)", ((__turbopack_context__, module, exports) => {

const mod = __turbopack_context__.x("assert", () => require("assert"));

module.exports = mod;
}),
"[project]/src/lib/firestore.ts [app-route] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "addTrustedBrowser",
    ()=>addTrustedBrowser,
    "archiveJob",
    ()=>archiveJob,
    "createDressedBase",
    ()=>createDressedBase,
    "createJob",
    ()=>createJob,
    "createModel",
    ()=>createModel,
    "createShot",
    ()=>createShot,
    "createUser",
    ()=>createUser,
    "createWardrobeItem",
    ()=>createWardrobeItem,
    "db",
    ()=>db,
    "default",
    ()=>__TURBOPACK__default__export__,
    "deleteDressedBase",
    ()=>deleteDressedBase,
    "deleteWardrobeItem",
    ()=>deleteWardrobeItem,
    "dressedBasesCol",
    ()=>dressedBasesCol,
    "findDressedBase",
    ()=>findDressedBase,
    "getDressedBaseViews",
    ()=>getDressedBaseViews,
    "getJob",
    ()=>getJob,
    "getModel",
    ()=>getModel,
    "getUser",
    ()=>getUser,
    "getWardrobeItem",
    ()=>getWardrobeItem,
    "jobsCol",
    ()=>jobsCol,
    "listDressedBases",
    ()=>listDressedBases,
    "listJobs",
    ()=>listJobs,
    "listModels",
    ()=>listModels,
    "listShots",
    ()=>listShots,
    "listUsers",
    ()=>listUsers,
    "listWardrobeItems",
    ()=>listWardrobeItems,
    "logModification",
    ()=>logModification,
    "modelsCol",
    ()=>modelsCol,
    "modificationsCol",
    ()=>modificationsCol,
    "otpCol",
    ()=>otpCol,
    "promptAdjustmentsCol",
    ()=>promptAdjustmentsCol,
    "setUserPassword",
    ()=>setUserPassword,
    "shotsCol",
    ()=>shotsCol,
    "storeOTP",
    ()=>storeOTP,
    "updateJobStatus",
    ()=>updateJobStatus,
    "updateLastLogin",
    ()=>updateLastLogin,
    "updateShot",
    ()=>updateShot,
    "updateUser",
    ()=>updateUser,
    "userHasPassword",
    ()=>userHasPassword,
    "usersCol",
    ()=>usersCol,
    "verifyOTP",
    ()=>verifyOTP,
    "verifyUserPassword",
    ()=>verifyUserPassword,
    "wardrobeCol",
    ()=>wardrobeCol
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$google$2d$cloud$2f$firestore$2f$build$2f$src$2f$index$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/@google-cloud/firestore/build/src/index.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$externals$5d2f$crypto__$5b$external$5d$__$28$crypto$2c$__cjs$29$__ = __turbopack_context__.i("[externals]/crypto [external] (crypto, cjs)");
;
;
const db = new __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$google$2d$cloud$2f$firestore$2f$build$2f$src$2f$index$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["Firestore"]({
    projectId: process.env.FIRESTORE_PROJECT_ID || process.env.GCP_PROJECT_ID
});
const usersCol = db.collection('users');
const modelsCol = db.collection('models');
const jobsCol = db.collection('jobs');
const shotsCol = db.collection('shots');
const modificationsCol = db.collection('modifications');
const promptAdjustmentsCol = db.collection('promptAdjustments');
const otpCol = db.collection('otpCodes');
const wardrobeCol = db.collection('wardrobe');
async function getUser(email) {
    const doc = await usersCol.doc(email).get();
    return doc.exists ? {
        email,
        ...doc.data()
    } : null;
}
async function createUser(email, data) {
    await usersCol.doc(email).set({
        ...data,
        createdAt: new Date(),
        lastLogin: new Date(),
        trustedBrowsers: [],
        active: true
    });
}
async function updateLastLogin(email) {
    await usersCol.doc(email).update({
        lastLogin: new Date()
    });
}
async function addTrustedBrowser(email, browserHash) {
    await usersCol.doc(email).update({
        trustedBrowsers: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$google$2d$cloud$2f$firestore$2f$build$2f$src$2f$index$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["FieldValue"].arrayUnion(browserHash)
    });
}
async function listUsers() {
    const snap = await usersCol.orderBy('createdAt', 'desc').get();
    return snap.docs.map((d)=>({
            email: d.id,
            ...d.data()
        }));
}
async function updateUser(email, data) {
    await usersCol.doc(email).update(data);
}
// ── Password operations ──
function hashPassword(password, salt) {
    return new Promise((resolve, reject)=>{
        __TURBOPACK__imported__module__$5b$externals$5d2f$crypto__$5b$external$5d$__$28$crypto$2c$__cjs$29$__["default"].scrypt(password, salt, 64, (err, key)=>{
            if (err) reject(err);
            resolve(key.toString('hex'));
        });
    });
}
async function setUserPassword(email, password) {
    const salt = __TURBOPACK__imported__module__$5b$externals$5d2f$crypto__$5b$external$5d$__$28$crypto$2c$__cjs$29$__["default"].randomBytes(16).toString('hex');
    const hash = await hashPassword(password, salt);
    await usersCol.doc(email).update({
        passwordHash: hash,
        passwordSalt: salt,
        passwordSetAt: new Date()
    });
}
async function verifyUserPassword(email, password) {
    const doc = await usersCol.doc(email).get();
    if (!doc.exists) return false;
    const data = doc.data();
    if (!data.passwordHash || !data.passwordSalt) return false;
    const hash = await hashPassword(password, data.passwordSalt);
    return hash === data.passwordHash;
}
async function userHasPassword(email) {
    const doc = await usersCol.doc(email).get();
    if (!doc.exists) return false;
    return !!doc.data()?.passwordHash;
}
async function storeOTP(email, code) {
    await otpCol.doc(email).set({
        code,
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 5 * 60 * 1000)
    });
}
async function verifyOTP(email, code) {
    const doc = await otpCol.doc(email).get();
    if (!doc.exists) return false;
    const data = doc.data();
    if (data.code !== code) return false;
    if (new Date() > data.expiresAt.toDate()) return false;
    // Delete after successful verification
    await otpCol.doc(email).delete();
    return true;
}
async function listModels(activeOnly = true) {
    const snap = activeOnly ? await modelsCol.where('active', '==', true).get() : await modelsCol.get();
    const models = snap.docs.map((d)=>({
            id: d.id,
            ...d.data()
        }));
    // Sort by modelId in memory to avoid composite index requirement
    return models.sort((a, b)=>(a.modelId || a.id).localeCompare(b.modelId || b.id));
}
async function getModel(modelId) {
    const doc = await modelsCol.doc(modelId).get();
    return doc.exists ? {
        id: doc.id,
        ...doc.data()
    } : null;
}
async function createModel(modelId, data) {
    await modelsCol.doc(modelId).set({
        modelId,
        ...data,
        active: true,
        createdAt: new Date()
    });
}
async function createJob(data) {
    const ref = jobsCol.doc();
    await ref.set({
        jobId: ref.id,
        ...data,
        status: 'uploading',
        createdAt: new Date(),
        updatedAt: new Date()
    });
    return ref.id;
}
async function getJob(jobId) {
    const doc = await jobsCol.doc(jobId).get();
    if (!doc.exists) return null;
    const data = doc.data();
    return {
        id: doc.id,
        ...data,
        createdAt: data.createdAt?.toDate?.() ? data.createdAt.toDate().toISOString() : data.createdAt,
        updatedAt: data.updatedAt?.toDate?.() ? data.updatedAt.toDate().toISOString() : data.updatedAt
    };
}
async function listJobs(creatorEmail) {
    let query = jobsCol.orderBy('createdAt', 'desc').limit(50);
    if (creatorEmail) query = query.where('creatorEmail', '==', creatorEmail);
    const snap = await query.get();
    return snap.docs.map((d)=>{
        const data = d.data();
        return {
            id: d.id,
            ...data,
            // Convert Firestore Timestamps to ISO strings for JSON serialization
            createdAt: data.createdAt?.toDate?.() ? data.createdAt.toDate().toISOString() : data.createdAt,
            updatedAt: data.updatedAt?.toDate?.() ? data.updatedAt.toDate().toISOString() : data.updatedAt
        };
    });
}
async function updateJobStatus(jobId, status) {
    await jobsCol.doc(jobId).update({
        status,
        updatedAt: new Date()
    });
}
async function archiveJob(jobId, archived = true) {
    await jobsCol.doc(jobId).update({
        archived,
        ...archived ? {
            archivedAt: new Date()
        } : {},
        updatedAt: new Date()
    });
}
async function createShot(data) {
    const ref = shotsCol.doc();
    await ref.set({
        shotId: ref.id,
        ...data,
        version: 1,
        status: 'queued',
        createdAt: new Date()
    });
    return ref.id;
}
async function listShots(jobId) {
    const snap = await shotsCol.where('jobId', '==', jobId).get();
    return snap.docs.map((d)=>{
        const data = d.data();
        return {
            id: d.id,
            ...data,
            createdAt: data.createdAt?.toDate?.() ? data.createdAt.toDate().toISOString() : data.createdAt
        };
    });
}
async function updateShot(shotId, data) {
    await shotsCol.doc(shotId).update(data);
}
async function logModification(data) {
    const ref = modificationsCol.doc();
    await ref.set({
        modificationId: ref.id,
        ...data,
        approved: false,
        createdAt: new Date()
    });
    return ref.id;
}
async function createWardrobeItem(data) {
    const ref = wardrobeCol.doc();
    // Default: shoes = styling item (false), everything else = focus garment (true)
    const isPrimary = data.isPrimary !== undefined ? data.isPrimary : data.category !== 'shoes';
    // Default gender: shoes = unisex, others = unisex if not specified
    const gender = data.gender || 'unisex';
    await ref.set({
        wardrobeId: ref.id,
        ...data,
        gender,
        isPrimary,
        createdAt: new Date(),
        updatedAt: new Date()
    });
    return ref.id;
}
async function listWardrobeItems(category) {
    let query = wardrobeCol;
    if (category) query = query.where('category', '==', category);
    const snap = await query.get();
    return snap.docs.map((d)=>{
        const data = d.data();
        return {
            id: d.id,
            ...data,
            createdAt: data.createdAt?.toDate?.() ? data.createdAt.toDate().toISOString() : data.createdAt,
            updatedAt: data.updatedAt?.toDate?.() ? data.updatedAt.toDate().toISOString() : data.updatedAt
        };
    });
}
async function getWardrobeItem(wardrobeId) {
    const doc = await wardrobeCol.doc(wardrobeId).get();
    if (!doc.exists) return null;
    const data = doc.data();
    return {
        id: doc.id,
        ...data,
        createdAt: data.createdAt?.toDate?.() ? data.createdAt.toDate().toISOString() : data.createdAt,
        updatedAt: data.updatedAt?.toDate?.() ? data.updatedAt.toDate().toISOString() : data.updatedAt
    };
}
async function deleteWardrobeItem(wardrobeId) {
    await wardrobeCol.doc(wardrobeId).delete();
}
const dressedBasesCol = db.collection('dressedBases');
async function createDressedBase(data) {
    const docId = `${data.modelId}_${data.wardrobeHash}_${data.view}`;
    await dressedBasesCol.doc(docId).set({
        ...data,
        createdAt: new Date(),
        updatedAt: new Date()
    });
    return docId;
}
async function findDressedBase(modelId, wardrobeHash, view = 'front') {
    const docId = `${modelId}_${wardrobeHash}_${view}`;
    const doc = await dressedBasesCol.doc(docId).get();
    if (!doc.exists) return null;
    const data = doc.data();
    return {
        id: doc.id,
        ...data,
        createdAt: data.createdAt?.toDate?.() ? data.createdAt.toDate().toISOString() : data.createdAt
    };
}
async function getDressedBaseViews(modelId, wardrobeHash) {
    const snap = await dressedBasesCol.where('modelId', '==', modelId).where('wardrobeHash', '==', wardrobeHash).get();
    return snap.docs.map((d)=>{
        const data = d.data();
        return {
            id: d.id,
            ...data,
            createdAt: data.createdAt?.toDate?.() ? data.createdAt.toDate().toISOString() : data.createdAt
        };
    });
}
async function listDressedBases(modelId) {
    const snap = await dressedBasesCol.where('modelId', '==', modelId).get();
    return snap.docs.map((d)=>{
        const data = d.data();
        return {
            id: d.id,
            ...data,
            createdAt: data.createdAt?.toDate?.() ? data.createdAt.toDate().toISOString() : data.createdAt
        };
    }).sort((a, b)=>(b.createdAt || '').localeCompare(a.createdAt || ''));
}
async function deleteDressedBase(docId) {
    await dressedBasesCol.doc(docId).delete();
}
const __TURBOPACK__default__export__ = db;
}),
"[project]/src/lib/vertex.ts [app-route] (ecmascript)", ((__turbopack_context__) => {
"use strict";

/**
 * Vertex AI Gemini image generation client.
 * Generates model shots using gemini-3-pro-image-preview.
 *
 * Now supports multiple reference images:
 * - Garment flat image (primary visual reference)
 * - 360° garment angles (secondary references)
 * - Model card (identity reference)
 */ __turbopack_context__.s([
    "generateImage",
    ()=>generateImage,
    "generateModelCard",
    ()=>generateModelCard
]);
// Retry config for 429 rate limits — pro model needs more headroom
const MAX_RETRIES = 3;
const RETRY_DELAYS = [
    45000,
    60000,
    90000
]; // Backoff delays for rate limits (429) — increased for pro 4K
const NETWORK_RETRY_DELAYS = [
    10000,
    20000,
    30000
]; // Shorter delays for network errors (ECONNRESET etc.)
async function generateImage(params) {
    const { prompt, referenceImages, referenceImage, aspectRatio = '3:4', imageSize = '2K', model = 'gemini-3.1-flash-image-preview' } = params;
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error('GEMINI_API_KEY env var not set');
    // Build request parts — images first, then prompt text
    const parts = [];
    // NEW: Add multiple reference images with labels
    if (referenceImages?.length) {
        for (const ref of referenceImages){
            // Add the image
            parts.push({
                inlineData: {
                    mimeType: ref.mimeType,
                    data: ref.buffer.toString('base64')
                }
            });
            // Add its label/instruction
            parts.push({
                text: ref.label + '\n\n'
            });
        }
    } else if (referenceImage) {
        parts.push({
            inlineData: {
                mimeType: 'image/png',
                data: referenceImage.toString('base64')
            }
        });
        parts.push({
            text: 'This is the model identity reference photo. The person in the generated image MUST be this exact same person — same face, same features, same body type.\n\n'
        });
    }
    // Add the main prompt
    parts.push({
        text: prompt
    });
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
    // Retry loop for rate limits
    for(let attempt = 0; attempt <= MAX_RETRIES; attempt++){
        try {
            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    contents: [
                        {
                            role: "user",
                            parts
                        }
                    ],
                    generationConfig: {
                        responseModalities: [
                            'IMAGE'
                        ],
                        imageConfig: {
                            aspectRatio,
                            imageSize
                        }
                    }
                })
            });
            if (response.status === 429) {
                if (attempt < MAX_RETRIES) {
                    const delay = RETRY_DELAYS[attempt];
                    console.warn(`[Vertex] Rate limited (429), retrying in ${delay / 1000}s (attempt ${attempt + 1}/${MAX_RETRIES})`);
                    await new Promise((r)=>setTimeout(r, delay));
                    continue;
                }
                throw new Error(`Vertex AI rate limited (429) after ${MAX_RETRIES} retries`);
            }
            if (!response.ok) {
                const error = await response.text();
                throw new Error(`Vertex AI error ${response.status}: ${error}`);
            }
            const result = await response.json();
            // Extract image from response
            const candidate = result.candidates?.[0];
            if (!candidate?.content?.parts) {
                if (attempt < MAX_RETRIES) {
                    console.warn(`[Vertex] Empty response (safety filter?), retrying (attempt ${attempt + 1}/${MAX_RETRIES})`);
                    await new Promise((r)=>setTimeout(r, RETRY_DELAYS[attempt]));
                    continue;
                }
                throw new Error('No image generated — empty response after retries');
            }
            for (const part of candidate.content.parts){
                if (part.inlineData) {
                    return {
                        imageData: Buffer.from(part.inlineData.data, 'base64'),
                        mimeType: part.inlineData.mimeType || 'image/png'
                    };
                }
            }
            throw new Error('No image data in response');
        } catch (error) {
            const msg = error.message || '';
            const isRateLimit = msg.includes('429');
            const isNetworkError = msg.includes('ECONNRESET') || msg.includes('ETIMEDOUT') || msg.includes('ENOTFOUND') || msg.includes('fetch failed');
            if (attempt < MAX_RETRIES && (isRateLimit || isNetworkError)) {
                const delay = isRateLimit ? RETRY_DELAYS[attempt] : NETWORK_RETRY_DELAYS[attempt];
                console.warn(`[Vertex] ${isNetworkError ? 'Network error' : 'Rate limit'}, retrying in ${delay / 1000}s (attempt ${attempt + 1}/${MAX_RETRIES}): ${msg.substring(0, 120)}`);
                await new Promise((r)=>setTimeout(r, delay));
                continue;
            }
            throw error;
        }
    }
    throw new Error('Generation failed after all retries');
}
async function generateModelCard(description, gender) {
    const cleanDescription = description.replace(/^["']/, '').trim();
    // VERY short compression shorts — boxer-brief length, max 15cm inseam.
    // Must be shorter than cycling shorts to prevent legging bleed into denim generation.
    const baseLayerDesc = gender === 'male' ? `MANDATORY OUTFIT — EXACT SPECIFICATION:
- BOTTOM: Black compression BOXER BRIEFS — these are VERY SHORT underwear-style shorts. Maximum 15cm inseam. They end at UPPER THIGH, well above the knee. The KNEES, SHINS, and CALVES are completely BARE SKIN. Think men's boxer briefs or running shorts — NOT cycling shorts, NOT mid-thigh, NOT knee-length, NOT leggings.
- TOP: Plain white fitted crew-neck t-shirt with G-Star small logo on chest. No other branding.
- FEET: Barefoot on white studio floor.
CRITICAL: If the shorts extend past upper-thigh or reach the knee, you have FAILED. The legs below upper-thigh must be bare skin.` : `MANDATORY OUTFIT — EXACT SPECIFICATION:
- BOTTOM: Black compression BOXER BRIEFS — these are VERY SHORT underwear-style shorts. Maximum 15cm inseam. They end at UPPER THIGH, well above the knee. The KNEES, SHINS, and CALVES are completely BARE SKIN. Think boy-short underwear — NOT cycling shorts, NOT mid-thigh, NOT knee-length, NOT leggings.
- TOP: Plain white fitted tank top with thin shoulder straps and G-Star small logo. No other branding.
- FEET: Barefoot on white studio floor.
CRITICAL: If the shorts extend past upper-thigh or reach the knee, you have FAILED. The legs below upper-thigh must be bare skin.`;
    // Gender-aware ECOM posing
    const ecomPose = gender === 'female' ? 'Slight hip tilt, soft knee bend, weight on one leg — feminine and confident. One hand lightly at hip. NOT stiff military stance.' : 'Relaxed stance, slight weight shift. Arms relaxed at sides. NOT rigid or stiff.';
    // Random variation token ensures each regeneration produces a different result
    const variationSeed = Math.random().toString(36).substring(2, 8);
    const prompt = `Full-body fashion model reference photograph — ${variationSeed}

Subject: ${cleanDescription}

${baseLayerDesc}

PROPORTIONS — standard full-body fashion proportion. Complete body visible crown to heel. Head is one-eighth of total body height. Waistband sits at mid-body. Knees at three-quarter height. DO NOT render any text, numbers, labels, annotations, or percentage markers in the image — clean photograph only.

EXPRESSION (G-STAR ECOM STANDARD): FRIENDLY AND OPEN FACE. Chin slightly up. Eyes on camera. Relaxed, confident, approachable. NOT blank, NOT cold stare, NOT bored.

FRAME — complete full body:
  Top: small white margin above crown
  Head and face fully visible
  Full torso visible
  Full legs visible — BARE from upper thigh down
  Feet flat on white studio floor
  Bottom: white floor surface visible below feet

Camera: 85mm, 5 meters from subject. Complete body crown-to-heel in frame. NOT a portrait crop.
Studio: White seamless backdrop, white floor visible. LIGHTING: Warm directional studio light with subtle shadow contrast — NOT flat/clinical. Warmer skin tones.
Pose: ${ecomPose}
Photorealistic.`;
    try {
        const result = await generateImage({
            prompt,
            aspectRatio: '9:16',
            imageSize: '2K'
        });
        return result.imageData.toString('base64');
    } catch (error) {
        console.error('Error generating model card:', error);
        return null;
    }
}
/**
 * Get access token for Vertex AI API.
 * On Cloud Run: uses metadata server.
 * Locally: uses service account key.
 */ async function getAccessToken() {
    // Try Cloud Run metadata server first
    try {
        const resp = await fetch('http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token', {
            headers: {
                'Metadata-Flavor': 'Google'
            }
        });
        if (resp.ok) {
            const data = await resp.json();
            return data.access_token;
        }
    } catch  {
    // Not on Cloud Run — fall through to service account
    }
    // Fall back to service account key (local development)
    const keyPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
    if (!keyPath) {
        throw new Error('No GOOGLE_APPLICATION_CREDENTIALS set for local development');
    }
    const fs = await __turbopack_context__.A("[externals]/fs [external] (fs, cjs, async loader)");
    const crypto = await __turbopack_context__.A("[externals]/crypto [external] (crypto, cjs, async loader)");
    const key = JSON.parse(fs.readFileSync(keyPath, 'utf8'));
    // Create JWT
    const now = Math.floor(Date.now() / 1000);
    const header = {
        alg: 'RS256',
        typ: 'JWT'
    };
    const payload = {
        iss: key.client_email,
        scope: 'https://www.googleapis.com/auth/cloud-platform',
        aud: 'https://oauth2.googleapis.com/token',
        iat: now,
        exp: now + 3600
    };
    const encode = (obj)=>Buffer.from(JSON.stringify(obj)).toString('base64url');
    const unsigned = `${encode(header)}.${encode(payload)}`;
    const sign = crypto.createSign('RSA-SHA256');
    sign.update(unsigned);
    const signature = sign.sign(key.private_key, 'base64url');
    const jwt = `${unsigned}.${signature}`;
    // Exchange JWT for access token
    const tokenResp = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`
    });
    const tokenData = await tokenResp.json();
    return tokenData.access_token;
}
}),
"[externals]/tty [external] (tty, cjs)", ((__turbopack_context__, module, exports) => {

const mod = __turbopack_context__.x("tty", () => require("tty"));

module.exports = mod;
}),
"[externals]/punycode [external] (punycode, cjs)", ((__turbopack_context__, module, exports) => {

const mod = __turbopack_context__.x("punycode", () => require("punycode"));

module.exports = mod;
}),
"[externals]/node:events [external] (node:events, cjs)", ((__turbopack_context__, module, exports) => {

const mod = __turbopack_context__.x("node:events", () => require("node:events"));

module.exports = mod;
}),
"[externals]/node:process [external] (node:process, cjs)", ((__turbopack_context__, module, exports) => {

const mod = __turbopack_context__.x("node:process", () => require("node:process"));

module.exports = mod;
}),
"[externals]/node:util [external] (node:util, cjs)", ((__turbopack_context__, module, exports) => {

const mod = __turbopack_context__.x("node:util", () => require("node:util"));

module.exports = mod;
}),
"[project]/src/lib/gcs.ts [app-route] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "downloadGarmentImage",
    ()=>downloadGarmentImage,
    "list360Images",
    ()=>list360Images,
    "uploadDressedBaseImage",
    ()=>uploadDressedBaseImage,
    "uploadGarmentImage",
    ()=>uploadGarmentImage,
    "uploadGeneratedImage",
    ()=>uploadGeneratedImage,
    "uploadModelCardImage",
    ()=>uploadModelCardImage,
    "uploadWardrobeImage",
    ()=>uploadWardrobeImage
]);
/**
 * Google Cloud Storage client for garment images.
 * Stores input images (flat + 360°) in the gstar-ai-studio-assets bucket.
 */ var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$google$2d$cloud$2f$storage$2f$build$2f$esm$2f$src$2f$index$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__$3c$locals$3e$__ = __turbopack_context__.i("[project]/node_modules/@google-cloud/storage/build/esm/src/index.js [app-route] (ecmascript) <locals>");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$google$2d$cloud$2f$storage$2f$build$2f$esm$2f$src$2f$storage$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/@google-cloud/storage/build/esm/src/storage.js [app-route] (ecmascript)");
;
const BUCKET_NAME = 'gstar-ai-studio-assets';
let _storage = null;
function getStorage() {
    if (!_storage) {
        _storage = new __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$google$2d$cloud$2f$storage$2f$build$2f$esm$2f$src$2f$storage$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["Storage"]({
            projectId: process.env.GCP_PROJECT_ID
        });
    }
    return _storage;
}
async function uploadGarmentImage(designNumber, type, filename, imageBuffer, mimeType = 'image/jpeg') {
    const storage = getStorage();
    const bucket = storage.bucket(BUCKET_NAME);
    const gcsPath = `input/${designNumber}/${type}/${filename}`;
    const file = bucket.file(gcsPath);
    await file.save(imageBuffer, {
        metadata: {
            contentType: mimeType
        }
    });
    // Return the public URL (bucket has public read)
    return `https://storage.googleapis.com/${BUCKET_NAME}/${gcsPath}`;
}
async function downloadGarmentImage(url) {
    // URL format: https://storage.googleapis.com/BUCKET/path
    const gcsPath = url.replace(`https://storage.googleapis.com/${BUCKET_NAME}/`, '');
    const storage = getStorage();
    const bucket = storage.bucket(BUCKET_NAME);
    const file = bucket.file(gcsPath);
    const [buffer] = await file.download();
    return buffer;
}
async function uploadGeneratedImage(designNumber, filename, imageBuffer, mimeType = 'image/png') {
    const storage = getStorage();
    const bucket = storage.bucket(BUCKET_NAME);
    const gcsPath = `output/${designNumber}/${filename}`;
    const file = bucket.file(gcsPath);
    await file.save(imageBuffer, {
        metadata: {
            contentType: mimeType
        }
    });
    return `https://storage.googleapis.com/${BUCKET_NAME}/${gcsPath}`;
}
async function uploadModelCardImage(modelId, imageBuffer, mimeType = 'image/png') {
    const storage = getStorage();
    const bucket = storage.bucket(BUCKET_NAME);
    const gcsPath = `model-cards/${modelId}.png`;
    const file = bucket.file(gcsPath);
    await file.save(imageBuffer, {
        metadata: {
            contentType: mimeType,
            cacheControl: 'no-cache'
        }
    });
    return `https://storage.googleapis.com/${BUCKET_NAME}/${gcsPath}?v=${Date.now()}`;
}
async function uploadWardrobeImage(category, wardrobeId, filename, imageBuffer, mimeType = 'image/jpeg') {
    const storage = getStorage();
    const bucket = storage.bucket(BUCKET_NAME);
    const gcsPath = `wardrobe/${category}/${wardrobeId}/${filename}`;
    const file = bucket.file(gcsPath);
    await file.save(imageBuffer, {
        metadata: {
            contentType: mimeType
        }
    });
    return `https://storage.googleapis.com/${BUCKET_NAME}/${gcsPath}`;
}
async function uploadDressedBaseImage(modelId, hash, view, imageBuffer, mimeType = 'image/jpeg') {
    const storage = getStorage();
    const bucket = storage.bucket(BUCKET_NAME);
    const gcsPath = `dressed-bases/${modelId}_${hash}_${view}.jpg`;
    const file = bucket.file(gcsPath);
    await file.save(imageBuffer, {
        metadata: {
            contentType: mimeType
        }
    });
    return `https://storage.googleapis.com/${BUCKET_NAME}/${gcsPath}`;
}
async function list360Images(designNumber) {
    const storage = getStorage();
    const bucket = storage.bucket(BUCKET_NAME);
    const prefix = `input/${designNumber}/360/`;
    const [files] = await bucket.getFiles({
        prefix
    });
    return files.map((f)=>`https://storage.googleapis.com/${BUCKET_NAME}/${f.name}`);
}
}),
"[project]/src/lib/prompts.ts [app-route] (ecmascript)", ((__turbopack_context__) => {
"use strict";

// ── Prompt Templates for Generation ──
// Incorporates ALL 43 learnings from LEARNINGS.md
// Migrated from pipeline.py universal generation system
__turbopack_context__.s([
    "ANKLE_LENGTH_RULES",
    ()=>ANKLE_LENGTH_RULES,
    "ANTI_AI_RULES",
    ()=>ANTI_AI_RULES,
    "ANTI_HALLUCINATION",
    ()=>ANTI_HALLUCINATION,
    "BODY_SHAPE_RULES",
    ()=>BODY_SHAPE_RULES,
    "ECOM_NO_GOS",
    ()=>ECOM_NO_GOS,
    "FLOOR_LENGTH_RULES",
    ()=>FLOOR_LENGTH_RULES,
    "REF_LABELS",
    ()=>REF_LABELS,
    "ZONE_DEFS",
    ()=>ZONE_DEFS,
    "buildGenerationPrompt",
    ()=>buildGenerationPrompt,
    "buildLabelQCPrompt",
    ()=>buildLabelQCPrompt,
    "buildQCPrompt",
    ()=>buildQCPrompt,
    "getEcomFootwear",
    ()=>getEcomFootwear,
    "getEcomPosingRules",
    ()=>getEcomPosingRules,
    "getEcomStylingTop",
    ()=>getEcomStylingTop
]);
const ANTI_AI_RULES = `CRITICAL REALISM RULES — the model must look like a REAL person, NOT AI-generated:

ANATOMICAL PROPORTIONS — 8-head-unit system (classical standard, verified against anatomy chart):
The body is divided into 8 equal head-heights. All measurements below are % of total body height.

- HEAD: 12.5% of total height (1/8). Small. Crown to chin only. AI ALWAYS makes heads too large — actively SHRINK the head. If the head looks correct to you, make it 10% smaller. This is the #1 AI proportion failure.
- FEET (CRITICAL — #2 AI failure after heads): Natural human feet — same width as the ankle bone area. AI ALWAYS makes feet too large, especially with sandals and open-toe shoes.
  • Foot width MUST be ≤ ankle width. NEVER wider.
  • Shoe length = ~1.3 head-lengths maximum for women, ~1.5 for men.
  • SANDALS: The foot should NOT overhang the sandal edges. Toes do NOT spread wider than the sole.
  • The foot-to-calf ratio must look natural — if the foot looks even SLIGHTLY large, SHRINK it 15%.
  • DO NOT enlarge feet to "ground" the model. Feet are SMALL relative to the body.
  • If using a dressed base reference with oversized shoes/sandals, CORRECT the proportions — match real human anatomy, NOT the reference error.

- ARMS (most common AI failure — arms always too long):
  • Shoulder: 16.7% from top
  • Elbow: 37.5% from top — aligns with NATURAL WAIST (not the trouser/underwear waistband)
  • WRIST: 56.25% from top — at UPPER THIGH, halfway between crotch and mid-thigh
    → Wrist hangs ~1.5 head-heights below the underwear waistband
    → Wrist hangs ~0.5 head-heights below the crotch line
    → Wrist does NOT reach the knee (75%). If wrists are near the knee = arms too long by 2+ head-heights
  • Fingertips: 62.5% from top — MID-THIGH ONLY. Not knee, not below knee.
  • Total arm length (shoulder to fingertip) = 49% of total body height

- BODY MIDPOINT: The crotch (pubic area) falls at exactly 50% of total height — the exact center.
- WAIST (natural): 37.5% from top. The trouser/underwear waistband typically sits at ~43-44% (between waist and crotch).
- KNEES: 75% from top. Wrists must never reach this level.
- SHOULDERS: 2 head-widths wide (female), 2.5 (male). Natural, not football-player wide.
- LEGS: 50% of total height (crotch to heels).

IDENTITY — match the model card EXACTLY across ALL shots:
- HAIR: Same color, same length, same style as the model card. Do NOT change hair between shots.
- FACE: Same facial features, skin tone, face shape as the model card. One person, consistent.
- BODY TYPE: Same build, same proportions as shown in the model card.

REALISM:
- SKIN: Natural texture — visible pores, slight unevenness, natural shine. NOT airbrushed.
- EXPRESSION (G-STAR ECOM STANDARD — STRICT):
  • Relaxed, confident, with energy through the eyes. FRIENDLY AND OPEN FACE. Chin up.
  • ABSOLUTELY NO smile showing teeth. NO grinning. NO laughing. NO "happy girl next door" look.
  • Mouth: lips together, relaxed. A very subtle closed-mouth hint of warmth is OK — but NO open mouth, NO teeth visible.
  • Eyes: direct, confident, engaged. NOT bored, NOT blank, NOT aggressive/bitchy.
  • Think: cool confidence. The model is self-assured and composed. NOT trying to please the camera.
  • Reference: G-Star ECOM guidelines pages 13-14 — every single model has lips together, direct gaze, quiet confidence.
- LIGHTING (G-STAR ECOM STANDARD — STRICT):
  • BACKGROUND: Flat, uniform warm grey (#D5D3CC). The ENTIRE background must be ONE consistent color — no gradients, no dark patches, no bright spots, no "ironing light" effects.
  • SHADOW: ONE simple, soft shadow on the floor directly under/behind the model. That is ALL. No dramatic side lighting, no rim lights, no backlighting, no mood lighting.
  • SKIN TONE: Warm and natural. NOT cool/blue/clinical.
  • The background must look like a single-color studio backdrop with soft overhead lighting. Minimal, clean, consistent.
  • CRITICAL: If the background has any dark areas, bright spots, gradient shifts, or visible lighting effects — it is WRONG. The background must be uniformly #D5D3CC everywhere.`;
const ANTI_HALLUCINATION = `ABSOLUTE RULES — "If you don't know, don't show" (Learning #33):
- Reproduce the garment EXACTLY as shown in the reference images
- DO NOT invent ANY detail not visible in the references
- DO NOT add logos, text, labels, patches, or features NOT in the references
- DO NOT add any belt, bag, or accessories unless specified
- The pocket openings, shape, and placement are UNIQUE — copy EXACTLY from references
- IF YOU DON'T KNOW, DON'T SHOW — if a detail is not clearly visible, leave it out
- The BACK PANEL is PLAIN unless the reference shows otherwise — NO logos, NO prints, NO embroidery, NO branded patterns (Learning #34)
- For zip closures: show ONLY what's visible from the OUTSIDE. If closed, NO zip teeth/interior visible (Learning #33)
- DO NOT add leather patches, paper labels, or any branding to the back hem of jackets/tops unless CLEARLY visible in references (Learning #36)
- DO NOT hallucinate labels — if a label is not visible in the mannequin reference, it does NOT exist (Learning #42)
- BUT: Labels that ARE visible in the mannequin references MUST be reproduced. G-Star jeans typically have: leather back waistband patch, small woven side label (black/gold "G-Star Originals RAW Denim"), and rivets. If you see these in the reference photos, they MUST appear in the output at the correct position and size.

CRITICAL — STITCHING COLOR (Learning #53):
- The stitching/topstitching color MUST match what is visible in the mannequin references.
- If the mannequin shows WHITE stitching, generate WHITE stitching — NOT brown, NOT tan, NOT gold.
- If the mannequin shows BROWN/TAN stitching, generate BROWN/TAN stitching — NOT white.
- Gemini commonly hallucinate brown/tan stitching on jeans that have white stitching. CHECK the references carefully.
- This applies to ALL visible stitching: pocket outlines, side seams, inseams, waistband topstitching, back yoke seams.

CRITICAL — DENIM DISTRESSING / TEARS / RIPS (Learning #52):
- DO NOT add tears, rips, fraying, distressing, or worn patches UNLESS they are CLEARLY visible in the mannequin reference photos
- Clean denim is CLEAN — if the mannequin shows smooth, non-distressed fabric, the output MUST be smooth and non-distressed
- Common Gemini hallucination: adding fraying at pocket edges, knee rips, or distressed patches that do NOT exist on the actual product
- This applies to ALL denim areas: pockets, seams, knees, thighs, hems
- If the reference jeans are clean/non-distressed, even SUBTLE fraying or worn marks are a failure

CRITICAL — DO NOT ADD OR CHANGE GARMENTS NOT IN REFERENCES:
- DO NOT add any jacket, overshirt, cardigan, blazer, coat, or outer layer UNLESS it appears in the wardrobe reference images
- DO NOT add any top, shirt, or layer UNLESS it appears in the wardrobe reference images
- DO NOT CHANGE garments shown in the dressed base reference — if the reference shows a white t-shirt, the output MUST show a white t-shirt (same color, same style, same fit). Changing a white t-shirt to a tank top, crop top, or different colored garment is a CRITICAL FAILURE.
- The model wears ONLY what is shown in the provided reference images — nothing more, nothing different
- Inventing extra clothing layers OR replacing existing garments with different ones is a critical failure

MANNEQUIN ARTIFACTS — DO NOT REPRODUCE (Learning #24):
- Elastic bands, mounting straps, clips, pins, or support structures
- Black bands/straps holding garment to mannequin torso
- These are mannequin artifacts, NOT part of the garment
- The mannequin sits on a raised wheeled stand — IGNORE the stand and the hem height it creates

CRITICAL — MANNEQUIN STRAPS ARE NOT OVERALLS (Learning #55):
- The mannequin torso has SHOULDER STRAPS and SUPPORT BANDS that hold the form together
- These straps are HARDWARE — they are NOT denim straps, NOT overall straps, NOT part of the garment
- If you see straps on the mannequin shoulders + denim pants below, the garment is JEANS, NOT overalls/dungarees
- The product category tells you what the garment is. If it says "pants" or "jeans", there are NO straps on the final garment
- Generating overalls when the product is jeans is a CRITICAL FAILURE`;
const BODY_SHAPE_RULES = {
    pants: `CRITICAL — BODY SHAPE & 3D DENIM FIT (Learning #30 — "Denim starts from the back"):
- G-Star's brand DNA: "Denim starts from the back." The rear/bum MUST be visible and shape the denim.
- The 3D construction SCULPTS the seat area — fabric curves around the bum before dropping into the legs.
- Model should NOT look like a flat tube from hip to leg. Visible bum shape required.
- WOMEN: The buttocks must look FEMININE — natural curves, soft rounded shape. Women's denim sculpts a feminine rear silhouette. NOT flat, NOT masculine, NOT blocky. The seat area should show natural feminine body contour through the denim.
- MEN: The rear should show natural masculine body shape — athletic, not flat.
- From the side: clear curve at the rear, then fabric drops into legs.
- From the back: 3D seams follow body contour around the seat.
- From the front: slight 3/4 angle so body shape is visible (not dead flat).
- Keep it natural and subtle — not exaggerated, not vulgar. Real body in well-constructed denim.

CRITICAL — PANTS ALWAYS OVER SHOES (non-negotiable, every shot):
- The pant leg falls ON TOP of the shoe/boot. The fabric drapes over and rests on the shoe.
- NEVER show pants tucked INTO boots. NEVER show the boot shaft penetrating through the pant hem.
- NEVER show the pants ending mid-boot with the boot visible above the hem.
- The shoe is partially or mostly hidden under the wide leg opening — only the toe and sole visible.
- Wide-leg denim with boots: the entire boot shaft is hidden. Only the very toe of the boot shows.`,
    jackets: `CRITICAL — BODY SHAPE & FIT:
- The model should have natural body proportions visible under the jacket.
- Shoulders should match the jacket's structure.
- The jacket should show natural body movement and drape, not hang stiffly.
- Keep it natural and editorial — real body in well-constructed outerwear.
- For zip jackets: the zip goes ALL THE WAY from hem to collar — this is design-critical (Learning #33).
- PROPORTION WARNING: The jacket must NOT make the model look stocky or wide at the hips. The jacket hem sits at or slightly below the natural waist — the hip line below should be NARROWER than the jacket shoulders, creating a lean V-taper silhouette. A bomber jacket should NOT balloon or flare at the hem to make the model look pear-shaped or chubby.`,
    default: `CRITICAL — BODY SHAPE:
- Natural body proportions visible under the garment.
- Clothing should drape naturally, not stiffly.
- Keep it natural and editorial.`
};
const FLOOR_LENGTH_RULES = `CRITICAL — FLOOR-LENGTH HEM OVERRIDE (Learning #31):
- IGNORE the mannequin's hem height — the mannequin has a RAISED STAND
- The denim hem sits ON TOP OF the shoe, resting on it
- You should only see the sole of the shoe and maybe 5mm of the toe cap
- The shoe is 90% hidden by denim
- Like wearing jeans that are intentionally too long — the hem breaks heavily on the shoe
- Floor-length means: hems nearly scraping the ground, shoes almost invisible under denim
- NOT ankle-length, NOT 1cm above floor. ON the floor.`;
const ANKLE_LENGTH_RULES = `CRITICAL — ANKLE-LENGTH HEM PRECISION (Learning #35):
- ANKLE-LENGTH — the hem ends AT the ankle, showing the FULL SHOE
- This is NOT floor-length — there should be clear space between hem and floor
- The shoe is FULLY VISIBLE below the hem
- Do NOT make these floor-length — that is the WRONG look`;
function getEcomPosingRules(gender, garmentCategory) {
    const cat = garmentCategory.toLowerCase();
    const isBottoms = [
        'pants',
        'jeans',
        'shorts',
        'skirt',
        'trousers'
    ].includes(cat);
    if (gender === 'female') {
        return `G-STAR WOMEN'S POSING (ECOM STANDARD):
- Add FEMININITY: slight hip tilt to one side, soft bend in one knee, weight on one leg
- Hands: relaxed at sides or one hand lightly touching hip/thigh — NOT stiff, NOT military
- ${isBottoms ? 'For bottoms: one thumb can hook a belt loop or pocket edge for a natural look' : 'Shoulders relaxed, natural posture showing garment drape'}
- Body angle: slight 3/4 turn (not dead-on flat) to show body shape and garment fit
- CONFIDENCE + WARMTH: the pose should feel relaxed and feminine, not rigid or confrontational
- Feet: one foot slightly forward, weight shifted — NOT parallel feet, NOT at attention`;
    }
    // Male
    if (isBottoms) {
        return `G-STAR MEN'S POSING — BOTTOMS (ECOM STANDARD):
- Relaxed masculine stance: feet shoulder-width, slight weight shift to one side
- Hands: thumbs hooked in front pockets OR one hand behind/in back pocket — natural, NOT forced
- Body: slight 3/4 angle to show denim 3D construction and body shape
- NOT rigid military stance — think "editorial between shots" — relaxed but intentional
- Shoulders square, chin slightly up, confident but approachable`;
    }
    return `G-STAR MEN'S POSING (ECOM STANDARD):
- Natural masculine stance: relaxed shoulders, slight weight shift
- Arms naturally at sides or hands lightly in pockets
- Body: slight 3/4 angle preferred over dead-on flat front
- Confident, relaxed energy — not stiff, not aggressive`;
}
function getEcomFootwear(gender, fitDescription) {
    const fit = (fitDescription || '').toLowerCase();
    if (gender === 'female') {
        // Women: ALWAYS heels or flat leather shoes. NEVER sneakers for bottoms.
        if (fit.includes('slim') || fit.includes('skinny') || fit.includes('straight')) {
            return `FOOTWEAR (ECOM MATRIX — WOMEN ${fit.toUpperCase()}): Pointed-toe heels or sleek ankle boots.
CRITICAL: Women's jeans shots NEVER use sneakers. Only heels or flat leather shoes.`;
        }
        if (fit.includes('flare') || fit.includes('bootcut')) {
            return `FOOTWEAR (ECOM MATRIX — WOMEN FLARE/BOOTCUT): Platform heels or heeled boots that add height. The flare should drape over the shoe.
CRITICAL: Women's jeans shots NEVER use sneakers. Only heels or flat leather shoes.`;
        }
        if (fit.includes('loose') || fit.includes('barrel') || fit.includes('boyfriend') || fit.includes('wide')) {
            return `FOOTWEAR (ECOM MATRIX — WOMEN LOOSE/WIDE): Flat leather sandals or minimal flat leather shoes. Clean, minimal.
CRITICAL: Women's jeans shots NEVER use sneakers. Only heels or flat leather shoes.`;
        }
        // Default women
        return `FOOTWEAR (ECOM — WOMEN DEFAULT): Heels or flat leather shoes.
CRITICAL: Women's jeans shots NEVER use sneakers. Only heels or flat leather shoes.`;
    }
    // Male footwear matrix
    if (fit.includes('slim') || fit.includes('skinny') || fit.includes('tapered')) {
        return `FOOTWEAR (ECOM MATRIX — MEN SLIM/TAPERED): Leather boots — Chelsea boots, lace-up boots, or dress boots. Clean, slim-profile footwear matching the lean silhouette.`;
    }
    if (fit.includes('straight') || fit.includes('regular')) {
        return `FOOTWEAR (ECOM MATRIX — MEN STRAIGHT/REGULAR): Leather dress shoes or clean Derby/Oxford shoes. Classic, structured footwear.`;
    }
    if (fit.includes('loose') || fit.includes('relaxed') || fit.includes('wide') || fit.includes('barrel')) {
        return `FOOTWEAR (ECOM MATRIX — MEN LOOSE/RELAXED): Clean white sneakers or chunky casual sneakers. Relaxed footwear matching the loose silhouette.`;
    }
    // Default men
    return `FOOTWEAR (ECOM — MEN DEFAULT): Clean leather boots or dress shoes. Classic, matches denim.`;
}
function getEcomStylingTop(gender) {
    if (gender === 'female') {
        return `STYLING TOP (ECOM STANDARD): Simple fitted top in a NEUTRAL color — white, off-white, beige, light grey, or black ONLY. No prints, no stripes, no bright colors, no logos. The top MUST be TUCKED INTO the jeans showing the full waistband, belt loops, and button/fly. The jeans waistband is the hero — it must be fully visible. A cropped fitted top that ends at the waist is also acceptable as long as the waistband is visible.`;
    }
    return `STYLING TOP (ECOM STANDARD): Simple fitted t-shirt or top in a NEUTRAL color — white, off-white, beige, light grey, or black ONLY. No prints, no stripes, no bright colors, no logos. The top MUST be TUCKED INTO the jeans showing the full waistband, belt loops, and button/fly. The waistband is the hero — it must be fully visible.`;
}
const ECOM_NO_GOS = `G-STAR ECOM NO-GO RULES (STRICT):
- NO sneakers on women for any bottoms/jeans shot — heels or flat leather ONLY
- NO caps or sunglasses combined with shirts/tops
- NO matching color sets (top and bottom same color creating a "suit" look)
- NO too-tonal styling (everything same shade — needs contrast between top and bottom)
- NO bright/neon/printed tops for bottoms shoots — neutral basics ONLY
- NO visible underwear, bra straps, or undergarments above the waistband`;
// Shots that require CROPPED framing (waist-to-ankle, no head)
const CROPPED_SHOT_TYPES = new Set([
    'M01',
    'M02'
]);
// Detail shots (close-up on garment construction — back pocket/bum area)
const DETAIL_SHOT_TYPES = new Set([
    'M05'
]);
function buildGenerationPrompt(params) {
    const { modelDescription, garmentDescription, shotDescription, garmentCategory, metadata, modifications, productCritical, shotType, gender } = params;
    const bodyRules = BODY_SHAPE_RULES[garmentCategory] || BODY_SHAPE_RULES.default;
    let metadataStr = '';
    if (metadata.waistHeight) metadataStr += `\nWaist height: ${metadata.waistHeight}.`;
    if (metadata.waistHeight === 'low') {
        metadataStr += `\nLOW-RISE WAISTBAND RULE (CRITICAL): These are low-rise jeans. The waistband sits LOW on the hip. The jeans waistband is the TOPMOST visible garment at the hip. NO underwear waistband, NO boxer brief elastic, NO undergarment of any kind should be visible above the jeans waistband. If the jeans waistband is low, show bare skin above it — not underwear. Any visible underwear waistband above the jeans is a critical failure.`;
    }
    if (metadata.fitDescription) metadataStr += `\nFit: ${metadata.fitDescription}.`;
    // Floor distance determines hem rules (Learning #31, #35)
    let hemRules = '';
    const floorDist = metadata.floorDistance;
    if (floorDist === '0' || floorDist === '0 - touching') {
        hemRules = `\n${FLOOR_LENGTH_RULES}`;
        metadataStr += `\nHem: FLOOR-LENGTH — hems touch/nearly touch the ground.`;
    } else if (floorDist) {
        hemRules = `\n${ANKLE_LENGTH_RULES}`;
        metadataStr += `\nHem distance to floor: ${floorDist}.`;
    }
    let modStr = '';
    if (modifications?.length) {
        modStr = `\n\nADDITIONAL MODIFICATIONS (apply these adjustments):\n${modifications.map((m, i)=>`${i + 1}. ${m}`).join('\n')}`;
    }
    let productStr = '';
    if (productCritical) {
        productStr = `\n\nPRODUCT-SPECIFIC CRITICAL RULES:\n${productCritical}`;
    }
    return [
        `Generate a fashion editorial photograph for G-Star RAW e-commerce.`,
        `\nIMPORTANT: The garment reference images provided above show the EXACT garment to be worn. The model must wear THIS SPECIFIC GARMENT — match every detail: fabric, color, fit, seams, pockets, closures, stitching. Do NOT substitute with any other garment.`,
        `\nGARMENT WIDTH/FIT — CRITICAL: The FLAT IMAGE shows the TRUE width and silhouette of this garment. If the flat image shows WIDE legs, the generated image MUST show WIDE legs. If it shows a BAGGY/LOOSE fit, it MUST be BAGGY/LOOSE on the model — NOT skinny, NOT fitted, NOT tapered. The flat image is the DEFINITIVE reference for garment width and shape. A boyfriend/barrel/wide-leg jean that appears skinny on the model is a CRITICAL FAILURE. Match the width ratio visible in the flat image.`,
        `\nFABRIC COLOR — CRITICAL (Learning #44): The color/wash of the garment is defined by the mannequin reference images ONLY. Do NOT shift, lighten, darken, or reinterpret the color. If the mannequin shows dark indigo denim, render dark indigo. If it shows light grey, render light grey. Match the exact shade and wash as photographed. The text description is secondary — the images are the truth.`,
        `\nIMAGE-DRIVEN GENERATION (Learning #1 — THE #1 LESSON):`,
        `The reference images ARE the specification. Minimize reliance on text description.`,
        `Copy EXACTLY what you see in the images. DO NOT describe garment hardware in text — let the images specify buttons, zips, rivets, labels.`,
        `\nMODEL: ${modelDescription}`,
        `\nGARMENT (text supplements reference images): ${garmentDescription}${metadataStr}`,
        `\nPOSE & FRAMING: ${shotDescription}`,
        CROPPED_SHOT_TYPES.has(shotType || '') ? `CRITICAL FRAMING — THIS IS A CROPPED PRODUCT SHOT, NOT A PORTRAIT:
The camera is positioned at WAIST HEIGHT and frames ONLY the lower half of the body.
WHAT IS VISIBLE: waistband → legs → feet/shoes. That is ALL.
WHAT IS NOT VISIBLE: head, face, shoulders, chest, arms — they are ABOVE the camera frame and do not appear.
Imagine a photographer kneeling and photographing only from the waist down. The head is cut off by the top of the frame.
The garment (jeans/pants) fills the full height of the image from waistband to ankle.
If a head appears in this image it is a critical failure.

CRITICAL — TOP OF FRAME POSITION:
The TOP EDGE of the image MUST show the WAISTBAND of the jeans/pants. The waistband button must be visible at or near the top of the frame. If the image starts at mid-thigh or below the waistband, the framing is WRONG — the waistband MUST be visible. The top 5-10% of the image should show the waistband area, belt loops, and possibly a sliver of the shirt/jacket hem above it.

CRITICAL — LEAN BODY PROPORTIONS FOR CROPPED SHOTS:
The model is a LEAN, ATHLETIC fashion model — NOT stocky, NOT heavyset, NOT chubby.
- Hip width must be NARROW — this is a slim fashion model, not a regular person.
- The waist-to-hip transition must be smooth and slim. NO wide hips. NO pear shape.
- If a jacket or top is partially visible at the top of the frame, it should NOT make the model look wider or bulkier.
- The jacket hem should hug the body — NOT balloon outward at the hip line.
- Thighs should be lean and proportional to a tall, slim model (175-185cm, athletic build).
- Think runway model proportions: narrow hips, long legs, lean silhouette.
- If in doubt, make the model SLIMMER rather than wider. An overly wide hip/bottom is a critical failure for fashion e-commerce.` : `Full body visible from top of head to shoes/feet.`,
        `BACKGROUND — STRICT RULE: Flat uniform warm grey (#D5D3CC) everywhere. ONE simple soft floor shadow under the model — nothing else. NO gradients, NO dark patches, NO bright spots, NO dramatic lighting, NO rim light, NO backlight, NO mood lighting. The ENTIRE background must be one consistent #D5D3CC tone from edge to edge. Any variation in background tone is a CRITICAL FAILURE.`,
        CROPPED_SHOT_TYPES.has(shotType || '') ? `\nCROPPED SHOT — HEAD/FACE RULES SUPPRESSED: This is a waist-to-ankle product shot. No head, face, or expression rules apply. Focus only on: leg proportions, fabric drape, garment fit, and shoe style.\nCROPPED SHOT FOOT SIZE WARNING: In cropped shots the feet are highly visible and prominent. AI ALWAYS makes feet too large in cropped shots. Actively SHRINK feet — foot width must be ≤ ankle width. Sandals must not look oversized. If the dressed base reference shows large feet/sandals, CORRECT them to natural proportions.` : `\n${ANTI_AI_RULES}`,
        `\n${bodyRules}`,
        hemRules,
        `\n${ANTI_HALLUCINATION}`,
        `\nHARDWARE COLOR (Learning #37): If the garment has snap buttons, render them in the SAME COLOR as the mannequin reference. Dark snaps = DARK. NOT white, NOT pearl, NOT silver.`,
        // G-Star ECOM Guidelines injection (gender-aware when available)
        gender ? `\n${getEcomPosingRules(gender, garmentCategory)}` : '',
        gender && metadata.fitDescription ? `\n${getEcomFootwear(gender, metadata.fitDescription)}` : '',
        gender && [
            'pants',
            'jeans',
            'shorts',
            'skirt',
            'trousers'
        ].includes(garmentCategory.toLowerCase()) ? `\n${getEcomStylingTop(gender)}` : '',
        `\n${ECOM_NO_GOS}`,
        productStr,
        modStr
    ].filter(Boolean).join('\n');
}
const REF_LABELS = {
    modelCard: 'MODEL IDENTITY REFERENCE. The person in the generated image MUST be this exact same person — same face, same features, same body type, same skin tone.',
    flatImage: 'GARMENT FLAT IMAGE — #1 reference for width and proportions. This shows the TRUE garment width without mannequin distortion. Reproduce this width/fit EXACTLY.',
    mannequinFront: 'GARMENT ON MANNEQUIN (front view). Copy every visible detail: seams, pockets, hardware, stitching.',
    mannequinSide: 'GARMENT ON MANNEQUIN (side view). Shows 3D construction and sculptured seat shape.',
    mannequinBack: 'GARMENT ON MANNEQUIN (back view). The BACK PANEL is PLAIN unless shown otherwise here.',
    zoneGrid: (zone, n, total)=>`CONSTRUCTION DETAIL GRID ${n}/${total}: ${zone} zone from multiple angles. Copy seam patterns, hardware, and trim EXACTLY as shown.`
};
function buildQCPrompt(params) {
    const { shotType, garmentCategory, garmentDescription, metadata } = params;
    const floorDist = metadata.floorDistance || '';
    const isFloorLength = floorDist === '0' || floorDist === '0 - touching' || floorDist === 'floor';
    const isCropped = shotType === 'M01' || shotType === 'M02';
    return `You are a Quality Control auditor for G-Star RAW AI-generated e-commerce photography.
Compare the AI-generated image against the reference images. Score ONLY these 4 dimensions.

GARMENT: ${garmentDescription}
CATEGORY: ${garmentCategory}
SHOT TYPE: ${shotType}${isCropped ? ' (CROPPED — waist to ankle)' : ''}

SCORE THESE 4 DIMENSIONS (1-10 each, with a short note):

1. COLOR MATCH — Is the garment color/wash matching the original mannequin reference?
   - Compare against the FRONT MANNEQUIN image (COLOR ANCHOR) — exact shade, wash intensity, fading pattern.
   - Slightly off = 6-7. Completely wrong color = 1-4. Perfect match = 8-10.

2. WAIST HEIGHT — Is the waistband sitting at the correct height on the body?
   - Compare waist position against fit model photos (if provided) or mannequin references.
   - The rise (low/mid/high) must match the original garment. Wrong rise = 1-4.
   - Score 8-10 if waistband height looks correct relative to body proportions.

3. GARMENT LENGTH — Is the hem length correct compared to the fit model / mannequin?
   - Check where the hem falls: ankle, floor, mid-calf, above-knee — must match reference.
   ${isFloorLength ? '- FLOOR-LENGTH: Hems MUST touch ground. Shoes 90% hidden.' : ''}
   - Too long or too short vs reference = 4-6. Way off = 1-3. Correct = 8-10.

4. CONSTRUCTION FIDELITY — Are construction details preserved from the reference images?
   - Check: seam lines (especially knee articulation seams, side seams), pocket shape and placement, topstitching patterns.
   - Check: labels/patches — leather back patch, woven side labels, any branded tabs visible in references MUST appear in the AI image.
   - Check: hardware — rivets, buttons, zip pulls must match reference.
   - Check: leg shape/silhouette — if the reference shows a barrel/wide/tapered/flared leg, the AI image must match that exact shape.
   - Missing knee seams or construction details = 4-6. Missing labels/patches = 3-5. Smoothed-over details everywhere = 1-3. All details preserved = 8-10.

RESPOND IN EXACT JSON (no markdown, no backticks):
{"color_match":{"score":0,"note":""},"waist_height":{"score":0,"note":""},"garment_length":{"score":0,"note":""},"construction_fidelity":{"score":0,"note":""},"weighted_score":0,"pass":false,"critical_issues":[],"summary":""}

weighted_score = (color_match + waist_height + garment_length + construction_fidelity) / 4
pass = true if weighted_score >= 7.0 AND no dimension below 4`;
}
function buildLabelQCPrompt() {
    return `You are a label/branding QC expert for G-Star RAW.
Compare AI image against ALL mannequin reference images.

1. Inventory EVERY label/patch/tab on the REAL garment (from mannequin photos)
2. Inventory EVERY label/patch/tab in the AI image
3. Flag any in AI that doesn't exist on the real garment

COMMON HALLUCINATIONS: leather back patches, paper waistband labels, wrong patch styles, invented front tabs.

RESPOND IN JSON (no markdown):
{"real_labels":[],"ai_labels":[],"invented_labels":[],"label_score":0,"pass":true}
Score: 10=clean, 4-6=one invented, 1-3=multiple invented. pass=true if score>=7`;
}
const ZONE_DEFS = {
    pants: {
        hip: {
            y1: 0.38,
            y2: 0.55,
            x1: 0.15,
            x2: 0.85,
            angles: [
                0,
                1,
                2,
                4
            ],
            name: 'Hip Zone — waistband, pockets, rivets, topstitching'
        },
        knee: {
            y1: 0.50,
            y2: 0.70,
            x1: 0.15,
            x2: 0.85,
            angles: [
                0,
                1,
                2,
                4
            ],
            name: 'Knee Zone — thigh to knee, seam construction'
        },
        ankle: {
            y1: 0.68,
            y2: 0.85,
            x1: 0.15,
            x2: 0.85,
            angles: [
                0,
                1,
                2,
                4
            ],
            name: 'Ankle Zone — hem, cuffs, leg opening'
        },
        back: {
            y1: 0.38,
            y2: 0.55,
            x1: 0.15,
            x2: 0.85,
            angles: [
                3,
                4,
                5
            ],
            name: 'Back Hip Zone — back pockets, yoke, labels'
        }
    },
    jackets: {
        collar: {
            y1: 0.0,
            y2: 0.2,
            x1: 0.15,
            x2: 0.85,
            angles: [
                0,
                1,
                6
            ],
            name: 'Collar Zone'
        },
        chest: {
            y1: 0.15,
            y2: 0.5,
            x1: 0.15,
            x2: 0.85,
            angles: [
                0,
                1,
                6,
                9
            ],
            name: 'Chest Zone'
        },
        sleeve: {
            y1: 0.2,
            y2: 0.6,
            x1: 0.0,
            x2: 0.4,
            angles: [
                3,
                9
            ],
            name: 'Sleeve Zone'
        },
        back: {
            y1: 0.0,
            y2: 0.5,
            x1: 0.15,
            x2: 0.85,
            angles: [
                5,
                6,
                7
            ],
            name: 'Back Zone'
        }
    },
    default: {
        upper: {
            y1: 0.0,
            y2: 0.4,
            x1: 0.15,
            x2: 0.85,
            angles: [
                0,
                1,
                6
            ],
            name: 'Upper Zone'
        },
        lower: {
            y1: 0.4,
            y2: 1.0,
            x1: 0.15,
            x2: 0.85,
            angles: [
                0,
                1,
                6
            ],
            name: 'Lower Zone'
        }
    }
};
}),
"[project]/src/lib/zone-grids.ts [app-route] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "generateZoneGrids",
    ()=>generateZoneGrids,
    "resizeForFeed",
    ()=>resizeForFeed
]);
/**
 * Zone Grid Generator — Server-side crop grids from mannequin 360° images.
 * Replicates v5 pipeline's make_area_grids.py functionality.
 *
 * Creates multi-angle cropped grids showing construction detail zones:
 * - Pants: hip, knee, ankle, back
 * - Jackets: collar, chest, sleeve, back
 *
 * Uses sharp for image processing (available in Node.js).
 */ var __TURBOPACK__imported__module__$5b$externals$5d2f$sharp__$5b$external$5d$__$28$sharp$2c$__cjs$2c$__$5b$project$5d2f$node_modules$2f$sharp$29$__ = __turbopack_context__.i("[externals]/sharp [external] (sharp, cjs, [project]/node_modules/sharp)");
var __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$prompts$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/src/lib/prompts.ts [app-route] (ecmascript)");
;
;
async function generateZoneGrids(mannequinImages, garmentCategory) {
    const zones = __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$prompts$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["ZONE_DEFS"][garmentCategory] || __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$prompts$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["ZONE_DEFS"].default;
    const grids = [];
    for (const [zoneKey, zoneDef] of Object.entries(zones)){
        try {
            const grid = await createZoneGrid(mannequinImages, zoneDef, zoneKey);
            if (grid) {
                grids.push(grid);
            }
        } catch (err) {
            console.error(`[ZoneGrids] Failed to create ${zoneKey} grid:`, err);
        }
    }
    console.log(`[ZoneGrids] Generated ${grids.length} zone grids for ${garmentCategory}`);
    return grids;
}
/**
 * Create a single zone grid by cropping the specified zone from multiple angles
 * and concatenating them horizontally.
 */ async function createZoneGrid(mannequinImages, zoneDef, zoneKey) {
    // Find which mannequin images match the required angles
    // Map angle indices to available images
    const crops = [];
    for (const angleIdx of zoneDef.angles){
        // Find the mannequin image closest to this angle index
        const img = findClosestImage(mannequinImages, angleIdx);
        if (!img) continue;
        try {
            const crop = await cropZone(img.buffer, zoneDef);
            if (crop) crops.push(crop);
        } catch (err) {
            console.error(`[ZoneGrids] Failed to crop angle ${angleIdx} for ${zoneKey}:`, err);
        }
    }
    if (crops.length === 0) return null;
    // Concatenate crops horizontally into a grid
    const gridBuffer = await concatenateHorizontal(crops);
    return {
        buffer: gridBuffer,
        mimeType: 'image/jpeg',
        label: `CONSTRUCTION DETAIL GRID: ${zoneDef.name} from ${crops.length} angles. Copy seam patterns, hardware, and trim EXACTLY as shown. These are high-resolution zone crops — study every detail.`,
        zoneName: zoneKey
    };
}
/**
 * Find the mannequin image with the closest index to the target angle.
 * If there are N mannequin images, they're assumed to be evenly distributed.
 */ function findClosestImage(images, targetAngle) {
    if (images.length === 0) return null;
    // If we have few images, map the v5 angle indices (0-13 for 14 images)
    // to the available count. For 9 images at 40° intervals:
    // v5 index 0 → img 0 (front)
    // v5 index 1 → img 1 (front-right)
    // v5 index 5-7 → back area
    // v5 index 9 → img 6 or 7 (left side)
    // Simple approach: find the image whose index is closest
    let closest = images[0];
    let minDist = Math.abs(images[0].index - targetAngle);
    for (const img of images){
        const dist = Math.abs(img.index - targetAngle);
        if (dist < minDist) {
            minDist = dist;
            closest = img;
        }
    }
    return closest;
}
/**
 * Crop a zone from a mannequin image using fractional coordinates.
 *
 * CRITICAL: Mannequin images are 8256×5504 LANDSCAPE orientation.
 * They must be rotated 90° CW to vertical (5504×8256) before cropping.
 * After rotation, Y-axis fractions map to garment zones.
 *
 * Returns crop at 1.8× upscale (max 1600px) — matches Claude workspace quality.
 * Previous version used 500px which caused ~2/10 quality on deployed site.
 */ async function cropZone(imageBuffer, zoneDef) {
    // Step 1: Rotate 90° CW if image is landscape (mannequin images are 8256×5504)
    const metadata = await (0, __TURBOPACK__imported__module__$5b$externals$5d2f$sharp__$5b$external$5d$__$28$sharp$2c$__cjs$2c$__$5b$project$5d2f$node_modules$2f$sharp$29$__["default"])(imageBuffer).metadata();
    const origWidth = metadata.width || 1000;
    const origHeight = metadata.height || 1000;
    let processBuffer = imageBuffer;
    let width = origWidth;
    let height = origHeight;
    if (origWidth > origHeight) {
        // Landscape → rotate 90° CW to make vertical
        processBuffer = await (0, __TURBOPACK__imported__module__$5b$externals$5d2f$sharp__$5b$external$5d$__$28$sharp$2c$__cjs$2c$__$5b$project$5d2f$node_modules$2f$sharp$29$__["default"])(imageBuffer).rotate(90).toBuffer();
        width = origHeight; // ~5504
        height = origWidth; // ~8256
    }
    const left = Math.round(width * zoneDef.x1);
    const top = Math.round(height * zoneDef.y1);
    const cropWidth = Math.round(width * (zoneDef.x2 - zoneDef.x1));
    const cropHeight = Math.round(height * (zoneDef.y2 - zoneDef.y1));
    // Ensure valid crop dimensions
    const safeLeft = Math.max(0, Math.min(left, width - 1));
    const safeTop = Math.max(0, Math.min(top, height - 1));
    const safeWidth = Math.min(cropWidth, width - safeLeft);
    const safeHeight = Math.min(cropHeight, height - safeTop);
    if (safeWidth <= 0 || safeHeight <= 0) {
        throw new Error(`Invalid crop dimensions for zone`);
    }
    // Step 2: Extract zone crop
    const crop = await (0, __TURBOPACK__imported__module__$5b$externals$5d2f$sharp__$5b$external$5d$__$28$sharp$2c$__cjs$2c$__$5b$project$5d2f$node_modules$2f$sharp$29$__["default"])(processBuffer).extract({
        left: safeLeft,
        top: safeTop,
        width: safeWidth,
        height: safeHeight
    }).toBuffer();
    // Step 3: Upscale 1.8× (capped at 1600px) — v5/Claude workspace approach
    const cropMeta = await (0, __TURBOPACK__imported__module__$5b$externals$5d2f$sharp__$5b$external$5d$__$28$sharp$2c$__cjs$2c$__$5b$project$5d2f$node_modules$2f$sharp$29$__["default"])(crop).metadata();
    const cw = cropMeta.width || safeWidth;
    const ch = cropMeta.height || safeHeight;
    const UPSCALE = 1.8;
    const MAX_DIM = 1600;
    let newW = Math.round(cw * UPSCALE);
    let newH = Math.round(ch * UPSCALE);
    if (newW > MAX_DIM || newH > MAX_DIM) {
        const scale = MAX_DIM / Math.max(newW, newH);
        newW = Math.round(newW * scale);
        newH = Math.round(newH * scale);
    }
    return (0, __TURBOPACK__imported__module__$5b$externals$5d2f$sharp__$5b$external$5d$__$28$sharp$2c$__cjs$2c$__$5b$project$5d2f$node_modules$2f$sharp$29$__["default"])(crop).resize(newW, newH, {
        fit: 'fill'
    }).jpeg({
        quality: 92
    }).toBuffer();
}
/**
 * Concatenate multiple image buffers horizontally with a small gap.
 */ async function concatenateHorizontal(images) {
    if (images.length === 1) return images[0];
    const GAP = 4;
    // Get metadata for all images
    const metas = await Promise.all(images.map(async (buf)=>{
        const meta = await (0, __TURBOPACK__imported__module__$5b$externals$5d2f$sharp__$5b$external$5d$__$28$sharp$2c$__cjs$2c$__$5b$project$5d2f$node_modules$2f$sharp$29$__["default"])(buf).metadata();
        return {
            width: meta.width || 500,
            height: meta.height || 500,
            buffer: buf
        };
    }));
    // Find max height
    const maxHeight = Math.max(...metas.map((m)=>m.height));
    // Resize all to same height
    const resized = await Promise.all(metas.map(async (m)=>{
        if (m.height !== maxHeight) {
            const newWidth = Math.round(m.width * (maxHeight / m.height));
            const buf = await (0, __TURBOPACK__imported__module__$5b$externals$5d2f$sharp__$5b$external$5d$__$28$sharp$2c$__cjs$2c$__$5b$project$5d2f$node_modules$2f$sharp$29$__["default"])(m.buffer).resize(newWidth, maxHeight).jpeg({
                quality: 92
            }).toBuffer();
            return {
                buffer: buf,
                width: newWidth,
                height: maxHeight
            };
        }
        return {
            buffer: m.buffer,
            width: m.width,
            height: m.height
        };
    }));
    const totalWidth = resized.reduce((sum, r)=>sum + r.width, 0) + GAP * (resized.length - 1);
    // Create composite
    const composites = [];
    let x = 0;
    for (const r of resized){
        composites.push({
            input: r.buffer,
            left: x,
            top: 0
        });
        x += r.width + GAP;
    }
    return (0, __TURBOPACK__imported__module__$5b$externals$5d2f$sharp__$5b$external$5d$__$28$sharp$2c$__cjs$2c$__$5b$project$5d2f$node_modules$2f$sharp$29$__["default"])({
        create: {
            width: totalWidth,
            height: maxHeight,
            channels: 3,
            background: {
                r: 13,
                g: 17,
                b: 23
            }
        }
    }).composite(composites).jpeg({
        quality: 92
    }).toBuffer();
}
async function resizeForFeed(imageBuffer, maxSide) {
    const metadata = await (0, __TURBOPACK__imported__module__$5b$externals$5d2f$sharp__$5b$external$5d$__$28$sharp$2c$__cjs$2c$__$5b$project$5d2f$node_modules$2f$sharp$29$__["default"])(imageBuffer).metadata();
    const width = metadata.width || 1000;
    const height = metadata.height || 1000;
    let processBuffer = imageBuffer;
    // Rotate landscape mannequin images to vertical
    if (width > height * 1.3) {
        processBuffer = await (0, __TURBOPACK__imported__module__$5b$externals$5d2f$sharp__$5b$external$5d$__$28$sharp$2c$__cjs$2c$__$5b$project$5d2f$node_modules$2f$sharp$29$__["default"])(imageBuffer).rotate(90).toBuffer();
    }
    return (0, __TURBOPACK__imported__module__$5b$externals$5d2f$sharp__$5b$external$5d$__$28$sharp$2c$__cjs$2c$__$5b$project$5d2f$node_modules$2f$sharp$29$__["default"])(processBuffer).resize(maxSide, maxSide, {
        fit: 'inside',
        withoutEnlargement: true
    }).jpeg({
        quality: 92
    }).toBuffer();
}
}),
"[project]/src/lib/garment-dna.ts [app-route] (ecmascript)", ((__turbopack_context__) => {
"use strict";

/**
 * Garment DNA — per-product critical details for generation prompts.
 *
 * Each garment has unique construction details that Gemini MUST reproduce.
 * These are observed from mannequin + flat reference images and product descriptions.
 * Without these, the model generates generic jeans instead of the specific product.
 *
 * IMPORTANT: The zone crops feed Gemini the visual details, but the text DNA
 * tells it WHAT to look for and WHERE. Both are needed for 9+/10 quality.
 */ __turbopack_context__.s([
    "GARMENT_REGISTRY",
    ()=>GARMENT_REGISTRY,
    "getGarmentDNA",
    ()=>getGarmentDNA
]);
const GARMENT_REGISTRY = {
    'D27463-D945-001': {
        designNumber: 'D27463-D945-001',
        styleName: 'Carpenter Straight Jeans',
        gender: 'male',
        category: 'pants',
        fit: 'wide straight leg',
        dna: `CRITICAL GARMENT DETAILS — match EVERY detail from the reference images:

FABRIC & COLOR:
- Dark raw indigo denim — deep navy, almost black with indigo hue, UNWASHED
- NO fading, NO distressing, NO wash effects, NO whiskering
- Gold/yellow contrast topstitching on ALL major seams

WAISTBAND & FLY:
- Button fly — single metal shank button at center waist
- Mid-rise waistband with belt loops (5-6 loops)
- Gold topstitching along waistband edges

POCKETS:
- Two front slash pockets with topstitched edges
- Small coin pocket at right front (viewer's left)
- CARPENTER/TOOL POCKET on outer thigh — rectangular patch pocket with topstitching, SIGNATURE DETAIL
- Two back patch pockets
- Copper/bronze rivets at stress points

LEG SHAPE:
- Wide straight leg / relaxed fit — NOT slim, NOT skinny
- Generous through thigh, minimal taper

HEM/CUFFS:
- Selvedge turn-up cuffs at hem showing white/natural selvedge edge line
- Single fold, approximately 3-4cm deep`,
        shotOverrides: {
            M01: 'POSE: Hands clasped BEHIND BACK — arms behind body, chest open. This ensures the CARPENTER POCKET on the outer thigh is FULLY visible and unobstructed.'
        },
        specialZones: [
            {
                name: 'Carpenter Pocket',
                y1: 0.44,
                y2: 0.58,
                x1: 0.55,
                x2: 0.85,
                upscale: 2.5,
                angles: [
                    0,
                    1,
                    2
                ],
                label: 'CARPENTER POCKET CLOSE-UP — rectangular patch pocket on outer thigh with topstitching. This SIGNATURE DETAIL must be clearly visible.'
            }
        ]
    },
    'D28831-E358-H938': {
        designNumber: 'D28831-E358-H938',
        styleName: 'Stevey 3D Flare Jeans',
        gender: 'female',
        category: 'pants',
        fit: 'bootcut flare',
        dna: `CRITICAL GARMENT DETAILS — match EVERY detail from the reference images:

FABRIC & COLOR:
- Greencast denim — medium/vintage wash with SOFT GREEN UNDERTONE
- Indigo base with greenish cast — NOT pure blue, NOT grey, NOT black
- Heavy WHISKERING at hip/thigh — horizontal fading lines from fly/pocket area
- HONEYCOMB FADING behind knees
- Overall vintage worn-in appearance — lighter at stress points, darker in creases
- 13 oz sturdy denim

WAISTBAND & FLY:
- Zip + button fly — single metal button at center waist
- Mid-rise waistband — NOT high, NOT low
- Belt loops (5-6)

POCKETS:
- Two front slash pockets
- Small coin pocket at right front (viewer's left)
- Two back patch pockets — simple
- NO carpenter pocket

G-STAR BRANDING:
- Small yellow/gold G-STAR woven label on front left pocket area (viewer's right)
- Paper/leather-look G-STAR RAW patch on back right pocket area
- DO NOT add any branding not visible in references

LEG SHAPE — SIGNATURE FLARE:
- BOOTCUT/FLARE fit — the DEFINING feature
- Fitted through hip and thigh (3D sculpted construction)
- From the knee, the leg FLARES DRAMATICALLY outward
- At the hem, the leg opening is very wide — much wider than the knee
- Match the exact flare angle from the mannequin references

3D CONSTRUCTION:
- Sculpted fit through hip and upper thigh — shaped seaming
- Body-hugging above the knee, transitions to wide flare below

HEM:
- Clean hem — NO selvedge cuffs, NO turn-ups
- Straight cut at full length, should touch top of shoes`,
        specialZones: [
            {
                name: 'Flare Opening',
                y1: 0.65,
                y2: 0.88,
                x1: 0.05,
                x2: 0.95,
                upscale: 1.5,
                angles: [
                    0,
                    2,
                    4
                ],
                label: 'FLARE ZONE — the dramatic leg opening from knee to hem. This is WIDER than the hip. Copy this silhouette EXACTLY.'
            }
        ]
    }
};
function getGarmentDNA(designNumber) {
    // Try exact match first
    if (GARMENT_REGISTRY[designNumber]) {
        return GARMENT_REGISTRY[designNumber];
    }
    // Try prefix match (e.g., "D27463" matches "D27463-D945-001")
    for (const [key, dna] of Object.entries(GARMENT_REGISTRY)){
        if (key.startsWith(designNumber) || designNumber.startsWith(key.split('-').slice(0, 2).join('-'))) {
            return dna;
        }
    }
    return null;
}
}),
"[project]/src/app/api/models/generate-dressed/route.ts [app-route] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "DELETE",
    ()=>DELETE,
    "GET",
    ()=>GET,
    "POST",
    ()=>POST
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$server$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/next/server.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$wardrobe$2d$hash$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/src/lib/wardrobe-hash.ts [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$firestore$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/src/lib/firestore.ts [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$vertex$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/src/lib/vertex.ts [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$gcs$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/src/lib/gcs.ts [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$zone$2d$grids$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/src/lib/zone-grids.ts [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$externals$5d2f$sharp__$5b$external$5d$__$28$sharp$2c$__cjs$2c$__$5b$project$5d2f$node_modules$2f$sharp$29$__ = __turbopack_context__.i("[externals]/sharp [external] (sharp, cjs, [project]/node_modules/sharp)");
var __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$garment$2d$dna$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/src/lib/garment-dna.ts [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$prompts$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/src/lib/prompts.ts [app-route] (ecmascript)");
;
;
;
;
;
;
;
;
;
// ── View pose instructions (0°, 90°, 180°, 270°) ─────────────────────────────
const VIEW_POSES = {
    front: 'FRONT VIEW (0°): Model faces camera directly. Face visible — cool confident composure, lips TOGETHER (no teeth visible), chin slightly up, eyes on camera. Arms relaxed at sides or hands lightly at hips. Feet hip-width apart with slight weight shift.',
    right: 'RIGHT PROFILE VIEW (90°): The model has rotated 90° so their RIGHT SHOULDER points directly toward the camera. The model\'s face looks to the RIGHT (away from camera). Only the right side of the body is visible — the left arm, left leg, and left side of the torso are hidden behind the body. The camera sees the right side silhouette of the outfit. Both legs visible in profile.',
    back: 'BACK VIEW (180°): Model faces completely AWAY from the camera. The model\'s back and rear are visible. Face is NOT visible. Arms relaxed at sides. Shows rear construction of garments.',
    left: 'LEFT PROFILE VIEW (270°): The model has rotated 90° so their LEFT SHOULDER points directly toward the camera. The model\'s face looks to the LEFT (away from camera). Only the left side of the body is visible — the right arm, right leg, and right side of the torso are hidden behind the body. The camera sees the left side silhouette of the outfit. Both legs visible in profile.'
};
const VALID_VIEWS = [
    'front',
    'right',
    'back',
    'left'
];
// ── QC constants ──────────────────────────────────────────────────────────────
// Uses Gemini REST API (same key as image generation) — no Vertex AI / OAuth needed
const QC_MODEL = 'gemini-2.5-flash-lite';
const QC_THRESHOLD = 7.0;
const MAX_QC_ATTEMPTS = 3;
function buildDressedBaseQCPrompt(view, outfitLines) {
    const viewDesc = {
        front: 'FRONT VIEW (0°) — model faces camera directly, face fully visible, full frontal',
        right: 'RIGHT SIDE PROFILE (90°) — model\'s RIGHT shoulder points at camera, face looks away to the right, only right side of body is visible, left side hidden',
        back: 'BACK VIEW (180°) — model faces AWAY from camera, back visible, face NOT visible',
        left: 'LEFT SIDE PROFILE (270°) — model\'s LEFT shoulder points at camera, face looks away to the left, only left side of body is visible, right side hidden'
    };
    return `You are QC for a fashion dressed base reference image.

EXPECTED VIEW: ${viewDesc[view]}

EXPECTED OUTFIT (all items must be present):
${outfitLines.join('\n')}

Score each dimension 1-10:

1. VIEW_ANGLE (weight: 2x) — Is the model at exactly the correct angle?
   Front: faces camera directly. Right profile: right side faces camera. Back: faces away. Left profile: left side faces camera.
   Score 9-10 if angle is precisely correct. Score 1-4 if wrong orientation.

2. GARMENT_ACCURACY (weight: 2x) — Are all listed outfit items rendered correctly?
   Correct colors, silhouettes, materials for all items? No substitutions?
   IMPORTANT FOR NON-FRONT VIEWS: Back and profile views naturally hide some garment details (necklines, front logos, front closures, toe shape of shoes). Do NOT penalize for details that are simply not visible from this angle. Judge only what IS visible — overall color, silhouette shape, and material texture. If the garment looks correct in color and shape from this angle, score 8-10 even if you cannot confirm every front-facing detail.

3. NO_INVENTED — Any garments added that are NOT in the outfit list above?
   Score 1 if ANY invented clothing item found.
   IMPORTANT: From back/profile angles, garments may look slightly different than their front reference photo. A baby tee seen from behind may look like a tank top — that is NOT an invented garment. Only flag items that are clearly a DIFFERENT garment entirely (e.g., a jacket when none was specified).

4. BACKGROUND — Warm light grey (#D5D3CC) seamless studio background (G-Star ECOM standard)?
   Score 1 if background is very dark, colored, or has visible objects/reflections.

5. FULL_BODY — Full body visible head to toe without cropping?
   Score 1 if head or feet are cut off.

RESPOND IN EXACT JSON (no markdown, no backticks):
{"view_angle":{"score":0,"note":""},"garment_accuracy":{"score":0,"note":""},"no_invented":{"score":0,"note":""},"background":{"score":0,"note":""},"full_body":{"score":0,"note":""},"overall_score":0,"pass":false,"issues":[]}

Calculate: overall_score = (view_angle*2 + garment_accuracy*2 + no_invented + background + full_body) / 7
Set pass = true if overall_score >= ${QC_THRESHOLD}`;
}
async function runDressedBaseQC(imageData, wardrobeQcRefs, view, outfitLines) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error('GEMINI_API_KEY not set');
    const parts = [];
    // Generated image to evaluate — first
    parts.push({
        inlineData: {
            mimeType: 'image/png',
            data: imageData.toString('base64')
        }
    });
    parts.push({
        text: 'DRESSED BASE IMAGE TO EVALUATE:\n\n'
    });
    // Wardrobe reference images for comparison
    for (const ref of wardrobeQcRefs){
        parts.push({
            inlineData: {
                mimeType: ref.mimeType,
                data: ref.buffer.toString('base64')
            }
        });
        parts.push({
            text: `WARDROBE REFERENCE: ${ref.name}\n\n`
        });
    }
    parts.push({
        text: buildDressedBaseQCPrompt(view, outfitLines)
    });
    // Use Gemini REST API — same endpoint as translation, no Vertex AI / OAuth needed
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${QC_MODEL}:generateContent?key=${apiKey}`;
    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            contents: [
                {
                    role: 'user',
                    parts
                }
            ],
            generationConfig: {
                temperature: 0.2
            }
        })
    });
    if (!response.ok) {
        const errText = await response.text();
        throw new Error(`QC API error ${response.status}: ${errText.substring(0, 200)}`);
    }
    const result = await response.json();
    // Gemini 2.5 Flash is a thinking model — filter out thought parts
    const allParts = result.candidates?.[0]?.content?.parts || [];
    const textContent = allParts.filter((p)=>!p.thought && typeof p.text === 'string').map((p)=>p.text).join('').trim();
    if (!textContent) throw new Error('No QC response from Gemini');
    let qcText = textContent;
    if (qcText.startsWith('```')) {
        qcText = qcText.replace(/^```json?\n?/, '').replace(/\n?```$/, '');
    }
    const qcData = JSON.parse(qcText);
    // Recalculate score server-side to be safe
    const rawScore = (qcData.view_angle?.score ?? 0) * 2 + (qcData.garment_accuracy?.score ?? 0) * 2 + (qcData.no_invented?.score ?? 0) + (qcData.background?.score ?? 0) + (qcData.full_body?.score ?? 0);
    const overallScore = Math.round(rawScore / 7 * 10) / 10;
    return {
        score: overallScore,
        pass: overallScore >= QC_THRESHOLD,
        issues: qcData.issues || []
    };
}
async function GET(req) {
    const { searchParams } = new URL(req.url);
    const modelId = searchParams.get('modelId');
    if (!modelId) {
        return __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$server$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["NextResponse"].json({
            error: 'modelId required'
        }, {
            status: 400
        });
    }
    try {
        const bases = await (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$firestore$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["listDressedBases"])(modelId);
        return __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$server$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["NextResponse"].json({
            bases
        });
    } catch (err) {
        console.error('[GenerateDressed GET] error:', err);
        return __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$server$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["NextResponse"].json({
            error: String(err)
        }, {
            status: 500
        });
    }
}
async function POST(req) {
    try {
        const { modelId, wardrobeItemIds, view: viewParam } = await req.json();
        if (!modelId) return __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$server$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["NextResponse"].json({
            error: 'modelId required'
        }, {
            status: 400
        });
        if (!wardrobeItemIds || Object.keys(wardrobeItemIds).length === 0) {
            return __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$server$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["NextResponse"].json({
                error: 'wardrobeItemIds required (at least one item)'
            }, {
                status: 400
            });
        }
        const view = VALID_VIEWS.includes(viewParam) ? viewParam : 'front';
        const wardrobeHash = (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$wardrobe$2d$hash$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["computeWardrobeHash"])(wardrobeItemIds);
        console.log(`[GenerateDressed] model=${modelId} hash=${wardrobeHash} view=${view}`);
        // 1. Load model card
        const modelDoc = await (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$firestore$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["getModel"])(modelId);
        if (!modelDoc) return __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$server$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["NextResponse"].json({
            error: 'Model not found'
        }, {
            status: 404
        });
        const modelData = modelDoc;
        const modelGender = modelData.gender || 'female';
        const referenceImages = [];
        // Model card as identity anchor
        if (modelData.cardImageUrl) {
            const cleanUrl = modelData.cardImageUrl.split('?')[0];
            const cardBuffer = await (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$gcs$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["downloadGarmentImage"])(cleanUrl);
            referenceImages.push({
                buffer: cardBuffer,
                mimeType: 'image/png',
                label: `MODEL IDENTITY REFERENCE — the generated image MUST be this EXACT person. Same face, same hair color and length, same skin tone, same body type. Do NOT alter any physical attribute.`
            });
            console.log(`[GenerateDressed] Model card loaded for ${modelId}`);
        }
        // 2. Load wardrobe items — build outfit lines AND QC reference list
        const wardrobeItemNames = {};
        const outfitLines = [];
        const garmentDnaLines = [];
        const wardrobeQcRefs = [];
        let refIdx = 2; // Image 1 = model card
        const sortedEntries = Object.entries(wardrobeItemIds).filter(([, id])=>id).sort(([a], [b])=>a.localeCompare(b));
        for (const [category, itemId] of sortedEntries){
            const item = await (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$firestore$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["getWardrobeItem"])(itemId);
            if (!item) {
                console.warn(`[GenerateDressed] Wardrobe item not found: ${category}/${itemId}`);
                continue;
            }
            const itemData = item;
            wardrobeItemNames[category] = itemData.name;
            // Track open shoes for post-gen foot resize
            if (category.toLowerCase() === 'shoes' && itemData.openShoes) {
                wardrobeItemNames.__hasOpenShoes = true;
                console.log(`[GenerateDressed] Open shoes detected: "${itemData.name}" — foot resize will apply after generation`);
            }
            let outfitLine = `${category.toUpperCase()}: "${itemData.name}" — reference image ${refIdx} shows this exact item.`;
            if (itemData.description) outfitLine += ` STYLING: ${itemData.description}`;
            outfitLines.push(outfitLine);
            const itemName = itemData.name || '';
            const dnaMatch = (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$garment$2d$dna$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["getGarmentDNA"])(itemName);
            if (dnaMatch) {
                garmentDnaLines.push(`\n--- ${category.toUpperCase()} PRODUCT DETAILS (${dnaMatch.styleName}) ---\n${dnaMatch.dna}`);
                console.log(`[GenerateDressed] Garment DNA found for ${itemName}: ${dnaMatch.styleName}`);
            }
            if (itemData.imageUrls?.length > 0) {
                const buf = await (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$gcs$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["downloadGarmentImage"])(itemData.imageUrls[0]);
                const resized = await (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$zone$2d$grids$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["resizeForFeed"])(buf, 900);
                referenceImages.push({
                    buffer: resized,
                    mimeType: 'image/jpeg',
                    label: `WARDROBE ITEM — ${category.toUpperCase()}: "${itemData.name}". The model wears THIS EXACT item — copy color, material, silhouette, sole shape, and all details precisely.${itemData.description ? ' ' + itemData.description : ''}`
                });
                // Also store for QC comparison
                wardrobeQcRefs.push({
                    buffer: resized,
                    mimeType: 'image/jpeg',
                    name: `${category}: ${itemData.name}`
                });
                refIdx++;
            }
        }
        if (outfitLines.length === 0) {
            return __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$server$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["NextResponse"].json({
                error: 'No valid wardrobe items found'
            }, {
                status: 400
            });
        }
        // 3. Detect uncovered zones — fill with neutral safe clothing
        const sortedCategories = sortedEntries.map(([cat])=>cat.toLowerCase());
        const hasLowerBody = sortedCategories.some((c)=>[
                'pants',
                'jeans',
                'shorts',
                'skirt',
                'trousers'
            ].includes(c));
        const hasUpperBody = sortedCategories.some((c)=>[
                'jacket',
                'shirt',
                'top',
                'blouse',
                'coat',
                'bomber',
                'overshirt',
                'vest'
            ].includes(c));
        let uncoveredZoneRules = '';
        if (!hasLowerBody) {
            uncoveredZoneRules += `\n- LOWER BODY: SHORT black compression shorts — these are VERY SHORT, ending at MID-THIGH (like men's underwear boxer briefs, NOT cycling shorts, NOT leggings, NOT knee-length). Maximum 15cm inseam. The KNEES, SHINS, AND CALVES are completely BARE SKIN. If you generate anything longer than mid-thigh you have FAILED. NO leggings. NO capris. NO knee-length shorts. JUST short boxer-brief-style compression shorts and bare legs below.`;
        }
        if (!hasUpperBody) {
            uncoveredZoneRules += `\n- UPPER BODY: The model wears a plain white fitted cotton t-shirt — simple, clean, no logos or branding. Neutral basic only.`;
        }
        // 4. Build view-specific pose instruction
        const viewPoseRule = `- VIEW: ${VIEW_POSES[view]}`;
        // Gender-aware ECOM posing for dressed base
        const ecomPose = modelGender === 'female' ? 'Slight hip tilt, soft knee bend, weight on one leg — feminine and confident. NOT rigid military stance.' : 'Relaxed stance, thumbs hooked in pockets or at sides — masculine and confident.';
        const prompt = `Generate a FULL-BODY fashion reference photograph of this specific model wearing the specified outfit.

MODEL IDENTITY (image 1): This is the EXACT person to generate. Match face, hair, skin tone, body type PRECISELY. Do NOT change any physical attribute.

OUTFIT — the model wears EXACTLY these items and NOTHING ELSE (reference images provided):
${outfitLines.join('\n')}
${uncoveredZoneRules}

CRITICAL PROPORTION RULES:
- 175cm tall fashion model. Head = 1/8.5 of total height.
- Camera: 85mm lens, 5 meters distance, waist height. ZERO wide-angle distortion.
- Feet are SMALL and delicate — EU size 38. Each foot is narrower than the ankle.
- FRAMING: Leave at LEAST 10% empty space BELOW the feet and ABOVE the head. The feet must be FULLY visible including the soles/bottom of the shoes. NEVER crop or clip the feet at the frame edge. If shoes are cut off at the bottom, the image is WRONG.
- WARM LIGHT GREY (#D5D3CC) seamless studio background — G-Star ECOM standard. NOT pure white. Soft natural shadow under feet. NO glass, NO barriers, NO reflections

LIGHTING (G-STAR Feb 2026 DIRECTION): Warm directional studio light with subtle shadow contrast — sculpts the body and garments. Warmer skin tones. NOT flat/clinical/even lighting. Think editorial warmth.

EXPRESSION (G-STAR ECOM STANDARD): Relaxed, confident, approachable. Lips TOGETHER — NO smile showing teeth, NO grinning, NO forced smile. Cool self-assured composure with energy through the eyes. Chin slightly up. Eyes on camera (for front view). NOT blank stare, NOT cold — but NOT a toothy smile either. Think "I know I look good" not "say cheese".

RULES:
- Full body, head to toe visible in frame — NO crop
${viewPoseRule}
- POSING: ${ecomPose}
- Copy each wardrobe item EXACTLY from its reference image — do NOT invent substitutes
- The model wears ONLY the listed wardrobe items plus the neutral base clothing specified above — do NOT add or invent ANY additional clothing
- Do NOT add pants, jeans, or trousers unless explicitly listed above as a wardrobe item
- Do NOT add jackets, shirts, or tops unless explicitly listed above as a wardrobe item
- If boots/shoes are listed: they are worn on the feet, visible below the model's base clothing
- IMPORTANT: The mannequin reference photos show garments on a RAISED STAND — ignore the hem height from the mannequin. Render the actual garment length as described in the styling instructions.
- Do NOT roll up, cuff, or fold the hems of any garment unless the product description explicitly says it has cuffs or turn-ups
${__TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$prompts$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["ECOM_NO_GOS"]}${garmentDnaLines.length > 0 ? '\n\n' + garmentDnaLines.join('\n') : ''}`;
        console.log(`[GenerateDressed] Generating ${view} view with ${referenceImages.length} reference images`);
        // 5. Generate with QC gate — up to MAX_QC_ATTEMPTS retries
        let bestImageData = null;
        let bestMimeType = 'image/png';
        let bestQcScore = 0;
        let qcPassed = false;
        let qcIssues = [];
        const attemptLog = [];
        for(let attempt = 1; attempt <= MAX_QC_ATTEMPTS; attempt++){
            console.log(`[GenerateDressed] Attempt ${attempt}/${MAX_QC_ATTEMPTS} — ${view} view`);
            let genResult;
            try {
                genResult = await (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$vertex$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["generateImage"])({
                    prompt,
                    referenceImages,
                    aspectRatio: '9:16',
                    imageSize: '2K',
                    model: 'gemini-3-pro-image-preview'
                });
            } catch (genErr) {
                const msg = `Attempt ${attempt}: generation failed — ${String(genErr).substring(0, 120)}`;
                console.error(`[GenerateDressed] ${msg}`);
                attemptLog.push(msg);
                if (attempt === MAX_QC_ATTEMPTS && !bestImageData) {
                    return __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$server$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["NextResponse"].json({
                        error: `Generation failed after ${MAX_QC_ATTEMPTS} attempts: ${String(genErr)}`
                    }, {
                        status: 500
                    });
                }
                continue;
            }
            // Run QC scoring
            let qcScore = 0;
            let qcPass = false;
            try {
                const qc = await runDressedBaseQC(genResult.imageData, wardrobeQcRefs, view, outfitLines);
                qcScore = qc.score;
                qcPass = qc.pass;
                qcIssues = qc.issues;
                const logLine = `Attempt ${attempt}: QC score=${qcScore}/10 pass=${qcPass}${qc.issues.length ? ' issues=' + qc.issues.join('; ') : ''}`;
                console.log(`[GenerateDressed] ${logLine}`);
                attemptLog.push(logLine);
            } catch (qcErr) {
                // QC error is non-blocking — treat as passed so generation isn't blocked
                console.warn(`[GenerateDressed] QC error on attempt ${attempt} (non-blocking, treating as pass):`, qcErr);
                qcScore = 0;
                qcPass = true; // Don't block on QC errors
                attemptLog.push(`Attempt ${attempt}: QC error (non-blocking) — ${String(qcErr).substring(0, 80)}`);
            }
            // Keep best result regardless
            if (qcScore > bestQcScore || !bestImageData) {
                bestImageData = genResult.imageData;
                bestMimeType = genResult.mimeType;
                bestQcScore = qcScore;
            }
            if (qcPass) {
                qcPassed = true;
                console.log(`[GenerateDressed] QC passed on attempt ${attempt} with score ${qcScore}/10`);
                break;
            }
            if (attempt < MAX_QC_ATTEMPTS) {
                console.log(`[GenerateDressed] QC failed (${qcScore}/10 < ${QC_THRESHOLD}) — retrying...`);
            } else {
                console.warn(`[GenerateDressed] All ${MAX_QC_ATTEMPTS} attempts failed QC. Best score: ${bestQcScore}/10. Saving best result flagged for review.`);
            }
        }
        if (!bestImageData) {
            return __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$server$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["NextResponse"].json({
                error: 'Generation produced no results'
            }, {
                status: 500
            });
        }
        console.log(`[GenerateDressed] Generation complete (score=${bestQcScore}/10, pass=${qcPassed}), uploading...`);
        // 5b. POST-PROCESS: Foot resize — Sharp resize + Gemini seam heal
        // Gemini often generates feet too large. Apply to ALL dressed bases.
        // But SKIP if feet are already near the frame edge (would make cropping worse).
        const hasOpenShoes = wardrobeItemNames.__hasOpenShoes;
        if (bestImageData) {
            try {
                const fMeta = await (0, __TURBOPACK__imported__module__$5b$externals$5d2f$sharp__$5b$external$5d$__$28$sharp$2c$__cjs$2c$__$5b$project$5d2f$node_modules$2f$sharp$29$__["default"])(bestImageData).metadata();
                const fW = fMeta.width || 1800;
                const fH = fMeta.height || 2400;
                // Sample actual background color from bottom corners (10x10 pixel patches)
                // This avoids hardcoding #D5D3CC and prevents visible canvas patches
                const cornerSize = 10;
                const bottomLeftCorner = await (0, __TURBOPACK__imported__module__$5b$externals$5d2f$sharp__$5b$external$5d$__$28$sharp$2c$__cjs$2c$__$5b$project$5d2f$node_modules$2f$sharp$29$__["default"])(bestImageData).extract({
                    left: 0,
                    top: fH - cornerSize,
                    width: cornerSize,
                    height: cornerSize
                }).raw().toBuffer();
                const bottomRightCorner = await (0, __TURBOPACK__imported__module__$5b$externals$5d2f$sharp__$5b$external$5d$__$28$sharp$2c$__cjs$2c$__$5b$project$5d2f$node_modules$2f$sharp$29$__["default"])(bestImageData).extract({
                    left: fW - cornerSize,
                    top: fH - cornerSize,
                    width: cornerSize,
                    height: cornerSize
                }).raw().toBuffer();
                // Average the corner pixels to get actual background color
                let rSum = 0, gSum = 0, bSum = 0, pxCount = 0;
                for(let i = 0; i < bottomLeftCorner.length; i += 3){
                    rSum += bottomLeftCorner[i];
                    gSum += bottomLeftCorner[i + 1];
                    bSum += bottomLeftCorner[i + 2];
                    pxCount++;
                }
                for(let i = 0; i < bottomRightCorner.length; i += 3){
                    rSum += bottomRightCorner[i];
                    gSum += bottomRightCorner[i + 1];
                    bSum += bottomRightCorner[i + 2];
                    pxCount++;
                }
                const bgR = Math.round(rSum / pxCount);
                const bgG = Math.round(gSum / pxCount);
                const bgB = Math.round(bSum / pxCount);
                console.log(`[GenerateDressed] Sampled background color: rgb(${bgR},${bgG},${bgB})`);
                // Check if feet are near the frame edge — sample a strip at 95% height
                // If there are non-background pixels in the last 3% of the image, feet are clipped — skip resize
                const edgeCheckH = Math.round(fH * 0.03);
                const edgeStrip = await (0, __TURBOPACK__imported__module__$5b$externals$5d2f$sharp__$5b$external$5d$__$28$sharp$2c$__cjs$2c$__$5b$project$5d2f$node_modules$2f$sharp$29$__["default"])(bestImageData).extract({
                    left: Math.round(fW * 0.2),
                    top: fH - edgeCheckH,
                    width: Math.round(fW * 0.6),
                    height: edgeCheckH
                }).raw().toBuffer();
                let nonBgPixels = 0;
                const tolerance = 40; // color distance tolerance
                for(let i = 0; i < edgeStrip.length; i += 3){
                    const dr = Math.abs(edgeStrip[i] - bgR);
                    const dg = Math.abs(edgeStrip[i + 1] - bgG);
                    const db = Math.abs(edgeStrip[i + 2] - bgB);
                    if (dr > tolerance || dg > tolerance || db > tolerance) nonBgPixels++;
                }
                const edgePixelCount = edgeStrip.length / 3;
                const nonBgRatio = nonBgPixels / edgePixelCount;
                if (nonBgRatio > 0.3) {
                    // Feet are clipped at frame edge — DO NOT resize, it would make it worse
                    console.log(`[GenerateDressed] POST5a: SKIP foot resize — feet near frame edge (${Math.round(nonBgRatio * 100)}% non-bg pixels in bottom 3%). Feet may be clipped.`);
                } else {
                    // Safe to resize — feet have margin below them
                    const footFraction = 0.12;
                    const footH = Math.round(fH * footFraction);
                    const footTop = fH - footH;
                    const scaleFactor = hasOpenShoes ? 0.60 : 0.75;
                    const newFootW = Math.round(fW * scaleFactor);
                    const offsetX = Math.round((fW - newFootW) / 2);
                    const footStrip = await (0, __TURBOPACK__imported__module__$5b$externals$5d2f$sharp__$5b$external$5d$__$28$sharp$2c$__cjs$2c$__$5b$project$5d2f$node_modules$2f$sharp$29$__["default"])(bestImageData).extract({
                        left: 0,
                        top: footTop,
                        width: fW,
                        height: footH
                    }).resize(newFootW, footH, {
                        fit: 'fill'
                    }).toBuffer();
                    // Use SAMPLED background color instead of hardcoded
                    const footCanvas = await (0, __TURBOPACK__imported__module__$5b$externals$5d2f$sharp__$5b$external$5d$__$28$sharp$2c$__cjs$2c$__$5b$project$5d2f$node_modules$2f$sharp$29$__["default"])({
                        create: {
                            width: fW,
                            height: footH,
                            channels: 3,
                            background: {
                                r: bgR,
                                g: bgG,
                                b: bgB
                            }
                        }
                    }).jpeg({
                        quality: 98
                    }).toBuffer();
                    const footComposite = await (0, __TURBOPACK__imported__module__$5b$externals$5d2f$sharp__$5b$external$5d$__$28$sharp$2c$__cjs$2c$__$5b$project$5d2f$node_modules$2f$sharp$29$__["default"])(footCanvas).composite([
                        {
                            input: footStrip,
                            left: offsetX,
                            top: 0
                        }
                    ]).jpeg({
                        quality: 98
                    }).toBuffer();
                    const resizedImageData = await (0, __TURBOPACK__imported__module__$5b$externals$5d2f$sharp__$5b$external$5d$__$28$sharp$2c$__cjs$2c$__$5b$project$5d2f$node_modules$2f$sharp$29$__["default"])(bestImageData).composite([
                        {
                            input: footComposite,
                            left: 0,
                            top: footTop
                        }
                    ]).jpeg({
                        quality: 95
                    }).toBuffer();
                    console.log(`[GenerateDressed] POST5a: Sharp foot resize applied (${scaleFactor * 100}% width, bottom ${footFraction * 100}%, bg=rgb(${bgR},${bgG},${bgB}))`);
                    // Step 2: Gemini inpaint to heal the seam
                    const apiKey = process.env.GEMINI_API_KEY;
                    if (apiKey) {
                        const healPrompt = `This fashion photograph has a visible editing seam around the ankle area where the feet were resized. Seamlessly blend and heal the transition area between the legs and feet. Make the ankle-to-foot connection look natural and photorealistic. Keep the feet at their current SMALL size — do NOT enlarge them. The small feet are correct and intentional (EU size 38, delicate fashion model feet). Keep everything else exactly the same — same model, same pose, same outfit. Only fix the visible seam at the ankle area. Fill any gaps with the studio floor background color.`;
                        const healParts = [
                            {
                                inlineData: {
                                    mimeType: 'image/jpeg',
                                    data: resizedImageData.toString('base64')
                                }
                            },
                            {
                                text: healPrompt
                            }
                        ];
                        // Include shoe reference if available
                        for (const ref of wardrobeQcRefs){
                            if (ref.name.toLowerCase().includes('shoes') || ref.name.toLowerCase().includes('sandal') || ref.name.toLowerCase().includes('boot')) {
                                healParts.splice(1, 0, {
                                    inlineData: {
                                        mimeType: ref.mimeType,
                                        data: ref.buffer.toString('base64')
                                    }
                                }, {
                                    text: `Reference: this is the correct shoe/boot design. Keep this design but at the current small size.\n\n`
                                });
                                break;
                            }
                        }
                        const healUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro-image-preview:generateContent?key=${apiKey}`;
                        const healResponse = await fetch(healUrl, {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json'
                            },
                            body: JSON.stringify({
                                contents: [
                                    {
                                        role: 'user',
                                        parts: healParts
                                    }
                                ],
                                generationConfig: {
                                    responseModalities: [
                                        'IMAGE'
                                    ],
                                    imageConfig: {
                                        aspectRatio: '9:16',
                                        imageSize: '2K'
                                    }
                                }
                            })
                        });
                        if (healResponse.ok) {
                            const healResult = await healResponse.json();
                            const healCandidate = healResult.candidates?.[0];
                            if (healCandidate?.content?.parts) {
                                for (const part of healCandidate.content.parts){
                                    if (part.inlineData) {
                                        bestImageData = Buffer.from(part.inlineData.data, 'base64');
                                        bestMimeType = part.inlineData.mimeType || 'image/png';
                                        console.log(`[GenerateDressed] POST5b: Gemini seam heal successful`);
                                        break;
                                    }
                                }
                            } else {
                                console.warn(`[GenerateDressed] POST5b: Gemini seam heal returned no image, using Sharp-only result`);
                                bestImageData = resizedImageData;
                            }
                        } else {
                            console.warn(`[GenerateDressed] POST5b: Gemini seam heal failed (${healResponse.status}), using Sharp-only result`);
                            bestImageData = resizedImageData;
                        }
                    } else {
                        console.warn(`[GenerateDressed] POST5b: No API key for seam heal, using Sharp-only result`);
                        bestImageData = resizedImageData;
                    }
                }
            } catch (footErr) {
                console.error(`[GenerateDressed] Foot resize failed:`, footErr);
            }
            if (hasOpenShoes) delete wardrobeItemNames.__hasOpenShoes;
        }
        // 6. Upload to GCS
        const imageUrl = await (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$gcs$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["uploadDressedBaseImage"])(modelId, wardrobeHash, view, bestImageData);
        console.log(`[GenerateDressed] Uploaded: ${imageUrl}`);
        // 7. Store in Firestore with QC metadata
        const docId = await (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$firestore$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["createDressedBase"])({
            modelId,
            wardrobeItemIds,
            wardrobeHash,
            view,
            imageUrl,
            wardrobeItemNames,
            qcScore: bestQcScore,
            qcPass: qcPassed
        });
        console.log(`[GenerateDressed] Saved as ${docId} (qcPass=${qcPassed}, qcScore=${bestQcScore}/10, attempts=${attemptLog.length})`);
        return __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$server$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["NextResponse"].json({
            success: true,
            dressedBaseId: docId,
            imageUrl,
            wardrobeHash,
            wardrobeItemNames,
            qcScore: bestQcScore,
            qcPass: qcPassed,
            qcIssues,
            attemptLog
        });
    } catch (error) {
        console.error('[GenerateDressed POST] error:', error);
        return __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$server$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["NextResponse"].json({
            error: String(error)
        }, {
            status: 500
        });
    }
}
async function DELETE(req) {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');
    if (!id) {
        return __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$server$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["NextResponse"].json({
            error: 'id query param required'
        }, {
            status: 400
        });
    }
    try {
        await (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$firestore$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["deleteDressedBase"])(id);
        return __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$server$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["NextResponse"].json({
            success: true
        });
    } catch (err) {
        console.error('[GenerateDressed DELETE] error:', err);
        return __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$server$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["NextResponse"].json({
            error: String(err)
        }, {
            status: 500
        });
    }
}
}),
];

//# sourceMappingURL=%5Broot-of-the-server%5D__0e3367bd._.js.map