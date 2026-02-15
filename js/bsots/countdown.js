/**
 * BSOTs Countdown Timer Utilities
 * Handles countdown formatting, overdue detection, and warning states
 */

import { COUNTDOWN_WARNING_SECONDS } from './constants.js';

/**
 * Compute remaining milliseconds until nextDueAt.
 * Negative value means overdue.
 */
export function getRemainingMs(nextDueAt) {
    if (!nextDueAt) return 0;
    const dueMs = nextDueAt.toMillis ? nextDueAt.toMillis() : new Date(nextDueAt).getTime();
    return dueMs - Date.now();
}

/**
 * Format remaining milliseconds as human-readable countdown.
 * Returns { text, isOverdue, isWarning, remainingSeconds }
 */
export function formatCountdown(nextDueAt) {
    const remainingMs = getRemainingMs(nextDueAt);
    const remainingSeconds = Math.ceil(remainingMs / 1000);
    const isOverdue = remainingMs <= 0;
    const isWarning = !isOverdue && remainingSeconds <= COUNTDOWN_WARNING_SECONDS;

    if (isOverdue) {
        const overdueMs = Math.abs(remainingMs);
        const text = '-' + formatDuration(overdueMs);
        return { text, isOverdue: true, isWarning: false, remainingSeconds };
    }

    const text = formatDuration(remainingMs);
    return { text, isOverdue: false, isWarning, remainingSeconds };
}

/**
 * Format a duration in ms to HH:MM:SS or MM:SS.
 */
export function formatDuration(ms) {
    const totalSeconds = Math.floor(Math.abs(ms) / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    const pad = n => String(n).padStart(2, '0');

    if (hours > 0) {
        return `${hours}:${pad(minutes)}:${pad(seconds)}`;
    }
    return `${pad(minutes)}:${pad(seconds)}`;
}

/**
 * Format a Firestore timestamp as HH:MM (UK timezone).
 */
export function formatTime(ts) {
    if (!ts) return '--:--';
    const date = ts.toDate ? ts.toDate() : new Date(ts);
    return date.toLocaleTimeString('en-GB', {
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'Europe/London'
    });
}

/**
 * Format a Firestore timestamp as DD/MM HH:MM (UK timezone).
 */
export function formatDateTime(ts) {
    if (!ts) return '--';
    const date = ts.toDate ? ts.toDate() : new Date(ts);
    return date.toLocaleDateString('en-GB', {
        day: '2-digit',
        month: '2-digit',
        timeZone: 'Europe/London'
    }) + ' ' + date.toLocaleTimeString('en-GB', {
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'Europe/London'
    });
}

/**
 * Get CSS class for countdown state.
 */
export function getCountdownClass(nextDueAt) {
    const { isOverdue, isWarning } = formatCountdown(nextDueAt);
    if (isOverdue) return 'bsots-countdown-overdue';
    if (isWarning) return 'bsots-countdown-warning';
    return 'bsots-countdown-normal';
}
