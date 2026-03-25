const functions = require('firebase-functions');
const admin = require('firebase-admin');
const axios = require('axios');
const { defineSecret } = require('firebase-functions/params');

admin.initializeApp();

// Define secrets (new method)
const cloudinaryCloudName = defineSecret('CLOUDINARY_CLOUD_NAME');
const cloudinaryUploadPreset = defineSecret('CLOUDINARY_UPLOAD_PRESET');
const deepaiApiKey = defineSecret('DEEPAI_API_KEY');

// ==================== CLOUDINARY UPLOAD ====================
exports.uploadPhoto = functions
  .runWith({ secrets: [cloudinaryCloudName, cloudinaryUploadPreset] })
  .https.onCall(async (data, context) => {
    if (!context.auth) {
      throw new functions.https.HttpsError('unauthenticated', 'User must be logged in');
    }

    const { photoBase64 } = data;

    if (!photoBase64) {
      throw new functions.https.HttpsError('invalid-argument', 'Photo data is required');
    }

    try {
      const cloudinaryResponse = await axios.post(
        `https://api.cloudinary.com/v1_1/${cloudinaryCloudName.value()}/image/upload`,
        {
          file: photoBase64,
          upload_preset: cloudinaryUploadPreset.value(),
        }
      );

      return { url: cloudinaryResponse.data.secure_url };
    } catch (error) {
      console.error('Cloudinary upload error:', error);
      throw new functions.https.HttpsError('internal', 'Upload failed');
    }
  });

// ==================== AI VERIFICATION ====================
exports.verifyPhotoNSFW = functions
  .runWith({ secrets: [deepaiApiKey] })
  .https.onCall(async (data, context) => {
    if (!context.auth) {
      throw new functions.https.HttpsError('unauthenticated', 'User must be logged in');
    }

    const { imageUrl } = data;

    try {
      const response = await axios.post(
        'https://api.deepai.org/api/nsfw-detector',
        { image: imageUrl },
        {
          headers: {
            'api-key': deepaiApiKey.value(),
            'Content-Type': 'application/json',
          },
        }
      );

      const nsfwScore = response.data.output.nsfw_score;
      return {
        isAppropriate: nsfwScore <= 0.6,
        score: nsfwScore,
      };
    } catch (error) {
      console.error('NSFW check error:', error);
      throw new functions.https.HttpsError('internal', 'Verification failed');
    }
  });

// Age Estimation
exports.estimateAge = functions
  .runWith({ secrets: [deepaiApiKey] })
  .https.onCall(async (data, context) => {
    if (!context.auth) {
      throw new functions.https.HttpsError('unauthenticated', 'User must be logged in');
    }

    const { imageUrl } = data;

    try {
      const response = await axios.post(
        'https://api.deepai.org/api/demographic-recognition',
        { image: imageUrl },
        {
          headers: {
            'api-key': deepaiApiKey.value(),
            'Content-Type': 'application/json',
          },
        }
      );

      const persons = response.data.output?.persons || [];
      if (persons.length > 0) {
        return { estimatedAge: persons[0].age };
      }
      return { estimatedAge: null };
    } catch (error) {
      console.error('Age estimation error:', error);
      return { estimatedAge: null };
    }
  });

// Body Type Detection
exports.detectBodyType = functions
  .runWith({ secrets: [deepaiApiKey] })
  .https.onCall(async (data, context) => {
    if (!context.auth) {
      throw new functions.https.HttpsError('unauthenticated', 'User must be logged in');
    }

    const { imageUrl } = data;

    try {
      const response = await axios.post(
        'https://api.deepai.org/api/densecap',
        { image: imageUrl },
        {
          headers: {
            'api-key': deepaiApiKey.value(),
            'Content-Type': 'application/json',
          },
        }
      );

      const captions = response.data.output?.captions || [];
      const hasFullBody = captions.some(c => 
        c.caption.toLowerCase().includes('person') && 
        (c.caption.toLowerCase().includes('standing') || 
         c.caption.toLowerCase().includes('full'))
      );

      return { isFullBody: hasFullBody };
    } catch (error) {
      console.error('Body detection error:', error);
      return { isFullBody: false };
    }
  });

// ==================== RATE LIMITING ====================
exports.checkRateLimit = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'User must be logged in');
  }

  const { action } = data;
  const userId = context.auth.uid;

  const limits = {
    like: { count: 100, period: 86400000 },
    message: { count: 500, period: 86400000 },
    report: { count: 10, period: 86400000 },
  };

  const limit = limits[action];
  if (!limit) {
    throw new functions.https.HttpsError('invalid-argument', 'Invalid action');
  }

  const rateLimitRef = admin.firestore()
    .collection('rateLimits')
    .doc(`${userId}_${action}`);

  const doc = await rateLimitRef.get();
  const now = Date.now();

  if (!doc.exists) {
    await rateLimitRef.set({
      count: 1,
      firstAction: now,
      lastAction: now,
    });
    return { allowed: true, remaining: limit.count - 1 };
  }

  const data_current = doc.data();
  const timeSinceFirst = now - data_current.firstAction;

  if (timeSinceFirst > limit.period) {
    await rateLimitRef.set({
      count: 1,
      firstAction: now,
      lastAction: now,
    });
    return { allowed: true, remaining: limit.count - 1 };
  }

  if (data_current.count >= limit.count) {
    return {
      allowed: false,
      remaining: 0,
      resetIn: limit.period - timeSinceFirst,
    };
  }

  await rateLimitRef.update({
    count: admin.firestore.FieldValue.increment(1),
    lastAction: now,
  });

  return {
    allowed: true,
    remaining: limit.count - data_current.count - 1,
  };
});

// ==================== PUSH NOTIFICATIONS ====================
exports.sendNotification = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'User must be logged in');
  }

  const { token, title, body, data: notifData } = data;

  if (!token) {
    throw new functions.https.HttpsError('invalid-argument', 'Push token required');
  }

  try {
    await admin.messaging().send({
      token,
      notification: { title, body },
      data: notifData || {},
    });

    return { success: true };
  } catch (error) {
    console.error('Notification error:', error);
    return { success: false, error: error.message };
  }
});

// ==================== CLEANUP ====================
exports.cleanupDeletedUser = functions.auth.user().onDelete(async (user) => {
  const userId = user.uid;
  const db = admin.firestore();
  const batch = db.batch();

  batch.delete(db.collection('users').doc(userId));

  const likesQuery = await db.collection('likes')
    .where('fromUserId', '==', userId)
    .get();
  likesQuery.forEach(doc => batch.delete(doc.ref));

  const likesQuery2 = await db.collection('likes')
    .where('toUserId', '==', userId)
    .get();
  likesQuery2.forEach(doc => batch.delete(doc.ref));

  const ratingsQuery = await db.collection('ratings')
    .where('raterId', '==', userId)
    .get();
  ratingsQuery.forEach(doc => batch.delete(doc.ref));

  const reportsQuery = await db.collection('reports')
    .where('reporterId', '==', userId)
    .get();
  reportsQuery.forEach(doc => batch.delete(doc.ref));

  await batch.commit();
  console.log(`Cleaned up data for deleted user: ${userId}`);
});"use strict";

/**
 * MyArchetype — Cloud Functions
 *
 * Server-side logic for photo uploads (Cloudinary), AI content moderation
 * (DeepAI), token-bucket rate limiting, FCM push notifications, and
 * automatic cleanup of orphaned data when a user deletes their account.
 *
 * • Callable functions use the Cloud Functions **Gen 2** API.
 * • The auth-deletion trigger uses the **Gen 1** API (auth event triggers
 *   are not yet available in Gen 2).
 */

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const functions = require("firebase-functions"); // v1 — needed for auth triggers
const { defineSecret } = require("firebase-functions/params");
const admin = require("firebase-admin");
const axios = require("axios");

// ── Initialisation ───────────────────────────────────────────────────────────

admin.initializeApp();
const db = admin.firestore();

// ── Secrets (set via `firebase functions:secrets:set <NAME>`) ────────────────

const cloudinaryCloudName = defineSecret("CLOUDINARY_CLOUD_NAME");
const cloudinaryUploadPreset = defineSecret("CLOUDINARY_UPLOAD_PRESET");
const deepaiApiKey = defineSecret("DEEPAI_API_KEY");

// ── Constants ────────────────────────────────────────────────────────────────

/**
 * Deploy region — matches the Firestore location (eur3 → europe-west1)
 * to minimise cross-region latency.
 *
 * **Client-side requirement:** initialise the Functions SDK with the same
 * region so callable requests are routed correctly:
 * ```ts
 * import { getFunctions } from "firebase/functions";
 * const fns = getFunctions(app, "europe-west1");
 * ```
 */
const REGION = "europe-west1";

/** Timeout applied to all outbound HTTP calls (Cloudinary, DeepAI). */
const HTTP_TIMEOUT_MS = 30_000;

/** Max accepted base-64 payload length (≈ 10 MB decoded). */
const MAX_BASE64_LENGTH = 15 * 1024 * 1024;

/** NSFW score at or below which a photo is considered appropriate. */
const NSFW_THRESHOLD = 0.6;

/** Firestore batch-write ceiling (official max is 500; headroom kept). */
const BATCH_LIMIT = 400;

/** Per-action daily rate limits. */
const RATE_LIMITS = {
  like:    { count: 100, periodMs: 86_400_000 },
  message: { count: 500, periodMs: 86_400_000 },
  report:  { count:  10, periodMs: 86_400_000 },
};

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Throws `unauthenticated` if the request carries no auth context.
 * @returns {object} The verified auth payload (`{ uid, token }`).
 */
function requireAuth(request) {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Authentication required.");
  }
  return request.auth;
}

/**
 * Throws `invalid-argument` if `value` is not a non-empty string.
 * @param {unknown} value
 * @param {string}  label — used in the error message.
 */
function requireString(value, label) {
  if (!value || typeof value !== "string") {
    throw new HttpsError("invalid-argument", `${label} must be a non-empty string.`);
  }
}

/**
 * Deletes every document matched by `query` in Firestore-safe batches.
 * @param {FirebaseFirestore.Query} query
 * @returns {Promise<number>} Total documents deleted.
 */
async function deleteQueryBatched(query) {
  let totalDeleted = 0;

  while (true) {
    const snapshot = await query.limit(BATCH_LIMIT).get();
    if (snapshot.empty) break;

    const batch = db.batch();
    snapshot.docs.forEach((doc) => batch.delete(doc.ref));
    await batch.commit();
    totalDeleted += snapshot.size;

    if (snapshot.size < BATCH_LIMIT) break;
  }

  return totalDeleted;
}

/**
 * POSTs to a DeepAI endpoint using the project's stored API key.
 * @param {string} endpoint — DeepAI API path (e.g. "nsfw-detector").
 * @param {object} payload  — request body.
 * @returns {Promise<object>} Parsed response body.
 */
async function callDeepAI(endpoint, payload) {
  const { data } = await axios.post(
    `https://api.deepai.org/api/${endpoint}`,
    payload,
    {
      headers: {
        "api-key": deepaiApiKey.value(),
        "Content-Type": "application/json",
      },
      timeout: HTTP_TIMEOUT_MS,
    },
  );
  return data;
}

// ═══════════════════════════════════════════════════════════════════════════════
//  PHOTO UPLOAD
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Uploads a base-64-encoded photo to Cloudinary via an unsigned preset.
 *
 * @param {string} request.data.photoBase64 — data-URI or raw base-64 string.
 * @returns {{ url: string }} The HTTPS URL of the uploaded image.
 */
exports.uploadPhoto = onCall(
  {
    region: REGION,
    secrets: [cloudinaryCloudName, cloudinaryUploadPreset],
    memory: "256MiB",
    timeoutSeconds: 60,
    // enforceAppCheck: true, // Enable after setting up Firebase App Check
  },
  async (request) => {
    requireAuth(request);

    const { photoBase64 } = request.data ?? {};
    requireString(photoBase64, "photoBase64");

    if (photoBase64.length > MAX_BASE64_LENGTH) {
      throw new HttpsError("invalid-argument", "Image exceeds the 10 MB size limit.");
    }

    try {
      const { data } = await axios.post(
        `https://api.cloudinary.com/v1_1/${cloudinaryCloudName.value()}/image/upload`,
        {
          file: photoBase64,
          upload_preset: cloudinaryUploadPreset.value(),
        },
        { timeout: HTTP_TIMEOUT_MS },
      );

      if (!data.secure_url) {
        throw new Error("Cloudinary response missing secure_url.");
      }

      return { url: data.secure_url };
    } catch (error) {
      console.error("Cloudinary upload failed:", error.message);
      throw new HttpsError("internal", "Photo upload failed. Please try again.");
    }
  },
);

// ═══════════════════════════════════════════════════════════════════════════════
//  AI VERIFICATION
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Checks whether an image is NSFW using DeepAI's content-moderation API.
 *
 * @param {string} request.data.imageUrl — public URL of the image.
 * @returns {{ isAppropriate: boolean, score: number }}
 */
exports.verifyPhotoNSFW = onCall(
  {
    region: REGION,
    secrets: [deepaiApiKey],
    timeoutSeconds: 60,
  },
  async (request) => {
    requireAuth(request);

    const { imageUrl } = request.data ?? {};
    requireString(imageUrl, "imageUrl");

    try {
      const result = await callDeepAI("nsfw-detector", { image: imageUrl });
      const nsfwScore = result.output?.nsfw_score ?? 1;

      return {
        isAppropriate: nsfwScore <= NSFW_THRESHOLD,
        score: nsfwScore,
      };
    } catch (error) {
      console.error("NSFW verification failed:", error.message);
      throw new HttpsError("internal", "Content verification failed.");
    }
  },
);

/**
 * Estimates the age of the primary face in an image.
 * Returns `{ estimatedAge: null }` on failure — callers should treat age
 * estimation as best-effort, not a hard gate.
 *
 * @param {string} request.data.imageUrl
 * @returns {{ estimatedAge: number | null }}
 */
exports.estimateAge = onCall(
  {
    region: REGION,
    secrets: [deepaiApiKey],
    timeoutSeconds: 60,
  },
  async (request) => {
    requireAuth(request);

    const { imageUrl } = request.data ?? {};
    requireString(imageUrl, "imageUrl");

    try {
      const result = await callDeepAI("demographic-recognition", { image: imageUrl });
      const persons = result.output?.persons ?? [];

      return {
        estimatedAge: persons.length > 0 ? (persons[0].age ?? null) : null,
      };
    } catch (error) {
      console.error("Age estimation failed:", error.message);
      return { estimatedAge: null };
    }
  },
);

/**
 * Attempts to detect whether an image shows a full-body shot using DeepAI's
 * dense-captioning model. Returns `{ isFullBody: false }` on failure.
 *
 * @param {string} request.data.imageUrl
 * @returns {{ isFullBody: boolean }}
 */
exports.detectBodyType = onCall(
  {
    region: REGION,
    secrets: [deepaiApiKey],
    timeoutSeconds: 60,
  },
  async (request) => {
    requireAuth(request);

    const { imageUrl } = request.data ?? {};
    requireString(imageUrl, "imageUrl");

    try {
      const result = await callDeepAI("densecap", { image: imageUrl });
      const captions = result.output?.captions ?? [];

      const isFullBody = captions.some((c) => {
        const text = (c.caption ?? "").toLowerCase();
        return (
          text.includes("person") &&
          (text.includes("standing") || text.includes("full"))
        );
      });

      return { isFullBody };
    } catch (error) {
      console.error("Body-type detection failed:", error.message);
      return { isFullBody: false };
    }
  },
);

// ═══════════════════════════════════════════════════════════════════════════════
//  RATE LIMITING
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Atomic, transaction-based sliding-window rate limiter.
 *
 * @param {string} request.data.action — one of `"like"`, `"message"`, `"report"`.
 * @returns {{ allowed: boolean, remaining: number, resetIn?: number }}
 */
exports.checkRateLimit = onCall(
  { region: REGION },
  async (request) => {
    const { uid } = requireAuth(request);
    const { action } = request.data ?? {};

    if (!action || typeof action !== "string" || !(action in RATE_LIMITS)) {
      throw new HttpsError(
        "invalid-argument",
        `action must be one of: ${Object.keys(RATE_LIMITS).join(", ")}.`,
      );
    }

    const limit = RATE_LIMITS[action];
    const ref = db.collection("rateLimits").doc(`${uid}_${action}`);
    const now = Date.now();

    return db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);

      // First action in this window
      if (!snap.exists) {
        tx.set(ref, { count: 1, firstAction: now, lastAction: now });
        return { allowed: true, remaining: limit.count - 1 };
      }

      const current = snap.data();
      const elapsed = now - current.firstAction;

      // Window expired — reset
      if (elapsed > limit.periodMs) {
        tx.set(ref, { count: 1, firstAction: now, lastAction: now });
        return { allowed: true, remaining: limit.count - 1 };
      }

      // Limit reached
      if (current.count >= limit.count) {
        return {
          allowed: false,
          remaining: 0,
          resetIn: limit.periodMs - elapsed,
        };
      }

      // Increment
      tx.update(ref, {
        count: admin.firestore.FieldValue.increment(1),
        lastAction: now,
      });

      return {
        allowed: true,
        remaining: limit.count - current.count - 1,
      };
    });
  },
);

// ═══════════════════════════════════════════════════════════════════════════════
//  PUSH NOTIFICATIONS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Sends an FCM push notification to another user.
 *
 * The recipient's push token is looked up **server-side** from Firestore so
 * that raw FCM tokens are never exposed to — or accepted from — the client.
 *
 * **Breaking change vs. v1:** this function now accepts `targetUserId`
 * instead of a raw `token`. Update client call-sites accordingly.
 *
 * @param {string}  request.data.targetUserId — UID of the recipient.
 * @param {string}  request.data.title        — notification title.
 * @param {string}  [request.data.body]       — notification body text.
 * @param {Object}  [request.data.data]       — optional data payload (string values).
 * @returns {{ success: boolean, reason?: string }}
 */
exports.sendNotification = onCall(
  { region: REGION },
  async (request) => {
    requireAuth(request);

    const requestData = request.data ?? {};
    const { targetUserId, title, body } = requestData;
    const notifPayload = requestData.data ?? {};

    requireString(targetUserId, "targetUserId");
    requireString(title, "title");

    // Look up the recipient's push token server-side
    const targetSnap = await db.collection("users").doc(targetUserId).get();

    if (!targetSnap.exists) {
      throw new HttpsError("not-found", "Target user not found.");
    }

    const token = targetSnap.data()?.pushToken;

    if (!token) {
      return { success: false, reason: "no_push_token" };
    }

    try {
      await admin.messaging().send({
        token,
        notification: { title, ...(body ? { body } : {}) },
        data: notifPayload,
      });

      return { success: true };
    } catch (error) {
      // Stale or revoked token — remove it to prevent repeated failures
      const invalidTokenCodes = [
        "messaging/invalid-registration-token",
        "messaging/registration-token-not-registered",
      ];

      if (invalidTokenCodes.includes(error.code)) {
        await db
          .collection("users")
          .doc(targetUserId)
          .update({ pushToken: admin.firestore.FieldValue.delete() });
      }

      console.error("FCM send failed:", error.code ?? error.message);
      return { success: false, reason: "send_failed" };
    }
  },
);

// ═══════════════════════════════════════════════════════════════════════════════
//  ACCOUNT DELETION CLEANUP
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Triggered automatically by Firebase Auth when a user account is deleted.
 * Removes the user's profile and **all** associated data across every
 * known collection.
 *
 * Uses the Gen 1 API — auth event triggers are not available in Gen 2.
 */
exports.cleanupDeletedUser = functions
  .runWith({ timeoutSeconds: 540, memory: "512MB" })
  .auth.user()
  .onDelete(async (user) => {
    const userId = user.uid;
    let totalDeleted = 0;

    // 1. Delete user profile document
    await db.collection("users").doc(userId).delete();
    totalDeleted++;

    // 2. Batch-delete documents that reference this user by field value
    const fieldQueries = [
      db.collection("likes").where("fromUserId", "==", userId),
      db.collection("likes").where("toUserId", "==", userId),
      db.collection("ratings").where("raterId", "==", userId),
      db.collection("ratings").where("ratedUserId", "==", userId),
      db.collection("reports").where("reporterId", "==", userId),
      db.collection("profileViews").where("viewerId", "==", userId),
      db.collection("profileViews").where("viewedUserId", "==", userId),
      db.collection("blockedUsers").where("blockerId", "==", userId),
      db.collection("blockedUsers").where("blockedUserId", "==", userId),
      db.collection("referrals").where("referrerId", "==", userId),
      db.collection("bugReports").where("userId", "==", userId),
    ];

    for (const query of fieldQueries) {
      totalDeleted += await deleteQueryBatched(query);
    }

    // 3. Delete known rate-limit documents (deterministic IDs)
    const rateLimitBatch = db.batch();
    for (const action of Object.keys(RATE_LIMITS)) {
      rateLimitBatch.delete(
        db.collection("rateLimits").doc(`${userId}_${action}`),
      );
    }
    await rateLimitBatch.commit();

    // 4. Delete chats *and their subcollections* (messages, typing).
    //    Chat IDs use the format "uid1_uid2". We can only efficiently query
    //    chats where this user's UID is the lexicographically-first segment.
    //
    //    TODO: For exhaustive cleanup, add a `participants` array field to
    //    chat documents and query with `array-contains` instead.
    const chatSnapshot = await db
      .collection("chats")
      .where(
        admin.firestore.FieldPath.documentId(),
        ">=",
        `${userId}_`,
      )
      .where(
        admin.firestore.FieldPath.documentId(),
        "<",
        `${userId}_\uf8ff`,
      )
      .get();

    for (const chatDoc of chatSnapshot.docs) {
      // recursiveDelete removes the document *and* all nested subcollections
      await db.recursiveDelete(chatDoc.ref);
      totalDeleted++;
    }

    console.log(
      `Cleaned up ${totalDeleted} document(s) "use strict";

/**
 * MyArchetype — Cloud Functions
 *
 * Server-side logic for photo uploads (Cloudinary), AI content moderation
 * (DeepAI), token-bucket rate limiting, FCM push notifications, and
 * automatic cleanup of orphaned data when a user deletes their account.
 *
 * • Callable functions use the Cloud Functions **Gen 2** API.
 * • The auth-deletion trigger uses the **Gen 1** API (auth event triggers
 *   are not yet available in Gen 2).
 */

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const functions = require("firebase-functions"); // v1 — needed for auth triggers
const { defineSecret } = require("firebase-functions/params");
const admin = require("firebase-admin");
const axios = require("axios");

// ── Initialisation ───────────────────────────────────────────────────────────

admin.initializeApp();
const db = admin.firestore();

// ── Secrets (set via `firebase functions:secrets:set <NAME>`) ────────────────

const cloudinaryCloudName = defineSecret("CLOUDINARY_CLOUD_NAME");
const cloudinaryUploadPreset = defineSecret("CLOUDINARY_UPLOAD_PRESET");
const deepaiApiKey = defineSecret("DEEPAI_API_KEY");

// ── Constants ────────────────────────────────────────────────────────────────

/**
 * Deploy region — matches the Firestore location (eur3 → europe-west1)
 * to minimise cross-region latency.
 *
 * **Client-side requirement:** initialise the Functions SDK with the same
 * region so callable requests are routed correctly:
 * ```ts
 * import { getFunctions } from "firebase/functions";
 * const fns = getFunctions(app, "europe-west1");
 * ```
 */
const REGION = "europe-west1";

/** Timeout applied to all outbound HTTP calls (Cloudinary, DeepAI). */
const HTTP_TIMEOUT_MS = 30_000;

/** Max accepted base-64 payload length (≈ 10 MB decoded). */
const MAX_BASE64_LENGTH = 15 * 1024 * 1024;

/** NSFW score at or below which a photo is considered appropriate. */
const NSFW_THRESHOLD = 0.6;

/** Firestore batch-write ceiling (official max is 500; headroom kept). */
const BATCH_LIMIT = 400;

/** Per-action daily rate limits. */
const RATE_LIMITS = {
  like:    { count: 100, periodMs: 86_400_000 },
  message: { count: 500, periodMs: 86_400_000 },
  report:  { count:  10, periodMs: 86_400_000 },
};

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Throws `unauthenticated` if the request carries no auth context.
 * @returns {object} The verified auth payload (`{ uid, token }`).
 */
function requireAuth(request) {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Authentication required.");
  }
  return request.auth;
}

/**
 * Throws `invalid-argument` if `value` is not a non-empty string.
 * @param {unknown} value
 * @param {string}  label — used in the error message.
 */
function requireString(value, label) {
  if (!value || typeof value !== "string") {
    throw new HttpsError("invalid-argument", `${label} must be a non-empty string.`);
  }
}

/**
 * Deletes every document matched by `query` in Firestore-safe batches.
 * @param {FirebaseFirestore.Query} query
 * @returns {Promise<number>} Total documents deleted.
 */
async function deleteQueryBatched(query) {
  let totalDeleted = 0;

  while (true) {
    const snapshot = await query.limit(BATCH_LIMIT).get();
    if (snapshot.empty) break;

    const batch = db.batch();
    snapshot.docs.forEach((doc) => batch.delete(doc.ref));
    await batch.commit();
    totalDeleted += snapshot.size;

    if (snapshot.size < BATCH_LIMIT) break;
  }

  return totalDeleted;
}

/**
 * POSTs to a DeepAI endpoint using the project's stored API key.
 * @param {string} endpoint — DeepAI API path (e.g. "nsfw-detector").
 * @param {object} payload  — request body.
 * @returns {Promise<object>} Parsed response body.
 */
async function callDeepAI(endpoint, payload) {
  const { data } = await axios.post(
    `https://api.deepai.org/api/${endpoint}`,
    payload,
    {
      headers: {
        "api-key": deepaiApiKey.value(),
        "Content-Type": "application/json",
      },
      timeout: HTTP_TIMEOUT_MS,
    },
  );
  return data;
}

// ═══════════════════════════════════════════════════════════════════════════════
//  PHOTO UPLOAD
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Uploads a base-64-encoded photo to Cloudinary via an unsigned preset.
 *
 * @param {string} request.data.photoBase64 — data-URI or raw base-64 string.
 * @returns {{ url: string }} The HTTPS URL of the uploaded image.
 */
exports.uploadPhoto = onCall(
  {
    region: REGION,
    secrets: [cloudinaryCloudName, cloudinaryUploadPreset],
    memory: "256MiB",
    timeoutSeconds: 60,
    // enforceAppCheck: true, // Enable after setting up Firebase App Check
  },
  async (request) => {
    requireAuth(request);

    const { photoBase64 } = request.data ?? {};
    requireString(photoBase64, "photoBase64");

    if (photoBase64.length > MAX_BASE64_LENGTH) {
      throw new HttpsError("invalid-argument", "Image exceeds the 10 MB size limit.");
    }

    try {
      const { data } = await axios.post(
        `https://api.cloudinary.com/v1_1/${cloudinaryCloudName.value()}/image/upload`,
        {
          file: photoBase64,
          upload_preset: cloudinaryUploadPreset.value(),
        },
        { timeout: HTTP_TIMEOUT_MS },
      );

      if (!data.secure_url) {
        throw new Error("Cloudinary response missing secure_url.");
      }

      return { url: data.secure_url };
    } catch (error) {
      console.error("Cloudinary upload failed:", error.message);
      throw new HttpsError("internal", "Photo upload failed. Please try again.");
    }
  },
);

// ═══════════════════════════════════════════════════════════════════════════════
//  AI VERIFICATION
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Checks whether an image is NSFW using DeepAI's content-moderation API.
 *
 * @param {string} request.data.imageUrl — public URL of the image.
 * @returns {{ isAppropriate: boolean, score: number }}
 */
exports.verifyPhotoNSFW = onCall(
  {
    region: REGION,
    secrets: [deepaiApiKey],
    timeoutSeconds: 60,
  },
  async (request) => {
    requireAuth(request);

    const { imageUrl } = request.data ?? {};
    requireString(imageUrl, "imageUrl");

    try {
      const result = await callDeepAI("nsfw-detector", { image: imageUrl });
      const nsfwScore = result.output?.nsfw_score ?? 1;

      return {
        isAppropriate: nsfwScore <= NSFW_THRESHOLD,
        score: nsfwScore,
      };
    } catch (error) {
      console.error("NSFW verification failed:", error.message);
      throw new HttpsError("internal", "Content verification failed.");
    }
  },
);

/**
 * Estimates the age of the primary face in an image.
 * Returns `{ estimatedAge: null }` on failure — callers should treat age
 * estimation as best-effort, not a hard gate.
 *
 * @param {string} request.data.imageUrl
 * @returns {{ estimatedAge: number | null }}
 */
exports.estimateAge = onCall(
  {
    region: REGION,
    secrets: [deepaiApiKey],
    timeoutSeconds: 60,
  },
  async (request) => {
    requireAuth(request);

    const { imageUrl } = request.data ?? {};
    requireString(imageUrl, "imageUrl");

    try {
      const result = await callDeepAI("demographic-recognition", { image: imageUrl });
      const persons = result.output?.persons ?? [];

      return {
        estimatedAge: persons.length > 0 ? (persons[0].age ?? null) : null,
      };
    } catch (error) {
      console.error("Age estimation failed:", error.message);
      return { estimatedAge: null };
    }
  },
);

/**
 * Attempts to detect whether an image shows a full-body shot using DeepAI's
 * dense-captioning model. Returns `{ isFullBody: false }` on failure.
 *
 * @param {string} request.data.imageUrl
 * @returns {{ isFullBody: boolean }}
 */
exports.detectBodyType = onCall(
  {
    region: REGION,
    secrets: [deepaiApiKey],
    timeoutSeconds: 60,
  },
  async (request) => {
    requireAuth(request);

    const { imageUrl } = request.data ?? {};
    requireString(imageUrl, "imageUrl");

    try {
      const result = await callDeepAI("densecap", { image: imageUrl });
      const captions = result.output?.captions ?? [];

      const isFullBody = captions.some((c) => {
        const text = (c.caption ?? "").toLowerCase();
        return (
          text.includes("person") &&
          (text.includes("standing") || text.includes("full"))
        );
      });

      return { isFullBody };
    } catch (error) {
      console.error("Body-type detection failed:", error.message);
      return { isFullBody: false };
    }
  },
);

// ═══════════════════════════════════════════════════════════════════════════════
//  RATE LIMITING
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Atomic, transaction-based sliding-window rate limiter.
 *
 * @param {string} request.data.action — one of `"like"`, `"message"`, `"report"`.
 * @returns {{ allowed: boolean, remaining: number, resetIn?: number }}
 */
exports.checkRateLimit = onCall(
  { region: REGION },
  async (request) => {
    const { uid } = requireAuth(request);
    const { action } = request.data ?? {};

    if (!action || typeof action !== "string" || !(action in RATE_LIMITS)) {
      throw new HttpsError(
        "invalid-argument",
        `action must be one of: ${Object.keys(RATE_LIMITS).join(", ")}.`,
      );
    }

    const limit = RATE_LIMITS[action];
    const ref = db.collection("rateLimits").doc(`${uid}_${action}`);
    const now = Date.now();

    return db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);

      // First action in this window
      if (!snap.exists) {
        tx.set(ref, { count: 1, firstAction: now, lastAction: now });
        return { allowed: true, remaining: limit.count - 1 };
      }

      const current = snap.data();
      const elapsed = now - current.firstAction;

      // Window expired — reset
      if (elapsed > limit.periodMs) {
        tx.set(ref, { count: 1, firstAction: now, lastAction: now });
        return { allowed: true, remaining: limit.count - 1 };
      }

      // Limit reached
      if (current.count >= limit.count) {
        return {
          allowed: false,
          remaining: 0,
          resetIn: limit.periodMs - elapsed,
        };
      }

      // Increment
      tx.update(ref, {
        count: admin.firestore.FieldValue.increment(1),
        lastAction: now,
      });

      return {
        allowed: true,
        remaining: limit.count - current.count - 1,
      };
    });
  },
);

// ═══════════════════════════════════════════════════════════════════════════════
//  PUSH NOTIFICATIONS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Sends an FCM push notification to another user.
 *
 * The recipient's push token is looked up **server-side** from Firestore so
 * that raw FCM tokens are never exposed to — or accepted from — the client.
 *
 * **Breaking change vs. v1:** this function now accepts `targetUserId`
 * instead of a raw `token`. Update client call-sites accordingly.
 *
 * @param {string}  request.data.targetUserId — UID of the recipient.
 * @param {string}  request.data.title        — notification title.
 * @param {string}  [request.data.body]       — notification body text.
 * @param {Object}  [request.data.data]       — optional data payload (string values).
 * @returns {{ success: boolean, reason?: string }}
 */
exports.sendNotification = onCall(
  { region: REGION },
  async (request) => {
    requireAuth(request);

    const requestData = request.data ?? {};
    const { targetUserId, title, body } = requestData;
    const notifPayload = requestData.data ?? {};

    requireString(targetUserId, "targetUserId");
    requireString(title, "title");

    // Look up the recipient's push token server-side
    const targetSnap = await db.collection("users").doc(targetUserId).get();

    if (!targetSnap.exists) {
      throw new HttpsError("not-found", "Target user not found.");
    }

    const token = targetSnap.data()?.pushToken;

    if (!token) {
      return { success: false, reason: "no_push_token" };
    }

    try {
      await admin.messaging().send({
        token,
        notification: { title, ...(body ? { body } : {}) },
        data: notifPayload,
      });

      return { success: true };
    } catch (error) {
      // Stale or revoked token — remove it to prevent repeated failures
      const invalidTokenCodes = [
        "messaging/invalid-registration-token",
        "messaging/registration-token-not-registered",
      ];

      if (invalidTokenCodes.includes(error.code)) {
        await db
          .collection("users")
          .doc(targetUserId)
          .update({ pushToken: admin.firestore.FieldValue.delete() });
      }

      console.error("FCM send failed:", error.code ?? error.message);
      return { success: false, reason: "send_failed" };
    }
  },
);

// ═══════════════════════════════════════════════════════════════════════════════
//  ACCOUNT DELETION CLEANUP
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Triggered automatically by Firebase Auth when a user account is deleted.
 * Removes the user's profile and **all** associated data across every
 * known collection.
 *
 * Uses the Gen 1 API — auth event triggers are not available in Gen 2.
 */
exports.cleanupDeletedUser = functions
  .runWith({ timeoutSeconds: 540, memory: "512MB" })
  .auth.user()
  .onDelete(async (user) => {
    const userId = user.uid;
    let totalDeleted = 0;

    // 1. Delete user profile document
    await db.collection("users").doc(userId).delete();
    totalDeleted++;

    // 2. Batch-delete documents that reference this user by field value
    const fieldQueries = [
      db.collection("likes").where("fromUserId", "==", userId),
      db.collection("likes").where("toUserId", "==", userId),
      db.collection("ratings").where("raterId", "==", userId),
      db.collection("ratings").where("ratedUserId", "==", userId),
      db.collection("reports").where("reporterId", "==", userId),
      db.collection("profileViews").where("viewerId", "==", userId),
      db.collection("profileViews").where("viewedUserId", "==", userId),
      db.collection("blockedUsers").where("blockerId", "==", userId),
      db.collection("blockedUsers").where("blockedUserId", "==", userId),
      db.collection("referrals").where("referrerId", "==", userId),
      db.collection("bugReports").where("userId", "==", userId),
    ];

    for (const query of fieldQueries) {
      totalDeleted += await deleteQueryBatched(query);
    }

    // 3. Delete known rate-limit documents (deterministic IDs)
    const rateLimitBatch = db.batch();
    for (const action of Object.keys(RATE_LIMITS)) {
      rateLimitBatch.delete(
        db.collection("rateLimits").doc(`${userId}_${action}`),
      );
    }
    await rateLimitBatch.commit();

    // 4. Delete chats *and their subcollections* (messages, typing).
    //    Chat IDs use the format "uid1_uid2". We can only efficiently query
    //    chats where this user's UID is the lexicographically-first segment.
    //
    //    TODO: For exhaustive cleanup, add a `participants` array field to
    //    chat documents and query with `array-contains` instead.
    const chatSnapshot = await db
      .collection("chats")
      .where(
        admin.firestore.FieldPath.documentId(),
        ">=",
        `${userId}_`,
      )
      .where(
        admin.firestore.FieldPath.documentId(),
        "<",
        `${userId}_\uf8ff`,
      )
      .get();

    for (const chatDoc of chatSnapshot.docs) {
      // recursiveDelete removes the document *and* all nested subcollections
      await db.recursiveDelete(chatDoc.ref);
      totalDeleted++;
    }

    console.log(
      `Cleaned up ${totalDeleted} document(s) for deleted user ${userId}.`,
    );
  });