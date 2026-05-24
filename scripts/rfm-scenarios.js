/**
 * RFM clinical scenarios for the consultant-critic agent.
 *
 * Designed to collectively exercise the whole BJOG 2026 / GTG 57 guideline
 * (41 practice points covering antenatal counselling, acute assessment,
 * gestation-specific pathways, recurrent episodes, multiple pregnancy,
 * abnormal findings, and follow-up).
 *
 * Each note deliberately has SOME things done (so the analyzer must
 * recognise what's already in the note) and SOME things missing
 * (so suggestions have somewhere genuine to land).
 */

const SCENARIOS = [
  {
    id: 'RFM_01_term_first_episode',
    label: 'First-episode RFM at term, low-risk',
    text: `Mrs K, G2P1, 38+2 by 12w scan. Presents at 14:30 with reduced fetal movements since 09:00 this morning, no period of complete absence.
History: previous SVD at term 2018, normal pregnancy. No medical issues. Non-smoker. BMI 24. No allergies.
Risk factors for stillbirth/FGR: nil identified.
Examination: alert, comfortable. BP 118/74. Symphysis-fundal height 37cm (on 38w curve).
Doppler: fetal heart heard at 142 bpm.
Plan: CTG underway. Will await result.`
  },

  {
    id: 'RFM_02_recurrent_at_term',
    label: 'Recurrent RFM, third episode at 39+5',
    text: `Mrs T, G3P2, 39+5. Third presentation with reduced movements in 10 days.
Previous attendances (3 days ago and 7 days ago): cCTG normal both times, USS 5 days ago showed EFW 50th centile, AFI normal, UA Doppler normal.
Today: feels movements much less than usual since last night, attended this morning.
PMH: nil. Two previous SVDs at term. Non-smoker. BMI 26.
Examination: BP 124/78, urine NAD, SFH 39cm.
Doppler: FH 138 bpm.
Plan: cCTG running.`
  },

  {
    id: 'RFM_03_pre26_no_routine',
    label: 'RFM at 25+0 — pre-CTG gestation',
    text: `Mrs S, G1P0, 25+0. First-time mother, unsure whether what she has felt today is reduced or normal — has been feeling movements daily for the last fortnight.
History: spontaneous conception, uncomplicated to date. No medical issues. BMI 22, non-smoker.
Examination: BP 116/72. Abdomen soft, uterus appropriate for dates.
Doppler: fetal heart heard at 148 bpm.
Plan: reassure, advised to monitor and return if she feels movements remain reduced.`
  },

  {
    id: 'RFM_04_highrisk_growth_concern',
    label: 'RFM at 32+1 with multiple FGR risk factors',
    text: `Mrs B, G2P0, 32+1. RFM since yesterday evening, attended this morning.
PMH: previous miscarriage at 14w. Smoker 10/day. BMI 33. Chronic hypertension on labetalol 200mg TDS.
Last USS at 28+0: EFW on 25th centile.
Examination: BP 138/86. Urine: protein trace, no nitrites. SFH 30cm.
Doppler: FH 132 bpm.
Plan: cCTG, awaiting result.`
  },

  {
    id: 'RFM_05_twins_RFM',
    label: 'DCDA twins with RFM at 29+3',
    text: `Mrs C, G1P0, 29+3 DCDA twins (spontaneous). Presents this afternoon with concern that one twin (twin 2, anterior) has been moving less for ~6 hours, twin 1 (posterior) movements normal.
PMH: nil. Non-smoker. BMI 28. No allergies.
Last USS at 28+0: both twins concordant growth (twin 1 on 45th centile, twin 2 on 40th centile), liquor normal both, UA Dopplers normal both.
Examination: BP 122/76. Abdomen: both fetuses palpable.
Plan: cCTG of twin 2 running.`
  },

  {
    id: 'RFM_06_abnormal_findings',
    label: 'RFM with abnormal CTG and EFW <10th centile',
    text: `Mrs L, G1P0, 34+5. RFM since this morning. Attended at 11:00.
PMH: nil. Non-smoker. BMI 24.
Examination: BP 130/82, urine NAD, SFH 30cm (below expected for dates).
Doppler: FH 142 bpm.
cCTG (30 min): baseline 155, variability reduced (3-5 bpm), one variable deceleration, no accelerations.
USS just done: EFW on 7th centile, AFI 6cm, UA Doppler raised PI 95th centile.
Plan: contact registrar.`
  },

  {
    id: 'RFM_07_antenatal_counselling',
    label: 'Routine 24+2 ANC, no current RFM',
    text: `Mrs Y, G2P1, 24+2, routine antenatal review.
Background: previous SVD at term, normal pregnancy. No medical issues. BMI 27. Non-smoker.
She reports she has been feeling regular movements daily, no concerns.
Examination: BP 110/68. Urine NAD. SFH 24cm.
Bloods at booking: Hb 122, blood group A Rh+.
Plan: routine ANC. Next visit in 4w at 28w for routine bloods.`
  },

  {
    id: 'RFM_08_pre_viability',
    label: 'RFM-like symptom at 22+0 — never felt definite movements',
    text: `Mrs H, G1P0, 22+0. Attends concerned she has not felt definite fetal movements yet. Reports "flutters" 2-3 weeks ago but not sure if that was movement.
PMH: nil. BMI 25. Non-smoker.
Anomaly scan at 20+3 normal.
Examination: BP 114/70. SFH 22cm.
Doppler: fetal heart heard at 152 bpm.
Plan: reassure, advised that for primiparous women movements can be felt later than 18-20w, asked to return if no movement felt in next 2 weeks.`
  },
];

module.exports = { SCENARIOS };
