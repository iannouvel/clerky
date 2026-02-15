/**
 * BSOTs (Birmingham Symptom-specific Obstetric Triage System)
 * Constants and configuration
 */

// Urgency categories with time-to-treatment in minutes
export const URGENCY_CATEGORIES = {
    RED:    { label: 'RED',    color: '#dc3545', bgColor: '#f8d7da', textColor: '#721c24', minutes: 0,   description: 'Immediate' },
    ORANGE: { label: 'ORANGE', color: '#fd7e14', bgColor: '#ffe0b2', textColor: '#7c4000', minutes: 15,  description: '15 minutes' },
    YELLOW: { label: 'YELLOW', color: '#ffc107', bgColor: '#fff9c4', textColor: '#665200', minutes: 60,  description: '60 minutes' },
    GREEN:  { label: 'GREEN',  color: '#28a745', bgColor: '#d4edda', textColor: '#155724', minutes: 240, description: '240 minutes' }
};

// The 8 BSOTs structured presenting reasons
export const PRESENTING_REASONS = [
    'Abdominal pain',
    'Antenatal bleeding',
    'Hypertension',
    'Ruptured membranes',
    'Reduced fetal movements',
    'Suspected labour',
    'Unwell / Other',
    'Postnatal'
];

// 4 Birmingham maternity sites
export const DEFAULT_SITES = [
    { id: 'bwh',  name: "Birmingham Women's Hospital", shortName: 'BWH' },
    { id: 'hh',   name: 'Heartlands Hospital',         shortName: 'HH' },
    { id: 'ghh',  name: 'Good Hope Hospital',           shortName: 'GHH' },
    { id: 'sh',   name: 'Solihull Hospital',             shortName: 'SH' }
];

// Default task templates for new episodes
export const DEFAULT_TASKS = [
    { label: 'Observations' },
    { label: 'CTG' },
    { label: 'Bloods' },
    { label: 'Urinalysis' }
];

// Triage delay threshold: flag breach if triage not completed within this window
export const TRIAGE_DELAY_THRESHOLD_MS = 15 * 60 * 1000; // 15 minutes

// Countdown warning threshold: turn red in final 60 seconds
export const COUNTDOWN_WARNING_SECONDS = 60;

// Member roles
export const MEMBER_ROLES = ['admin', 'senior', 'clinician'];

// Permission labels
export const PERMISSION_FLAGS = {
    canEditUrgency:    'Can edit urgency',
    canCompleteReview: 'Can complete review',
    canEditTasks:      'Can edit tasks',
    canManageTeams:    'Can manage teams'
};

// Firestore collection names
export const COLLECTIONS = {
    sites:    'bsots_sites',
    teams:    'bsots_teams',
    members:  'bsots_members',
    episodes: 'bsots_episodes',
    events:   'bsots_events'
};

// Event types for audit trail
export const EVENT_TYPES = {
    EPISODE_CREATED:  'episode_created',
    URGENCY_CHANGED:  'urgency_changed',
    TASK_UPDATED:     'task_updated',
    REVIEW_COMPLETED: 'review_completed',
    OUTCOME_SET:      'outcome_set',
    BREACH_TRIGGERED: 'breach_triggered',
    NOTE_ADDED:       'note_added',
    TRIAGE_STARTED:   'triage_started',
    TRIAGE_COMPLETED: 'triage_completed'
};
