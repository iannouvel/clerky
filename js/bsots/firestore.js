/**
 * BSOTs Firestore operations
 * All CRUD operations for episodes, events, sites, teams, members
 */

import { db } from '../../firebase-init.js';
import {
    collection, doc, addDoc, updateDoc, deleteDoc, setDoc,
    query, where, orderBy, onSnapshot, getDocs, getDoc,
    serverTimestamp, Timestamp
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';

import {
    COLLECTIONS, URGENCY_CATEGORIES, EVENT_TYPES,
    TRIAGE_DELAY_THRESHOLD_MS
} from './constants.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Convert a Firestore Timestamp to JS Date, handling null/missing gracefully */
export function toDate(ts) {
    if (!ts) return null;
    if (ts.toDate) return ts.toDate();
    if (ts instanceof Date) return ts;
    if (typeof ts === 'number') return new Date(ts);
    return null;
}

/** Create a Firestore Timestamp from a JS Date or now */
export function toTimestamp(date) {
    if (!date) return Timestamp.now();
    if (date instanceof Timestamp) return date;
    return Timestamp.fromDate(date instanceof Date ? date : new Date(date));
}

/** Compute nextDueAt from arrivalAt and urgency category */
export function computeNextDueAt(arrivalAt, urgencyCategory) {
    const config = URGENCY_CATEGORIES[urgencyCategory];
    if (!config) return arrivalAt;
    const arrivalMs = arrivalAt instanceof Timestamp ? arrivalAt.toMillis() : arrivalAt.getTime();
    return Timestamp.fromMillis(arrivalMs + config.minutes * 60 * 1000);
}

/** Generate a short ID for tasks */
function generateTaskId() {
    return 'task_' + Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
}

// ─── Episodes ─────────────────────────────────────────────────────────────────

/**
 * Subscribe to realtime episode updates for a site/status.
 * Returns an unsubscribe function.
 */
export function subscribeToEpisodes(siteId, status, callback, onError) {
    const constraints = [
        where('status', '==', status),
        orderBy('nextDueAt', 'asc')
    ];

    // If siteId is 'all', don't filter by site
    if (siteId && siteId !== 'all') {
        constraints.unshift(where('siteId', '==', siteId));
    }

    const q = query(collection(db, COLLECTIONS.episodes), ...constraints);

    return onSnapshot(q, (snapshot) => {
        const episodes = [];
        snapshot.forEach(d => episodes.push({ id: d.id, ...d.data() }));
        callback(episodes);
    }, (error) => {
        console.error('[BSOTs] Episode subscription error:', error);
        if (onError) onError(error);
    });
}

/**
 * Add a new episode to Firestore.
 */
export async function addEpisode(data) {
    const arrivalAt = data.arrivalAt ? toTimestamp(data.arrivalAt) : Timestamp.now();
    const nextDueAt = computeNextDueAt(arrivalAt, data.urgencyCategory);

    // Build task array from provided tasks
    const tasks = (data.tasks || []).map(t => ({
        id: generateTaskId(),
        label: t.label,
        status: 'pending',
        updatedAt: Timestamp.now(),
        updatedBy: data.createdBy || ''
    }));

    const episode = {
        siteId: data.siteId,
        initials: data.initials.toUpperCase(),
        hospitalNumber: data.hospitalNumber,
        presentingReason: data.presentingReason,
        urgencyCategory: data.urgencyCategory,
        arrivalAt,
        triageStartedAt: null,
        triageCompletedAt: null,
        reviewRequestedAt: null,
        medicalReviewedAt: null,
        investigationsRequestedAt: null,
        nextDueAt,
        dischargeOrAdmissionAt: null,
        status: 'pending',
        outcome: null,
        tasks,
        note: data.initialNote || '',
        meows: null,
        assignedClinician: null,
        breachFlags: { triageDelay: false, overdue: false },
        urgencyHistory: [],
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
    };

    const docRef = await addDoc(collection(db, COLLECTIONS.episodes), episode);

    await logEvent({
        episodeId: docRef.id,
        siteId: data.siteId,
        eventType: EVENT_TYPES.EPISODE_CREATED,
        data: {
            urgencyCategory: data.urgencyCategory,
            presentingReason: data.presentingReason,
            initials: data.initials.toUpperCase()
        }
    });

    return docRef;
}

/**
 * Update an episode document.
 */
export async function updateEpisode(episodeId, updates) {
    const ref = doc(db, COLLECTIONS.episodes, episodeId);
    await updateDoc(ref, {
        ...updates,
        updatedAt: serverTimestamp()
    });
}

/**
 * Change urgency category on an episode.
 * Logs previous urgency and recalculates nextDueAt.
 */
export async function changeUrgency(episodeId, episode, newUrgency, changedBy) {
    const oldUrgency = episode.urgencyCategory;
    const arrivalAt = episode.arrivalAt;
    const nextDueAt = computeNextDueAt(arrivalAt, newUrgency);

    const historyEntry = {
        from: oldUrgency,
        to: newUrgency,
        changedAt: Timestamp.now(),
        changedBy: changedBy || ''
    };

    const currentHistory = episode.urgencyHistory || [];

    await updateEpisode(episodeId, {
        urgencyCategory: newUrgency,
        nextDueAt,
        urgencyHistory: [...currentHistory, historyEntry]
    });

    await logEvent({
        episodeId,
        siteId: episode.siteId,
        eventType: EVENT_TYPES.URGENCY_CHANGED,
        data: { from: oldUrgency, to: newUrgency }
    });
}

/**
 * Add a new task to an episode.
 */
export async function addTaskToEpisode(episodeId, episode, label, createdBy) {
    const newTask = {
        id: generateTaskId(),
        label,
        status: 'pending',
        updatedAt: Timestamp.now(),
        updatedBy: createdBy || ''
    };
    const tasks = [...(episode.tasks || []), newTask];
    await updateEpisode(episodeId, { tasks });
    await logEvent({
        episodeId,
        siteId: episode.siteId,
        eventType: EVENT_TYPES.TASK_UPDATED,
        data: { taskId: newTask.id, action: 'added', label }
    });
}

/**
 * Toggle a task's status within an episode.
 */
export async function toggleTask(episodeId, episode, taskId, updatedBy) {
    const tasks = (episode.tasks || []).map(t => {
        if (t.id === taskId) {
            const newStatus = t.status === 'completed' ? 'pending' : 'completed';
            return { ...t, status: newStatus, updatedAt: Timestamp.now(), updatedBy: updatedBy || '' };
        }
        return t;
    });

    await updateEpisode(episodeId, { tasks });

    await logEvent({
        episodeId,
        siteId: episode.siteId,
        eventType: EVENT_TYPES.TASK_UPDATED,
        data: { taskId }
    });
}

/**
 * Add a note to an episode.
 */
export async function addNote(episodeId, episode, text, createdBy) {
    const newNote = {
        text,
        createdAt: Timestamp.now(),
        createdBy: createdBy || ''
    };
    const notes = [...(episode.notes || []), newNote];
    await updateEpisode(episodeId, { notes });

    await logEvent({
        episodeId,
        siteId: episode.siteId,
        eventType: EVENT_TYPES.NOTE_ADDED,
        data: { text: text.substring(0, 100) }
    });
}

/**
 * Record triage started.
 */
export async function startTriage(episodeId, episode) {
    await updateEpisode(episodeId, { triageStartedAt: Timestamp.now() });
    await logEvent({
        episodeId,
        siteId: episode.siteId,
        eventType: EVENT_TYPES.TRIAGE_STARTED,
        data: {}
    });
}

/**
 * Record triage completed.
 */
export async function completeTriage(episodeId, episode) {
    await updateEpisode(episodeId, { triageCompletedAt: Timestamp.now() });
    await logEvent({
        episodeId,
        siteId: episode.siteId,
        eventType: EVENT_TYPES.TRIAGE_COMPLETED,
        data: {}
    });
}

/**
 * Record medical review completed.
 */
export async function completeReview(episodeId, episode) {
    await updateEpisode(episodeId, {
        medicalReviewedAt: Timestamp.now(),
        reviewRequestedAt: episode.reviewRequestedAt || Timestamp.now()
    });
    await logEvent({
        episodeId,
        siteId: episode.siteId,
        eventType: EVENT_TYPES.REVIEW_COMPLETED,
        data: {}
    });
}

/**
 * Set outcome (admit / discharge / transfer) and mark episode completed.
 */
export async function setOutcome(episodeId, episode, outcome) {
    await updateEpisode(episodeId, {
        outcome,
        status: 'completed',
        dischargeOrAdmissionAt: Timestamp.now()
    });
    await logEvent({
        episodeId,
        siteId: episode.siteId,
        eventType: EVENT_TYPES.OUTCOME_SET,
        data: { outcome }
    });
}

/**
 * Check and update breach flags for an episode.
 */
export async function checkAndUpdateBreaches(episodeId, episode) {
    const now = Date.now();
    const arrivalMs = episode.arrivalAt ? (episode.arrivalAt.toMillis ? episode.arrivalAt.toMillis() : new Date(episode.arrivalAt).getTime()) : now;
    const nextDueMs = episode.nextDueAt ? (episode.nextDueAt.toMillis ? episode.nextDueAt.toMillis() : new Date(episode.nextDueAt).getTime()) : now;

    const currentFlags = episode.breachFlags || { triageDelay: false, overdue: false };
    let changed = false;

    // Triage delay: no triageCompletedAt and past threshold
    const triageDelay = !episode.triageCompletedAt && (now - arrivalMs > TRIAGE_DELAY_THRESHOLD_MS);
    if (triageDelay && !currentFlags.triageDelay) {
        currentFlags.triageDelay = true;
        changed = true;
        await logEvent({
            episodeId,
            siteId: episode.siteId,
            eventType: EVENT_TYPES.BREACH_TRIGGERED,
            data: { type: 'triageDelay', arrivalAt: episode.arrivalAt }
        });
    }

    // Overdue: past nextDueAt
    const overdue = now > nextDueMs && episode.status === 'pending';
    if (overdue && !currentFlags.overdue) {
        currentFlags.overdue = true;
        changed = true;
        await logEvent({
            episodeId,
            siteId: episode.siteId,
            eventType: EVENT_TYPES.BREACH_TRIGGERED,
            data: { type: 'overdue', nextDueAt: episode.nextDueAt }
        });
    }

    if (changed) {
        await updateEpisode(episodeId, { breachFlags: currentFlags });
    }

    return currentFlags;
}

// ─── Events (Audit Trail) ─────────────────────────────────────────────────────

/**
 * Append an event to the audit trail.
 */
export async function logEvent(event) {
    try {
        await addDoc(collection(db, COLLECTIONS.events), {
            episodeId: event.episodeId || null,
            siteId: event.siteId || null,
            eventType: event.eventType,
            data: event.data || {},
            createdAt: serverTimestamp(),
            createdBy: event.createdBy || ''
        });
    } catch (err) {
        console.error('[BSOTs] Failed to log event:', err);
    }
}

// ─── Sites ────────────────────────────────────────────────────────────────────

export async function getSites() {
    const snapshot = await getDocs(collection(db, COLLECTIONS.sites));
    const sites = [];
    snapshot.forEach(d => sites.push({ id: d.id, ...d.data() }));
    return sites;
}

export async function saveSite(siteData) {
    const ref = doc(db, COLLECTIONS.sites, siteData.id);
    await setDoc(ref, {
        name: siteData.name,
        shortName: siteData.shortName,
        createdAt: serverTimestamp()
    }, { merge: true });
}

export async function deleteSite(siteId) {
    await deleteDoc(doc(db, COLLECTIONS.sites, siteId));
}

// ─── Teams ────────────────────────────────────────────────────────────────────

export async function getTeams(siteId) {
    let q;
    if (siteId) {
        q = query(collection(db, COLLECTIONS.teams), where('siteId', '==', siteId));
    } else {
        q = collection(db, COLLECTIONS.teams);
    }
    const snapshot = await getDocs(q);
    const teams = [];
    snapshot.forEach(d => teams.push({ id: d.id, ...d.data() }));
    return teams;
}

export async function addTeam(teamData) {
    return await addDoc(collection(db, COLLECTIONS.teams), {
        siteId: teamData.siteId,
        name: teamData.name,
        createdAt: serverTimestamp()
    });
}

export async function deleteTeam(teamId) {
    await deleteDoc(doc(db, COLLECTIONS.teams, teamId));
}

// ─── Members ──────────────────────────────────────────────────────────────────

export async function getMembers(siteId) {
    let q;
    if (siteId) {
        q = query(collection(db, COLLECTIONS.members), where('siteId', '==', siteId));
    } else {
        q = collection(db, COLLECTIONS.members);
    }
    const snapshot = await getDocs(q);
    const members = [];
    snapshot.forEach(d => members.push({ id: d.id, ...d.data() }));
    return members;
}

export async function addMember(memberData) {
    return await addDoc(collection(db, COLLECTIONS.members), {
        siteId: memberData.siteId,
        teamId: memberData.teamId || null,
        displayName: memberData.displayName,
        role: memberData.role,
        permissions: {
            canEditUrgency: memberData.permissions?.canEditUrgency ?? false,
            canCompleteReview: memberData.permissions?.canCompleteReview ?? false,
            canEditTasks: memberData.permissions?.canEditTasks ?? false,
            canManageTeams: memberData.permissions?.canManageTeams ?? false
        },
        createdAt: serverTimestamp()
    });
}

export async function updateMember(memberId, updates) {
    await updateDoc(doc(db, COLLECTIONS.members, memberId), updates);
}

export async function deleteMember(memberId) {
    await deleteDoc(doc(db, COLLECTIONS.members, memberId));
}

// ─── Seed Data ────────────────────────────────────────────────────────────────

/**
 * Seed the 4 default sites into Firestore.
 */
export async function seedSites(sites) {
    for (const site of sites) {
        await saveSite(site);
    }
}

/**
 * Seed test episodes across urgency categories.
 */
export async function seedTestEpisodes(siteId) {
    const testPatients = [
        { initials: 'AB', hospitalNumber: 'H100001', presentingReason: 'Antenatal bleeding', urgencyCategory: 'RED', minutesAgo: 5 },
        { initials: 'CD', hospitalNumber: 'H100002', presentingReason: 'Hypertension', urgencyCategory: 'ORANGE', minutesAgo: 10 },
        { initials: 'EF', hospitalNumber: 'H100003', presentingReason: 'Suspected labour', urgencyCategory: 'YELLOW', minutesAgo: 20 },
        { initials: 'GH', hospitalNumber: 'H100004', presentingReason: 'Reduced fetal movements', urgencyCategory: 'YELLOW', minutesAgo: 55 },
        { initials: 'IJ', hospitalNumber: 'H100005', presentingReason: 'Postnatal', urgencyCategory: 'GREEN', minutesAgo: 30 },
        { initials: 'KL', hospitalNumber: 'H100006', presentingReason: 'Ruptured membranes', urgencyCategory: 'ORANGE', minutesAgo: 14 },
        { initials: 'MN', hospitalNumber: 'H100007', presentingReason: 'Abdominal pain', urgencyCategory: 'RED', minutesAgo: 2 },
        { initials: 'OP', hospitalNumber: 'H100008', presentingReason: 'Unwell / Other', urgencyCategory: 'GREEN', minutesAgo: 120 }
    ];

    const results = [];
    for (const p of testPatients) {
        const arrivalAt = Timestamp.fromMillis(Date.now() - p.minutesAgo * 60 * 1000);
        const ref = await addEpisode({
            siteId,
            initials: p.initials,
            hospitalNumber: p.hospitalNumber,
            presentingReason: p.presentingReason,
            urgencyCategory: p.urgencyCategory,
            arrivalAt,
            tasks: [
                { label: 'Observations' },
                { label: 'CTG' },
                { label: 'Bloods' }
            ],
            initialNote: 'Test patient seeded for prototype demonstration'
        });
        results.push({ id: ref.id, ...p });
    }
    return results;
}
