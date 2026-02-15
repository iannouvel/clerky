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

// 4 UHSussex maternity sites
export const DEFAULT_SITES = [
    { id: 'prh',        name: 'Princess Royal Hospital',      shortName: 'PRH' },
    { id: 'rsch',       name: 'Royal Sussex County Hospital',  shortName: 'RSCH' },
    { id: 'worthing',   name: 'Worthing Hospital',             shortName: 'Worthing' },
    { id: 'chichester', name: 'St Richards Hospital',          shortName: 'Chichester' }
];

// Default task templates for new episodes (fallback when no algorithm match)
export const DEFAULT_TASKS = [
    { label: 'Observations' },
    { label: 'CTG' },
    { label: 'Bloods' },
    { label: 'Urinalysis' }
];

// ─── BSOTs Algorithms (from UHSussex guideline v1.0, Dec 2025) ─────────────
// Each presenting reason maps to 4 urgency categories (RED/ORANGE/YELLOW/GREEN).
// Each category has: criteria (presenting symptoms) and actions (immediate steps).
export const BSOTS_ALGORITHMS = {
    'Abdominal pain': {
        RED: {
            criteria: [
                'Critically abnormal MEWS (≥2 red)',
                'Collapse / maternal collapse',
                'No fetal heart on auscultation',
                'Altered level of consciousness or confusion',
                'Placental abruption suspected',
                'Constant severe pain'
            ],
            actions: [
                'Transfer immediately to DS, HDU or Obstetric Theatre',
                'Immediate review by midwife in charge',
                'Immediate review by ST3+ or equivalent and Consultant',
                'Consider review by outreach team',
                'Continuous observations'
            ]
        },
        ORANGE: {
            criteria: [
                'Abnormal MEWS (1x red or 2x yellows)',
                'Fetal heart rate <110bpm or >160bpm',
                'No fetal movements',
                'Shortness of breath or chest pain',
                'Moderate or continuous pain',
                'Moderate bleeding (fresh or old)',
                'Active bleeding'
            ],
            actions: [
                'Remain in triage room / transfer to bay',
                'Urgent review by midwife within 15 minutes',
                'Urgent review by ST3+ or equivalent if abnormal MEWS/CTG/urgent concern',
                'Consultant made aware of plan',
                'Repeat observations within 15 minutes'
            ]
        },
        YELLOW: {
            criteria: [
                'Altered MEWS (1x yellow)',
                'Normal fetal heart rate',
                'Reduced fetal movements',
                'Mild pain',
                'Mild bleeding (not currently active)'
            ],
            actions: [
                'Can return to waiting room',
                'Review by midwife within 60 minutes',
                'Request review by ST1-2 or equivalent if medical review required',
                'If altered MEWS repeat observations within 30 mins',
                'If normal MEWS repeat observations as per local guidelines'
            ]
        },
        GREEN: {
            criteria: [
                'Normal MEWS',
                'Normal fetal heart rate',
                'Normal fetal movements',
                'Minimal or no pain',
                'No bleeding',
                'No contractions'
            ],
            actions: [
                'Can return to waiting room',
                'Review by midwife within 4 hours',
                'Request review by ST1-2 or equivalent if medical review required',
                'Continue with current observation frequency'
            ]
        }
    },
    'Antenatal bleeding': {
        RED: {
            criteria: [
                'Critically abnormal MEWS (≥2 red)',
                'Collapse / maternal collapse',
                'No fetal heart on auscultation',
                'Altered level of consciousness or confusion',
                'Placental abruption suspected',
                'Constant severe pain'
            ],
            actions: [
                'Transfer immediately to DS, HDU or Obstetric Theatre',
                'Immediate review by midwife in charge',
                'Immediate review by ST3+ or equivalent and Consultant',
                'Consider review by outreach team',
                'Continuous observations'
            ]
        },
        ORANGE: {
            criteria: [
                'Abnormal MEWS (1x red or 2x yellows)',
                'Fetal heart rate <110bpm or >160bpm',
                'No fetal movements',
                'Shortness of breath or chest pain',
                'Moderate or continuous pain',
                'Moderate bleeding (fresh or old)',
                'Active bleeding'
            ],
            actions: [
                'Remain in triage room / transfer to bay',
                'Urgent review by midwife within 15 minutes',
                'Urgent review by ST3+ or equivalent if abnormal MEWS/CTG/urgent concern',
                'Consultant made aware of plan',
                'Repeat observations within 15 minutes'
            ]
        },
        YELLOW: {
            criteria: [
                'Altered MEWS (1x yellow)',
                'Normal fetal heart rate',
                'Reduced fetal movements',
                'Mild pain',
                'Mild bleeding (not currently active)'
            ],
            actions: [
                'Can return to waiting room',
                'Review by midwife within 60 minutes',
                'Request review by ST1-2 or equivalent if medical review required',
                'If altered MEWS repeat observations within 30 mins',
                'If normal MEWS repeat observations as per local guidelines'
            ]
        },
        GREEN: {
            criteria: [
                'Normal MEWS',
                'Normal fetal heart rate',
                'Normal fetal movements',
                'No bleeding',
                'No contractions'
            ],
            actions: [
                'Can return to waiting room',
                'Review by midwife within 4 hours',
                'Request review by ST1-2 or equivalent if medical review required',
                'Continue with current observation frequency'
            ]
        }
    },
    'Hypertension': {
        RED: {
            criteria: [
                'Critically abnormal MEWS (≥2 red)',
                'Collapse / maternal collapse',
                'No fetal heart on auscultation',
                'Altered level of consciousness or confusion',
                'Eclamptic seizure',
                'Vomiting'
            ],
            actions: [
                'Transfer immediately to DS, HDU or Obstetric Theatre',
                'Immediate review by midwife in charge',
                'Immediate review by ST3+ or equivalent and Consultant',
                'Consider review by outreach team',
                'Continuous observations'
            ]
        },
        ORANGE: {
            criteria: [
                'Abnormal MEWS (1x red or 2x yellows)',
                'Fetal heart rate <110bpm or >160bpm',
                'Shortness of breath or chest pain',
                'Severe headache or visual disturbances',
                'Vomiting',
                'Epigastric / right upper quadrant pain',
                'Moderate bleeding (fresh or old)',
                'Active bleeding'
            ],
            actions: [
                'Remain in triage room / transfer to bay',
                'Urgent review by midwife within 15 minutes',
                'Urgent review by ST3+ or equivalent if abnormal MEWS/CTG/urgent concern',
                'Consultant made aware of plan',
                'Repeat observations within 15 minutes'
            ]
        },
        YELLOW: {
            criteria: [
                'Altered MEWS (1x yellow)',
                'Normal fetal heart rate',
                'Reduced fetal movements',
                'Mild pain',
                'Mild bleeding (not currently active)',
                'Headache'
            ],
            actions: [
                'Can return to waiting room',
                'Review by midwife within 60 minutes',
                'Request review by ST1-2 or equivalent if medical review required',
                'If altered MEWS repeat observations within 30 mins',
                'If normal MEWS repeat observations as per local guidelines'
            ]
        },
        GREEN: {
            criteria: [
                'Normal MEWS',
                'No/minor proteinuria',
                'Normal fetal heart rate',
                'Normal fetal movements',
                'Minimal or no pain',
                'No bleeding',
                'No headache'
            ],
            actions: [
                'Can return to waiting room',
                'Review by midwife within 4 hours',
                'Request review by ST1-2 or equivalent if medical review required',
                'Continue with current observation frequency'
            ]
        }
    },
    'Ruptured membranes': {
        RED: {
            criteria: [
                'Critically abnormal MEWS (≥2 red)',
                'Collapse / maternal collapse',
                'No fetal heart on auscultation',
                'Altered level of consciousness or confusion',
                'Massive haemorrhage',
                'Cord prolapse'
            ],
            actions: [
                'Transfer immediately to DS, HDU or Obstetric Theatre',
                'Immediate review by midwife in charge',
                'Immediate review by ST3+ or equivalent and Consultant',
                'Consider review by outreach team',
                'Continuous observations'
            ]
        },
        ORANGE: {
            criteria: [
                'Abnormal MEWS (1x red or 2x yellows)',
                'No fetal movements',
                'Suspected chorioamnionitis',
                'Preterm <37 weeks',
                'Moderate or continuous pain',
                'Active bleeding'
            ],
            actions: [
                'Remain in triage room / transfer to bay',
                'Urgent review by midwife within 15 minutes',
                'Urgent review by ST3+ or equivalent if abnormal MEWS/CTG/urgent concern',
                'Consultant made aware of plan',
                'Repeat observations within 15 minutes'
            ]
        },
        YELLOW: {
            criteria: [
                'Altered MEWS (1x yellow)',
                'PROM >24 hours',
                'Reduced fetal movements',
                'Close to / no liquor seen',
                'Regular painful contractions',
                'High risk as per labour risk assessment',
                'Known fetal anomaly',
                'Mild bleeding (not currently active)'
            ],
            actions: [
                'Can return to waiting room',
                'Review by midwife within 60 minutes',
                'Request review by ST1-2 or equivalent if medical review required',
                'If altered MEWS repeat observations within 30 mins',
                'If normal MEWS repeat observations as per local guidelines'
            ]
        },
        GREEN: {
            criteria: [
                'Normal MEWS',
                'Sensation of / PRM',
                'Normal fetal heart rate',
                'Normal fetal movements',
                'Low risk as per labour risk assessment',
                'Minimal or no pain',
                'No bleeding'
            ],
            actions: [
                'Can return to waiting room',
                'Review by midwife within 4 hours',
                'Request review by ST1-2 or equivalent if medical review required',
                'Continue with current observation frequency'
            ]
        }
    },
    'Reduced fetal movements': {
        RED: {
            criteria: [
                'Critically abnormal MEWS (≥2 red)',
                'Collapse / maternal collapse',
                'No fetal heart on auscultation',
                'Altered level of consciousness or confusion',
                'Placental abruption suspected',
                'Cord prolapse'
            ],
            actions: [
                'Transfer immediately to DS, HDU or Obstetric Theatre',
                'Immediate review by midwife in charge',
                'Immediate review by ST3+ or equivalent and Consultant',
                'Consider review by outreach team',
                'Continuous observations'
            ]
        },
        ORANGE: {
            criteria: [
                'Abnormal MEWS (1x red or 2x yellows)',
                'No fetal movements',
                'Recurrent presentation of RFM',
                'Known risk factor for stillbirth',
                'Known pre-existing medical conditions or obstetric complications',
                'Shortness of breath or chest pain',
                'Moderate bleeding (fresh or old)',
                'Active bleeding'
            ],
            actions: [
                'Remain in triage room / transfer to bay',
                'Urgent review by midwife within 15 minutes',
                'Urgent review by ST3+ or equivalent if abnormal MEWS/CTG/urgent concern',
                'Consultant made aware of plan',
                'Repeat observations within 15 minutes'
            ]
        },
        YELLOW: {
            criteria: [
                'Altered MEWS (1x yellow)',
                'Normal fetal heart rate',
                'Reduced or altered pattern of fetal movements',
                'Mild pain',
                'Mild bleeding (not currently active)'
            ],
            actions: [
                'Can return to waiting room',
                'Review by midwife within 60 minutes',
                'Request review by ST1-2 or equivalent if medical review required',
                'If altered MEWS repeat observations within 30 mins',
                'If normal MEWS repeat observations as per local guidelines'
            ]
        },
        GREEN: {
            criteria: [
                'Normal MEWS',
                'Normal fetal heart rate / reactive at time',
                'Normal fetal movements or unsure',
                'Minimal or no pain',
                'No bleeding',
                'No contractions'
            ],
            actions: [
                'Can return to waiting room',
                'Review by midwife within 4 hours',
                'Request review by ST1-2 or equivalent if medical review required',
                'Continue with current observation frequency'
            ]
        }
    },
    'Suspected labour': {
        RED: {
            criteria: [
                'Critically abnormal MEWS (≥2 red)',
                'Collapse / maternal collapse',
                'No fetal heart on auscultation',
                'Altered level of consciousness or confusion',
                'Massive haemorrhage',
                'Cord prolapse',
                'Constant severe pain without relaxation'
            ],
            actions: [
                'Transfer immediately to DS, LDU, HDU or Obstetric Theatre',
                'Immediate review by midwife in charge',
                'Immediate review by ST3+ or equivalent and Consultant',
                'Consider review by outreach team',
                'Continuous observations'
            ]
        },
        ORANGE: {
            criteria: [
                'Abnormal MEWS (1x red or 2x yellows)',
                'Fetal heart rate <110bpm or >160bpm',
                'No fetal movements',
                'Meconium or blood stained liquor',
                'Shortness of breath or chest pain',
                'Moderate or continuous pain',
                'Moderate bleeding (fresh or old)',
                'Active bleeding'
            ],
            actions: [
                'Remain in triage room / transfer to bay',
                'Urgent review by midwife within 15 minutes',
                'Urgent review by ST3+ or equivalent if abnormal MEWS/CTG/urgent concern',
                'Consultant made aware of plan',
                'Repeat observations within 15 minutes'
            ]
        },
        YELLOW: {
            criteria: [
                'Altered MEWS (1x yellow)',
                'Gestation <37/40',
                'PROM >24 hours',
                'Normal fetal heart rate',
                'Reduced fetal movements',
                'Regular painful contractions',
                'High risk as per labour risk assessment',
                'Known fetal anomaly',
                'Mild bleeding (not currently active)'
            ],
            actions: [
                'Can return to waiting room',
                'Review by midwife within 60 minutes',
                'Request review by ST1-2 or equivalent if medical review required',
                'If altered MEWS repeat observations within 30 mins',
                'If normal MEWS repeat observations as per local guidelines'
            ]
        },
        GREEN: {
            criteria: [
                'Normal MEWS',
                'Gestation ≥37/40',
                'Normal fetal heart rate',
                'Normal fetal movements',
                'Irregular mild contractions',
                'Low risk as per labour risk assessment',
                'No bleeding'
            ],
            actions: [
                'Can return to waiting room',
                'Review by midwife within 4 hours',
                'Request review by ST1-2 or equivalent if medical review required',
                'Continue with current observation frequency'
            ]
        }
    },
    'Unwell / Other': {
        RED: {
            criteria: [
                'Critically abnormal MEWS (≥2 red)',
                'Collapse / maternal collapse',
                'No fetal heart on auscultation',
                'Altered level of consciousness or confusion',
                'Placental abruption suspected',
                'Constant severe pain'
            ],
            actions: [
                'Transfer immediately to DS, HDU or Obstetric Theatre',
                'Immediate review by midwife in charge',
                'Immediate review by ST3+ or equivalent and Consultant',
                'Consider review by outreach team',
                'Continuous observations'
            ]
        },
        ORANGE: {
            criteria: [
                'Abnormal MEWS (1x red or 2x yellows)',
                'Fetal heart rate <110bpm or >160bpm',
                'No fetal movements',
                'Pre-existing diabetes with ketones',
                'MEWS or fetal heart rate concern',
                'Moderate or continuous pain',
                'Moderate bleeding (fresh or old)',
                'Active bleeding'
            ],
            actions: [
                'Remain in triage room / transfer to bay',
                'Urgent review by midwife within 15 minutes',
                'Urgent review by ST3+ or equivalent if abnormal MEWS/CTG/urgent concern',
                'Consultant made aware of plan',
                'Repeat observations within 15 minutes'
            ]
        },
        YELLOW: {
            criteria: [
                'Altered MEWS (1x yellow)',
                'Normal fetal heart rate',
                'Reduced fetal movements',
                'Mild pain',
                'Mild bleeding (not currently active)',
                'Overt physical trauma / injury',
                'Acute disturbance in mental health'
            ],
            actions: [
                'Can return to waiting room',
                'Review by midwife within 60 minutes',
                'Request review by ST1-2 or equivalent if medical review required',
                'If altered MEWS repeat observations within 30 mins',
                'If normal MEWS repeat observations as per local guidelines'
            ]
        },
        GREEN: {
            criteria: [
                'Normal MEWS',
                'Normal fetal heart rate',
                'Normal fetal movements',
                'Pre-existing medical or mental health condition',
                'Minimal or no pain',
                'No bleeding',
                'Itching'
            ],
            actions: [
                'Can return to waiting room',
                'Review by midwife within 4 hours',
                'Request review by ST1-2 or equivalent if medical review required',
                'Continue with current observation frequency'
            ]
        }
    },
    'Postnatal': {
        RED: {
            criteria: [
                'Critically abnormal MEWS (≥2 red)',
                'Airways compromise',
                'Collapse',
                'Altered level of consciousness or confusion',
                'Massive haemorrhage',
                'Seizure'
            ],
            actions: [
                'Transfer immediately to DS, HDU or Obstetric Theatre',
                'Immediate review by midwife in charge',
                'Immediate review by ST3+ or equivalent and Consultant',
                'Consider review by outreach team',
                'Continuous observations'
            ]
        },
        ORANGE: {
            criteria: [
                'Abnormal MEWS (1x red or 2x yellows)',
                'Shortness of breath or chest pain',
                'Moderate bleeding (fresh or old)',
                'Active bleeding',
                'Additional signs of sepsis: diarrhoea or vomiting',
                'Cough / breathless infection',
                'Additional signs of VTE',
                'Wound dehiscence'
            ],
            actions: [
                'Remain in triage room / transfer to bay',
                'Urgent review by midwife within 15 minutes',
                'Urgent review by ST3+ or equivalent if abnormal MEWS/CTG/urgent concern',
                'Consultant made aware of plan',
                'Repeat observations within 15 minutes'
            ]
        },
        YELLOW: {
            criteria: [
                'Altered MEWS (1x yellow)',
                'Mild bleeding (not currently active)',
                'Calf pain',
                'Wound dehiscence',
                'Additional signs of VTE',
                'Acute disturbance of mental health'
            ],
            actions: [
                'Can return to waiting room',
                'Review by midwife within 60 minutes',
                'Request review by ST1-2 or equivalent if medical review required',
                'If altered MEWS repeat observations within 30 mins',
                'If normal MEWS repeat observations as per local guidelines'
            ]
        },
        GREEN: {
            criteria: [
                'Normal MEWS',
                'No bleeding',
                'No headache',
                'Perineal discomfort',
                'Breast / feeding difficulties',
                'Suspected wound infection'
            ],
            actions: [
                'Can return to waiting room',
                'Review by midwife within 4 hours',
                'Request review by ST1-2 or equivalent if medical review required',
                'Continue with current observation frequency'
            ]
        }
    }
};

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
