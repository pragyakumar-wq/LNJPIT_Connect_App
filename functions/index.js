"use strict";

const {onCall, HttpsError} = require("firebase-functions/v2/https");
const {onSchedule} = require("firebase-functions/v2/scheduler");
const {logger} = require("firebase-functions");
const {initializeApp} = require("firebase-admin/app");
const {FieldValue, getFirestore} = require("firebase-admin/firestore");
const {getMessaging} = require("firebase-admin/messaging");

initializeApp();

const db = getFirestore();
const REGION = "asia-south1";
const TIME_ZONE = "Asia/Kolkata";
const DEVICE_COLLECTION = "reminderDevices";
const LOCK_COLLECTION = "reminderLocks";
const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const VALID_GROUPS = new Set(["all", "G1", "G2"]);

// Mirrors the public timetable in index.html. Times are minutes after
// midnight in Asia/Kolkata (IST). Keep the two files in sync when the timetable changes.
const SLOT = {a: [600, 720], b: [720, 780], c: [840, 900], d: [900, 960], e: [960, 1020], x: [600, 780]};
const parseDay = encoded => encoded.split("|").map(part => {
  const divider = part.indexOf(":");
  const slot = part.slice(0, divider);
  const [start, end] = SLOT[slot];
  return {start, end, title: part.slice(divider + 1)};
});

const BRANCH_NAMES = [
  "Electrical and Electronics Engineering",
  "Computer Science & Engineering (Section-A)",
  "Computer Science & Engineering (Section-B)",
  "Civil Engineering",
  "Mechanical Engineering",
  "Mathematics & Computing",
  "Food Processing & Preservation"
];

const SCHEDULE = [
  [
    "a:PPS Lab (G2) / CS Lab (G1)|b:Remedial class (CS)|c:Math-I|d:BE|e:Physics",
    "a:Physics Lab (G1) / Sports-Yoga-NCC-NSS (G2)|b:Remedial class (Physics)|c:Math-I|d:IAI|e:Mentor-Mentee",
    "a:BE Lab (G1) / Physics Lab (G2)|b:Remedial class (BE)|c:Communication Skills|d:Physics|e:Library",
    "a:BE Lab (G2)|b:Remedial class (IAI)|c:Math-I|d:BE|e:Communication Skills",
    "a:CS Lab (G2) / Sports-Yoga-NCC-NSS (G1)|b:Foreign Language|c:IAI|d:BE|e:Foreign Language",
    "a:PPS Lab (G1)|b:Remedial class (Math)|c:IAI|d:Physics|e:Communication Skills"
  ],
  [
    "a:Physics Lab (G1)|b:EIC|c:Math-I|d:Physics|e:IAI",
    "a:PPS Lab (G2)|b:Library|c:CFET|d:Physics|e:Foreign Language",
    "a:PPS Lab (G1)|b:EIC|c:Math-I|d:CFET|e:IAI",
    "a:Physics Lab (G2)|b:Remedial class (Math)|c:Math-I|d:BEEE|e:IAI",
    "a:BEE Lab (G2)|b:Mentor-Mentee|c:BEEE|d:Physics|e:UHV",
    "a:BEE Lab (G1)|b:EIC|c:CFET|d:UHV|e:BEEE"
  ],
  [
    "a:BEE Lab (G1)|b:Library|c:CFET|d:Physics|e:UHV",
    "a:BEE Lab (G2)|b:EIC|c:BEEE|d:IAI|e:Math-I",
    "a:Sports|b:Remedial class (Math)|c:Physics|d:BEEE|e:CFET",
    "a:PPS Lab (G2)|b:EIC|c:Physics|d:IAI|e:Math-I",
    "a:PPS Lab (G1)|b:EIC|c:CFET|d:IAI|e:Foreign Language",
    "a:Physics Lab (G1 & G2)|b:Mentor-Mentee|c:BEEE|d:Math-I|e:UHV"
  ],
  [
    "a:Chemistry Lab (G1)|b:Remedial class (Chemistry)|c:IAI|d:Chemistry|e:Communication Skills",
    "a:Chemistry Lab (G2) / PPS Lab (G1)|b:Remedial class (Math)|c:Chemistry|d:Math-I|e:Library",
    "x:EGD Lab (G2)|c:EGD|d:Math-I|e:Mentor-Mentee",
    "x:EGD Lab (G1)|a:CS Lab (G2)|b:Mentor-Mentee (G2)|c:IAI|d:Chemistry|e:Foreign Language",
    "a:PPS Lab (G2) / Sports-Yoga-NCC-NSS (G1)|b:Remedial class (English)|c:Communication Skills|d:Math-I|e:EGD",
    "a:CS Lab (G1) / Sports-Yoga-NCC-NSS (G2)|b:Remedial class (IAI)|c:Communication Skills|d:IAI|e:Library"
  ],
  [
    "x:EGD Lab (G2)|c:Communication Skills|d:EGD|e:IAI",
    "a:CS Lab (G1)|b:Remedial class (IAI)|c:Communication Skills|d:Math-I|e:Library",
    "a:CS Lab (G2) / PPS Lab (G1)|b:Remedial class (English)|c:IAI|d:EGD|e:Chemistry",
    "a:Chemistry Lab (G1) / PPS Lab (G2)|b:Remedial class (Chemistry)|c:Communication Skills|d:IAI|e:Mentor-Mentee",
    "x:EGD Lab (G1)|a:Chemistry Lab (G2)|b:Remedial class (Math)|c:Math-I|d:Chemistry|e:Foreign Language",
    "x:Sports-Yoga-NCC-NSS|c:Chemistry|d:Math-I|e:Library"
  ],
  [
    "a:PPS Lab (G1)|b:EIC|c:IAI|d:CFET|e:Foreign Language",
    "a:BEE Lab (G1)|b:Mentor-Mentee|c:Physics|d:Math-I|e:IAI",
    "a:Library|b:EIC|c:BEEE|d:Math-I|e:UHV",
    "a:BEE Lab (G2)|b:EIC|c:IAI|d:CFET|e:Physics",
    "a:Physics Lab (G1 & G2)|b:Library|c:BEEE|d:Math-I|e:Physics",
    "a:PPS Lab (G2)|b:Remedial class (Math)|c:UHV|d:CFET|e:BEEE"
  ],
  [
    "x:PPS Lab (G1)|c:EGD|d:Math-I|e:Chemistry",
    "a:CS Lab (G1)|b:Remedial class (IAI)|c:EGD|d:Communication Skills|e:IAI",
    "a:Chemistry Lab (G1) / EGD Lab (G2)|b:Remedial class (Math)|c:Communication Skills|d:Math-I|e:IAI",
    "a:PPS Lab (G2)|b:Remedial class (Chemistry)|c:Chemistry|d:Communication Skills|e:Library",
    "x:EGD Lab (G1)|a:CS Lab (G2)|b:Remedial class (English)|c:Chemistry|d:IAI|e:Library",
    "x:Chemistry (G1) / Sports-Yoga-NCC-NSS|c:Foreign Language|d:Math-I|e:Mentor-Mentee"
  ]
].map(branch => branch.map(parseDay));

function indiaClock(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TIME_ZONE,
    weekday: "long",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(date);
  const value = type => parts.find(part => part.type === type)?.value || "";
  return {
    weekday: value("weekday"),
    minutes: Number(value("hour")) * 60 + Number(value("minute")),
    dateKey: `${value("year")}-${value("month")}-${value("day")}`
  };
}

function timeLabel(minutes) {
  const hour = Math.floor(minutes / 60);
  const minute = String(minutes % 60).padStart(2, "0");
  return `${hour % 12 || 12}:${minute} ${hour < 12 ? "AM" : "PM"}`;
}

function matchesGroup(title, groupFilter) {
  if (!groupFilter || groupFilter === "all") return true;
  if (/G1\s*&\s*G2/i.test(title)) return true;
  const hasG1 = /\(G1\)/i.test(title);
  const hasG2 = /\(G2\)/i.test(title);
  if (!hasG1 && !hasG2) return true;
  if (groupFilter === "G1") return hasG1;
  if (groupFilter === "G2") return hasG2;
  return true;
}

function formatTitleForGroup(title, groupFilter) {
  if (!groupFilter || groupFilter === "all" || !title.includes("/")) return title;
  const segments = title.split("/").map(s => s.trim());
  const matching = segments.filter(seg => matchesGroup(seg, groupFilter));
  return matching.length ? matching.join(" / ") : title;
}

function remindersDue(clock) {
  const dayIndex = DAYS.indexOf(clock.weekday);
  if (dayIndex === -1) return [];

  const grouped = new Map();
  SCHEDULE.forEach((branchDays, branchIndex) => {
    for (const entry of branchDays[dayIndex]) {
      const minutesBeforeStart = entry.start - clock.minutes;
      // Cloud Scheduler can start slightly late. The idempotency lock below
      // makes the 4–5 minute window safe if invoked twice.
      if (minutesBeforeStart < 4 || minutesBeforeStart > 5) continue;
      const key = `${branchIndex}:${entry.start}`;
      if (!grouped.has(key)) grouped.set(key, {branchIndex, start: entry.start, titles: new Set()});
      grouped.get(key).titles.add(entry.title);
    }
  });
  return [...grouped.values()].map(reminder => ({
    ...reminder,
    titles: [...reminder.titles]
  }));
}

async function claimReminder(lockId, reminder) {
  const lock = db.collection(LOCK_COLLECTION).doc(lockId);
  return db.runTransaction(async transaction => {
    if ((await transaction.get(lock)).exists) return false;
    transaction.create(lock, {
      branchIndex: reminder.branchIndex,
      classStart: reminder.start,
      createdAt: FieldValue.serverTimestamp()
    });
    return true;
  });
}

async function removeInvalidDevice(ref, token) {
  await db.runTransaction(async transaction => {
    const snapshot = await transaction.get(ref);
    if (snapshot.exists && snapshot.data().fcmToken === token) transaction.delete(ref);
  });
}

function chunks(values, size) {
  return Array.from(
    {length: Math.ceil(values.length / size)},
    (_, index) => values.slice(index * size, (index + 1) * size)
  );
}

exports.registerReminderDevice = onCall({region: REGION}, async request => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Sign in before registering for reminders.");
  }

  const {token, branchIndex, groupFilter = "all", enabled = true} = request.data || {};
  if (typeof token !== "string" || token.trim().length < 20 || token.trim().length > 4096) {
    throw new HttpsError("invalid-argument", "A valid Firebase Messaging token is required.");
  }
  if (!Number.isInteger(branchIndex) || branchIndex < 0 || branchIndex >= SCHEDULE.length) {
    throw new HttpsError("invalid-argument", "Choose a valid timetable branch.");
  }
  const normalizedGroup = VALID_GROUPS.has(groupFilter) ? groupFilter : "all";

  await db.collection(DEVICE_COLLECTION).doc(request.auth.uid).set({
    fcmToken: token.trim(),
    branchIndex,
    branchName: BRANCH_NAMES[branchIndex] || "",
    groupFilter: normalizedGroup,
    enabled: Boolean(enabled),
    updatedAt: FieldValue.serverTimestamp()
  }, {merge: true});

  return {registered: true, branchIndex, groupFilter: normalizedGroup, enabled: Boolean(enabled)};
});

exports.unregisterReminderDevice = onCall({region: REGION}, async request => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Sign in before unregistering reminders.");
  }
  await db.collection(DEVICE_COLLECTION).doc(request.auth.uid).delete();
  return {unregistered: true};
});

exports.sendClassReminders = onSchedule({
  schedule: "* * * * *",
  timeZone: TIME_ZONE,
  region: REGION,
  maxInstances: 1,
  retryCount: 3
}, async () => {
  const clock = indiaClock();
  const reminders = remindersDue(clock);
  if (!reminders.length) return;

  await Promise.all(reminders.map(async reminder => {
    const reminderId = `${clock.dateKey}-b${reminder.branchIndex}-${reminder.start}`;
    if (!await claimReminder(reminderId, reminder)) return;

    const registrations = await db.collection(DEVICE_COLLECTION)
      .where("branchIndex", "==", reminder.branchIndex)
      .get();

    const recipients = registrations.docs
      .map(doc => ({
        ref: doc.ref,
        token: doc.data().fcmToken,
        groupFilter: doc.data().groupFilter || "all",
        enabled: doc.data().enabled !== false
      }))
      .filter(device => device.enabled && typeof device.token === "string" && device.token.length > 0);

    if (!recipients.length) return;

    const invalidDevices = [];

    // Group recipients by their effective notification text (accounting for G1/G2 filter)
    const buckets = new Map();
    for (const device of recipients) {
      const relevantTitles = reminder.titles
        .filter(t => matchesGroup(t, device.groupFilter))
        .map(t => formatTitleForGroup(t, device.groupFilter));
      if (!relevantTitles.length) continue;
      const joinedTitles = [...new Set(relevantTitles)].join(" | ");
      if (!buckets.has(joinedTitles)) buckets.set(joinedTitles, []);
      buckets.get(joinedTitles).push(device);
    }

    for (const [titlesText, groupDevices] of buckets.entries()) {
      const body = `Your ${titlesText} class starts at ${timeLabel(reminder.start)} (in about 5 minutes).`;

      for (const batch of chunks(groupDevices, 500)) {
        const response = await getMessaging().sendEachForMulticast({
          tokens: batch.map(device => device.token),
          data: {
            title: "⏰ Class Reminder • LNJPIT",
            body,
            url: "./",
            reminderId
          },
          webpush: {headers: {Urgency: "high", TTL: "300"}}
        });
        response.responses.forEach((result, index) => {
          if (result.success) return;
          const code = result.error?.code;
          logger.warn("FCM reminder delivery failed", {reminderId, code});
          if (
            code === "messaging/registration-token-not-registered" ||
            code === "messaging/invalid-registration-token"
          ) {
            invalidDevices.push(batch[index]);
          }
        });
      }
    }

    await Promise.all(invalidDevices.map(device => removeInvalidDevice(device.ref, device.token)));
    logger.info("Class reminder processed", {reminderId, recipients: recipients.length});
  }));
});


// Cloud Functions for Campus Community & Lost & Found (uses Admin SDK, bypassing client security rules)
exports.saveCommunityPost = onCall({region: REGION, cors: true}, async request => {
  const post = request.data || {};
  if (typeof post.id !== "string" || !post.id.trim()) {
    throw new HttpsError("invalid-argument", "Post id is required.");
  }
  const cleanId = post.id.trim().slice(0, 120);
  const payload = {
    id: cleanId,
    author: String(post.author || "LNJPIT Student").trim().slice(0, 60),
    branch: String(post.branch || "All Branches").trim().slice(0, 60),
    category: String(post.category || "General").trim().slice(0, 60),
    title: String(post.title || "").trim().slice(0, 140),
    body: String(post.body || "").trim().slice(0, 1200),
    photoData: String(post.photoData || ""),
    likes: Number(post.likes || 0),
    replies: Array.isArray(post.replies) ? post.replies.slice(0, 200) : [],
    dateLabel: String(post.dateLabel || "Today").slice(0, 40),
    createdAtMs: Number(post.createdAtMs || Date.now()),
    updatedAtMs: Date.now(),
    updatedAt: FieldValue.serverTimestamp()
  };
  await db.collection("communityPosts").doc(cleanId).set(payload, {merge: true});
  return {saved: true, id: cleanId};
});

exports.deleteCommunityPost = onCall({region: REGION, cors: true}, async request => {
  const {id} = request.data || {};
  if (typeof id !== "string" || !id.trim()) {
    throw new HttpsError("invalid-argument", "Post id is required.");
  }
  await db.collection("communityPosts").doc(id.trim()).delete();
  return {deleted: true, id: id.trim()};
});

exports.listCommunityPosts = onCall({region: REGION, cors: true}, async () => {
  const snap = await db.collection("communityPosts").orderBy("createdAtMs", "desc").limit(60).get();
  const posts = snap.docs.map(d => ({id: d.id, ...d.data()}));
  return {posts};
});

exports.saveLostFoundItem = onCall({region: REGION, cors: true}, async request => {
  const item = request.data || {};
  if (typeof item.id !== "string" || !item.id.trim()) {
    throw new HttpsError("invalid-argument", "Item id is required.");
  }
  const cleanId = item.id.trim().slice(0, 120);
  const payload = {
    id: cleanId,
    type: item.type === "found" ? "found" : "lost",
    status: item.status === "resolved" ? "resolved" : "active",
    title: String(item.title || "").trim().slice(0, 120),
    category: String(item.category || "Other").trim().slice(0, 60),
    location: String(item.location || "Campus").trim().slice(0, 100),
    date: String(item.date || "").slice(0, 30),
    reporter: String(item.reporter || "LNJPIT Student").trim().slice(0, 60),
    contact: String(item.contact || "").trim().slice(0, 80),
    desc: String(item.desc || "").trim().slice(0, 800),
    photoData: String(item.photoData || ""),
    createdAtMs: Number(item.createdAtMs || Date.now()),
    updatedAtMs: Date.now(),
    updatedAt: FieldValue.serverTimestamp()
  };
  await db.collection("lostFoundItems").doc(cleanId).set(payload, {merge: true});
  return {saved: true, id: cleanId};
});

exports.deleteLostFoundItem = onCall({region: REGION, cors: true}, async request => {
  const {id} = request.data || {};
  if (typeof id !== "string" || !id.trim()) {
    throw new HttpsError("invalid-argument", "Item id is required.");
  }
  await db.collection("lostFoundItems").doc(id.trim()).delete();
  return {deleted: true, id: id.trim()};
});

exports.listLostFoundItems = onCall({region: REGION, cors: true}, async () => {
  const snap = await db.collection("lostFoundItems").orderBy("createdAtMs", "desc").limit(60).get();
  const items = snap.docs.map(d => ({id: d.id, ...d.data()}));
  return {items};
});


exports.saveAttendanceRecord = onCall({region: REGION, cors: true}, async request => {
  const {record = {}, studentKey = "abhi"} = request.data || {};
  if (typeof record.id !== "string" || !record.id.trim()) {
    throw new HttpsError("invalid-argument", "Attendance record id is required.");
  }
  const cleanKey = String(studentKey || "abhi").trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "_").slice(0, 48) || "abhi";
  const docId = `${cleanKey}__${record.id.trim().replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 80)}`;
  const payload = {
    id: record.id.trim(),
    docId,
    studentKey: cleanKey,
    studentName: String(record.studentName || cleanKey).trim().slice(0, 60),
    date: String(record.date || "").slice(0, 20),
    subject: String(record.subject || "").trim().slice(0, 120),
    slot: String(record.slot || "").slice(0, 40),
    status: ["Present", "Absent", "Cancelled"].includes(record.status) ? record.status : "Present",
    createdAtMs: Number(record.createdAtMs || Date.now()),
    updatedAtMs: Date.now(),
    updatedAt: FieldValue.serverTimestamp()
  };
  await db.collection("attendanceRecords").doc(docId).set(payload, {merge: true});
  return {saved: true, id: payload.id, docId};
});

exports.deleteAttendanceRecord = onCall({region: REGION, cors: true}, async request => {
  const {id, docId, studentKey = "abhi"} = request.data || {};
  const cleanKey = String(studentKey || "abhi").trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "_").slice(0, 48) || "abhi";
  const targetDocId = docId || `${cleanKey}__${String(id || "").trim().replace(/[^a-zA-Z0-9_-]/g, "_")}`;
  await db.collection("attendanceRecords").doc(targetDocId).delete();
  return {deleted: true, id};
});

exports.listAttendanceRecords = onCall({region: REGION, cors: true}, async request => {
  const {studentKey = "abhi"} = request.data || {};
  const cleanKey = String(studentKey || "abhi").trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "_").slice(0, 48) || "abhi";
  const snap = await db.collection("attendanceRecords").where("studentKey", "==", cleanKey).limit(250).get();
  const records = snap.docs.map(d => ({id: d.id, ...d.data()}));
  return {records};
});
