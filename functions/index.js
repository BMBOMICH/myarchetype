"use strict";

/**
 * MyArchetype — Cloud Functions
 *
 * Server-side logic for:
 * - photo uploads (Cloudinary)
 * - AI moderation / age estimation (DeepAI)
 * - rate limiting
 * - push notifications
 * - deleted-account cleanup
 * - web push notifications
 *
 * Notes:
 * - Callable functions use Gen 2 APIs where possible.
 * - Auth deletion trigger remains Gen 1.
 */

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const functions = require("firebase-functions");
const { defineSecret } = require("firebase-functions/params");
const admin = require("firebase-admin");
const axios = require("axios");
const webpush = require("web-push");

admin.initializeApp();
const db = admin.firestore();

// ─────────────────────────────────────────────────────────────
// Secrets
// ─────────────────────────────────────────────────────────────

const cloudinaryCloudName = defineSecret("CLOUDINARY_CLOUD_NAME");
const cloudinaryUploadPreset = defineSecret("CLOUDINARY_UPLOAD_PRESET");
const deepaiApiKey = defineSecret("DEEPAI_API_KEY");
const vapidEmail = defineSecret("VAPID_EMAIL");
const vapidPublicKey = defineSecret("VAPID_PUBLIC_KEY");
const vapidPrivateKey = defineSecret("VAPID_PRIVATE_KEY");

// ─────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────

const REGION = "europe-west1";
const HTTP_TIMEOUT_MS = 30_000;
const MAX_BASE64_LENGTH = 15 * 1024 * 1024;
const NSFW_THRESHOLD = 0.6;
const BATCH_LIMIT = 400;

const RATE_LIMITS = {
  like: { count: 100, periodMs: 86_400_000 },
  message: { count: 500, periodMs: 86_400_000 },
  report: { count: 10, periodMs: 86_400_000 },
};

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

function requireAuth(request) {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Authentication required.");
  }
  return request.auth;
}

function requireString(value, label) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new HttpsError("invalid-argument", `${label} must be a non-empty string.`);
  }
  return value.trim();
}

function optionalString(value) {
  return typeof value === "string" ? value : undefined;
}

function ensureObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new HttpsError("invalid-argument", `${label} must be an object.`);
  }
  return value;
}

function normalizeStringMap(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out = {};
  for (const [key, val] of Object.entries(value)) {
    if (typeof val === "string") {
      out[key] = val;
    } else if (val != null) {
      out[key] = String(val);
    }
  }
  return out;
}

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
    }
  );
  return data;
}

function getChatId(userA, userB) {
  return [userA, userB].sort().join("_");
}

function buildChatParticipants(userA, userB) {
  return [userA, userB].sort();
}

function configureWebPush() {
  webpush.setVapidDetails(
    vapidEmail.value(),
    vapidPublicKey.value(),
    vapidPrivateKey.value()
  );
}

// ─────────────────────────────────────────────────────────────
// Photo Upload
// ─────────────────────────────────────────────────────────────

exports.uploadPhoto = onCall(
  {
    region: REGION,
    secrets: [cloudinaryCloudName, cloudinaryUploadPreset],
    memory: "256MiB",
    timeoutSeconds: 60,
  },
  async (request) => {
    requireAuth(request);

    const photoBase64 = requireString(request.data?.photoBase64, "photoBase64");

    if (photoBase64.length > MAX_BASE64_LENGTH) {
      throw new HttpsError("invalid-argument", "Image exceeds the size limit.");
    }

    try {
      const { data } = await axios.post(
        `https://api.cloudinary.com/v1_1/${cloudinaryCloudName.value()}/image/upload`,
        {
          file: photoBase64,
          upload_preset: cloudinaryUploadPreset.value(),
        },
        { timeout: HTTP_TIMEOUT_MS }
      );

      if (!data?.secure_url) {
        throw new Error("Cloudinary response missing secure_url");
      }

      return { url: data.secure_url };
    } catch (error) {
      console.error("Cloudinary upload failed:", error?.message || error);
      throw new HttpsError("internal", "Photo upload failed.");
    }
  }
);

// ─────────────────────────────────────────────────────────────
// AI Verification
// ─────────────────────────────────────────────────────────────

exports.verifyPhotoNSFW = onCall(
  {
    region: REGION,
    secrets: [deepaiApiKey],
    timeoutSeconds: 60,
  },
  async (request) => {
    requireAuth(request);

    const imageUrl = requireString(request.data?.imageUrl, "imageUrl");

    try {
      const result = await callDeepAI("nsfw-detector", { image: imageUrl });
      const nsfwScore = result?.output?.nsfw_score ?? 1;

      return {
        isAppropriate: nsfwScore <= NSFW_THRESHOLD,
        score: nsfwScore,
      };
    } catch (error) {
      console.error("NSFW verification failed:", error?.message || error);
      throw new HttpsError("internal", "Content verification failed.");
    }
  }
);

exports.estimateAge = onCall(
  {
    region: REGION,
    secrets: [deepaiApiKey],
    timeoutSeconds: 60,
  },
  async (request) => {
    requireAuth(request);

    const imageUrl = requireString(request.data?.imageUrl, "imageUrl");

    try {
      const result = await callDeepAI("demographic-recognition", { image: imageUrl });
      const persons = result?.output?.persons ?? [];
      return {
        estimatedAge: persons.length > 0 ? persons[0]?.age ?? null : null,
      };
    } catch (error) {
      console.error("Age estimation failed:", error?.message || error);
      return { estimatedAge: null };
    }
  }
);

exports.detectBodyType = onCall(
  {
    region: REGION,
    secrets: [deepaiApiKey],
    timeoutSeconds: 60,
  },
  async (request) => {
    requireAuth(request);

    const imageUrl = requireString(request.data?.imageUrl, "imageUrl");

    try {
      const result = await callDeepAI("densecap", { image: imageUrl });
      const captions = result?.output?.captions ?? [];

      const isFullBody = captions.some((c) => {
        const text = String(c?.caption ?? "").toLowerCase();
        return text.includes("person") && (text.includes("standing") || text.includes("full"));
      });

      return { isFullBody };
    } catch (error) {
      console.error("Body-type detection failed:", error?.message || error);
      return { isFullBody: false };
    }
  }
);

// ─────────────────────────────────────────────────────────────
// Rate Limiting
// ─────────────────────────────────────────────────────────────

exports.checkRateLimit = onCall(
  { region: REGION },
  async (request) => {
    const { uid } = requireAuth(request);
    const action = request.data?.action;

    if (typeof action !== "string" || !(action in RATE_LIMITS)) {
      throw new HttpsError(
        "invalid-argument",
        `action must be one of: ${Object.keys(RATE_LIMITS).join(", ")}`
      );
    }

    const limit = RATE_LIMITS[action];
    const ref = db.collection("rateLimits").doc(`${uid}_${action}`);
    const now = Date.now();

    return db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);

      if (!snap.exists) {
        tx.set(ref, {
          count: 1,
          firstAction: now,
          lastAction: now,
          userId: uid,
          action,
        });
        return { allowed: true, remaining: limit.count - 1 };
      }

      const current = snap.data();
      const elapsed = now - current.firstAction;

      if (elapsed > limit.periodMs) {
        tx.set(ref, {
          count: 1,
          firstAction: now,
          lastAction: now,
          userId: uid,
          action,
        });
        return { allowed: true, remaining: limit.count - 1 };
      }

      if (current.count >= limit.count) {
        return {
          allowed: false,
          remaining: 0,
          resetIn: limit.periodMs - elapsed,
        };
      }

      tx.update(ref, {
        count: admin.firestore.FieldValue.increment(1),
        lastAction: now,
      });

      return {
        allowed: true,
        remaining: limit.count - current.count - 1,
      };
    });
  }
);

// ─────────────────────────────────────────────────────────────
// Push Notifications
// ─────────────────────────────────────────────────────────────

exports.sendNotification = onCall(
  { region: REGION },
  async (request) => {
    requireAuth(request);

    const targetUserId = requireString(request.data?.targetUserId, "targetUserId");
    const title = requireString(request.data?.title, "title");
    const body = optionalString(request.data?.body);
    const notifPayload = normalizeStringMap(request.data?.data);

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
        notification: body ? { title, body } : { title },
        data: notifPayload,
      });

      return { success: true };
    } catch (error) {
      const code = error?.code;
      const invalidTokenCodes = [
        "messaging/invalid-registration-token",
        "messaging/registration-token-not-registered",
      ];

      if (invalidTokenCodes.includes(code)) {
        await db
          .collection("users")
          .doc(targetUserId)
          .update({
            pushToken: admin.firestore.FieldValue.delete(),
          })
          .catch(() => {});
      }

      console.error("FCM send failed:", code || error?.message || error);
      return { success: false, reason: "send_failed" };
    }
  }
);

// ─────────────────────────────────────────────────────────────
// Web Push Notifications
// ─────────────────────────────────────────────────────────────

exports.sendWebPushNotification = onCall(
  {
    region: REGION,
    secrets: [vapidEmail, vapidPublicKey, vapidPrivateKey],
  },
  async (request) => {
    requireAuth(request);

    const recipientUserId = requireString(request.data?.recipientUserId, "recipientUserId");
    const title = requireString(request.data?.title, "title");
    const body = requireString(request.data?.body, "body");
    const screen = optionalString(request.data?.screen) || "home";

    try {
      configureWebPush();

      const userDoc = await db.collection("users").doc(recipientUserId).get();
      const webPushSubscription = userDoc.data()?.webPushSubscription;

      if (!webPushSubscription) {
        return { success: false, reason: "no_subscription" };
      }

      const subscription = JSON.parse(webPushSubscription);

      await webpush.sendNotification(
        subscription,
        JSON.stringify({
          title,
          body,
          data: { screen },
        })
      );

      return { success: true };
    } catch (error) {
      console.error("[Web Push] Error:", error?.message || error);
      throw new HttpsError("internal", "Failed to send web push notification.");
    }
  }
);

// ─────────────────────────────────────────────────────────────
// Chat Helpers
// ─────────────────────────────────────────────────────────────

exports.ensureChatExists = onCall(
  { region: REGION },
  async (request) => {
    const { uid } = requireAuth(request);
    const otherUserId = requireString(request.data?.otherUserId, "otherUserId");

    if (uid === otherUserId) {
      throw new HttpsError("invalid-argument", "Cannot create a chat with yourself.");
    }

    const chatId = getChatId(uid, otherUserId);
    const chatRef = db.collection("chats").doc(chatId);
    const chatSnap = await chatRef.get();

    if (!chatSnap.exists) {
      await chatRef.set({
        participants: buildChatParticipants(uid, otherUserId),
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        lastMessage: "",
        lastMessageAt: admin.firestore.FieldValue.serverTimestamp(),
        lastMessageSenderId: uid,
      });
    }

    return { success: true, chatId };
  }
);

// ─────────────────────────────────────────────────────────────
// Report Submission
// ─────────────────────────────────────────────────────────────

exports.submitReport = onCall(
  { region: REGION },
  async (request) => {
    const { uid } = requireAuth(request);

    const reportedUserId = requireString(request.data?.reportedUserId, "reportedUserId");
    const reason = requireString(request.data?.reason, "reason");
    const description = optionalString(request.data?.description);
    const evidence = request.data?.evidence && typeof request.data.evidence === "object"
      ? request.data.evidence
      : undefined;

    if (uid === reportedUserId) {
      throw new HttpsError("invalid-argument", "You cannot report yourself.");
    }

    const reportRef = db.collection("reports").doc();
    await reportRef.set({
      reporterId: uid,
      reportedUserId,
      reason,
      ...(description ? { description } : {}),
      ...(evidence ? { evidence } : {}),
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    return { success: true, reportId: reportRef.id };
  }
);

// ─────────────────────────────────────────────────────────────
// Block User
// ─────────────────────────────────────────────────────────────

exports.blockUser = onCall(
  { region: REGION },
  async (request) => {
    const { uid } = requireAuth(request);
    const blockedUserId = requireString(request.data?.blockedUserId, "blockedUserId");
    const reason = optionalString(request.data?.reason);

    if (uid === blockedUserId) {
      throw new HttpsError("invalid-argument", "You cannot block yourself.");
    }

    const blockId = `${uid}_${blockedUserId}`;
    await db.collection("blockedUsers").doc(blockId).set({
      blockerId: uid,
      blockedUserId,
      ...(reason ? { reason } : {}),
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    const likeIds = [`${uid}_${blockedUserId}`, `${blockedUserId}_${uid}`];
    await Promise.all(
      likeIds.map((id) => db.collection("likes").doc(id).delete().catch(() => {}))
    );

    return { success: true };
  }
);

// ─────────────────────────────────────────────────────────────
// Unmatch Users
// ─────────────────────────────────────────────────────────────

exports.unmatchUsers = onCall(
  { region: REGION, timeoutSeconds: 120, memory: "512MiB" },
  async (request) => {
    const { uid } = requireAuth(request);
    const otherUserId = requireString(request.data?.otherUserId, "otherUserId");

    if (uid === otherUserId) {
      throw new HttpsError("invalid-argument", "Invalid unmatch target.");
    }

    const chatId = getChatId(uid, otherUserId);
    const chatRef = db.collection("chats").doc(chatId);

    await Promise.all([
      db.collection("likes").doc(`${uid}_${otherUserId}`).delete().catch(() => {}),
      db.collection("likes").doc(`${otherUserId}_${uid}`).delete().catch(() => {}),
      db.collection("matches").doc(`${uid}_${otherUserId}`).delete().catch(() => {}),
      db.collection("matches").doc(`${otherUserId}_${uid}`).delete().catch(() => {}),
      db.collection("chatSettings").doc(`${uid}_${chatId}`).delete().catch(() => {}),
      db.collection("chatSettings").doc(`${otherUserId}_${chatId}`).delete().catch(() => {}),
      db.collection("matchNotes").doc(`${uid}_${otherUserId}`).delete().catch(() => {}),
      db.collection("matchNotes").doc(`${otherUserId}_${uid}`).delete().catch(() => {}),
    ]);

    const chatSnap = await chatRef.get();
    if (chatSnap.exists) {
      await db.recursiveDelete(chatRef);
    }

    return { success: true };
  }
);

// ─────────────────────────────────────────────────────────────
// Cleanup Deleted User
// ─────────────────────────────────────────────────────────────

exports.cleanupDeletedUser = functions
  .runWith({ timeoutSeconds: 540, memory: "512MB" })
  .auth.user()
  .onDelete(async (user) => {
    const userId = user.uid;
    let totalDeleted = 0;

    await db.collection("users").doc(userId).delete().catch(() => {});
    totalDeleted += 1;

    const fieldQueries = [
      db.collection("likes").where("fromUserId", "==", userId),
      db.collection("likes").where("toUserId", "==", userId),
      db.collection("ratings").where("raterId", "==", userId),
      db.collection("ratings").where("ratedUserId", "==", userId),
      db.collection("reports").where("reporterId", "==", userId),
      db.collection("reports").where("reportedUserId", "==", userId),
      db.collection("profileViews").where("viewerId", "==", userId),
      db.collection("profileViews").where("viewedUserId", "==", userId),
      db.collection("blockedUsers").where("blockerId", "==", userId),
      db.collection("blockedUsers").where("blockedUserId", "==", userId),
      db.collection("referrals").where("referrerId", "==", userId),
      db.collection("referrals").where("referredUserId", "==", userId),
      db.collection("bugReports").where("reporterId", "==", userId),
      db.collection("matchNotes").where("userId", "==", userId),
    ];

    for (const query of fieldQueries) {
      totalDeleted += await deleteQueryBatched(query);
    }

    const deterministicCollections = [
      "rateLimits",
      "pushTokens",
      "presence",
      "streaks",
      "datingStats",
      "personalityResults",
      "ratingStatus",
      "userSettings",
    ];

    for (const collectionName of deterministicCollections) {
      await db.collection(collectionName).doc(userId).delete().catch(() => {});
    }

    const chatSnapshots = await db
      .collection("chats")
      .where("participants", "array-contains", userId)
      .get()
      .catch(() => null);

    if (chatSnapshots && !chatSnapshots.empty) {
      for (const chatDoc of chatSnapshots.docs) {
        await db.recursiveDelete(chatDoc.ref).catch(() => {});
        totalDeleted += 1;
      }
    }

    console.log(`Cleaned up ${totalDeleted} document group(s) for deleted user ${userId}.`);
  });