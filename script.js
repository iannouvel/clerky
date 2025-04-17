// Import Firebase instances from firebase-init.js
import { app, db, auth } from './firebase-init.js';
import { GoogleAuthProvider, signInWithPopup, onAuthStateChanged, signOut } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import { getAnalytics } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-analytics.js';
import { doc, getDoc } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
import { initializeTipTap, getEditorContent, setEditorContent, applyTrackChanges, acceptAllTrackChanges, rejectAllTrackChanges, acceptChange, rejectChange, getTrackChanges } from './tiptap-editor.js';
// Using global functions instead of importing from tiptap-editor.js
// Use window.initializeTipTap, window.getEditorContent, and window.setEditorContent

// TipTap editors
let clinicalNoteEditor = null;
let summaryEditor = null;

// Store original content before track changes
let originalClinicalNoteContent = null;

// Initialize Analytics
const analytics = getAnalytics(app);

// Declare these variables at the top level of your script
let filenames = [];
let summaries = [];
let guidanceDataLoaded = false;

const SERVER_URL = 'https://clerky-uzni.onrender.com';

// Global state variables for tracking issues and guidelines
let AIGeneratedListOfIssues = [];
let guidelinesForEachIssue = [];

// Add these at the top level of your script
let currentModel = 'OpenAI'; // Track current model

// Global helper functions for patient data and scenario generation
window.generateRandomPatientData = function() {
    const age = Math.floor(Math.random() * (65 - 18 + 1)) + 18;
    const bmi = (Math.random() * (40 - 18.5) + 18.5).toFixed(1);
    const previousPregnancies = Math.floor(Math.random() * 6);
    return { age, bmi, previousPregnancies };
};

/**
 * Generates a fictional clinical scenario based on the selected guideline
 * @param {Object} guideline - The selected guideline object
 */
function generateScenario(guideline) {
    console.log("Generating scenario for guideline:", guideline.title);
    
    // Set loading state
    const editorElement = document.getElementById('editor');
    if (editorElement) {
        editorElement.classList.add('loading');
    }
    
    // Create a fictional clinical scenario based on the guideline
    const patientAge = Math.floor(Math.random() * 50) + 20; // Random age between 20-70
    const genders = ['male', 'female'];
    const patientGender = genders[Math.floor(Math.random() * genders.length)];
    
    // Get a random name based on gender
    const firstNames = {
        male: ['John', 'Michael', 'David', 'Robert', 'James', 'William', 'Richard', 'Thomas', 'Joseph', 'Charles'],
        female: ['Mary', 'Patricia', 'Jennifer', 'Linda', 'Elizabeth', 'Barbara', 'Susan', 'Jessica', 'Sarah', 'Karen']
    };
    const lastNames = ['Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Miller', 'Davis', 'Garcia', 'Rodriguez', 'Wilson'];
    
    const firstName = firstNames[patientGender][Math.floor(Math.random() * firstNames[patientGender].length)];
    const lastName = lastNames[Math.floor(Math.random() * lastNames.length)];
    
    // Common chief complaints mapped to guidelines (more detailed)
    let chiefComplaint = "general health concerns";
    let associatedSymptoms = [];
    let duration = Math.floor(Math.random() * 12) + 1; // Random duration of 1-12 weeks
    let durationUnit = Math.random() > 0.5 ? "weeks" : "months";
    
    // More specific complaints based on guideline topic
    const lowerTitle = guideline.title.toLowerCase();
    
    if (lowerTitle.includes("diabetes")) {
        chiefComplaint = "increased thirst and frequent urination";
        associatedSymptoms = [
            "unexplained weight loss", 
            "fatigue",
            "blurred vision",
            "slow-healing sores",
            "frequent infections"
        ];
        duration = Math.floor(Math.random() * 6) + 1;
        durationUnit = "months";
    } 
    else if (lowerTitle.includes("hypertension")) {
        chiefComplaint = "headaches and dizziness";
        associatedSymptoms = [
            "elevated blood pressure readings at home",
            "shortness of breath with exertion",
            "episodic chest discomfort",
            "visual changes",
            "fatigue"
        ];
        duration = Math.floor(Math.random() * 24) + 1;
        durationUnit = "months";
    } 
    else if (lowerTitle.includes("asthma")) {
        chiefComplaint = "shortness of breath and wheezing";
        associatedSymptoms = [
            "chest tightness",
            "coughing, especially at night",
            "symptoms worsening with respiratory infections",
            "limited exercise tolerance",
            "symptoms triggered by allergens"
        ];
        duration = Math.floor(Math.random() * 12) + 1;
        durationUnit = "months";
    } 
    else if (lowerTitle.includes("depression") || lowerTitle.includes("mental health")) {
        chiefComplaint = "persistent sadness and loss of interest in activities";
        associatedSymptoms = [
            "fatigue and decreased energy",
            "insomnia or hypersomnia",
            "feelings of worthlessness",
            "difficulty concentrating",
            "changes in appetite"
        ];
        duration = Math.floor(Math.random() * 12) + 2;
        durationUnit = "months";
    } 
    else if (lowerTitle.includes("pain") || lowerTitle.includes("back pain")) {
        chiefComplaint = "chronic lower back pain";
        associatedSymptoms = [
            "radiating pain down the leg",
            "muscle spasms",
            "limited range of motion",
            "pain worsening with prolonged sitting",
            "numbness or tingling in extremities"
        ];
        duration = Math.floor(Math.random() * 24) + 3;
        durationUnit = "months";
    } 
    else if (lowerTitle.includes("cholesterol") || lowerTitle.includes("lipid")) {
        chiefComplaint = "family history of heart disease";
        associatedSymptoms = [
            "requesting cholesterol screening",
            "occasional chest discomfort with exertion",
            "shortness of breath with activity",
            "fatigue",
            "history of borderline elevated cholesterol in the past"
        ];
        duration = Math.random() > 0.5 ? "N/A - preventive care visit" : "several years of borderline results";
        durationUnit = "";
    }
    else if (lowerTitle.includes("pregnancy") || lowerTitle.includes("obstetric")) {
        chiefComplaint = "confirmation of pregnancy";
        associatedSymptoms = [
            "missed menstrual period",
            "breast tenderness",
            "morning sickness",
            "fatigue",
            "mild pelvic discomfort"
        ];
        duration = Math.floor(Math.random() * 8) + 4;
        durationUnit = "weeks";
    }
    else if (lowerTitle.includes("cancer") || lowerTitle.includes("oncology")) {
        chiefComplaint = "unexplained weight loss and fatigue";
        associatedSymptoms = [
            "night sweats",
            "recurrent fevers",
            "loss of appetite",
            "pain in affected area",
            "palpable mass"
        ];
        duration = Math.floor(Math.random() * 5) + 2;
        durationUnit = "months";
    }
    else if (lowerTitle.includes("heart") || lowerTitle.includes("cardiac")) {
        chiefComplaint = "chest pain and shortness of breath";
        associatedSymptoms = [
            "palpitations",
            "dizziness with exertion",
            "fatigue",
            "edema in lower extremities",
            "symptoms worsening with activity"
        ];
        duration = Math.floor(Math.random() * 3) + 1;
        durationUnit = "weeks";
    }
    
    // Randomly select 2-3 associated symptoms
    const numSymptoms = Math.floor(Math.random() * 2) + 2; // 2-3 symptoms
    const selectedSymptoms = [];
    for (let i = 0; i < numSymptoms && i < associatedSymptoms.length; i++) {
        const randomIndex = Math.floor(Math.random() * associatedSymptoms.length);
        const symptom = associatedSymptoms[randomIndex];
        if (!selectedSymptoms.includes(symptom)) {
            selectedSymptoms.push(symptom);
        }
    }
    
    // Generate random vitals appropriate to the condition
    const generateVitals = () => {
        let systolic = Math.floor(Math.random() * 40) + 110;
        let diastolic = Math.floor(Math.random() * 20) + 60;
        let hr = Math.floor(Math.random() * 30) + 60;
        let rr = Math.floor(Math.random() * 8) + 12;
        let temp = (Math.random() * 1 + 36.5).toFixed(1);
        let spo2 = Math.floor(Math.random() * 4) + 96;
        
        // Adjust vitals based on condition
        if (lowerTitle.includes("hypertension")) {
            systolic = Math.floor(Math.random() * 30) + 140;
            diastolic = Math.floor(Math.random() * 15) + 85;
        } else if (lowerTitle.includes("asthma")) {
            rr = Math.floor(Math.random() * 8) + 16;
            spo2 = Math.floor(Math.random() * 6) + 92;
        } else if (lowerTitle.includes("cardiac")) {
            hr = Math.floor(Math.random() * 40) + 75;
        }
        
        return {
            systolic, 
            diastolic, 
            hr, 
            rr, 
            temp, 
            spo2
        };
    };
    
    const vitals = generateVitals();
    
    // Generate past medical history relevant to the condition
    const getPastMedicalHistory = () => {
        const conditions = [
            'Hypertension',
            'Type 2 Diabetes',
            'Hyperlipidemia',
            'Coronary Artery Disease',
            'GERD',
            'Asthma',
            'Depression',
            'Osteoarthritis',
            'Hypothyroidism',
            'Obesity'
        ];
        
        let relevantCondition = "";
        if (lowerTitle.includes("diabetes")) {
            relevantCondition = "Prediabetes";
        } else if (lowerTitle.includes("hypertension")) {
            relevantCondition = "Family history of hypertension";
        } else if (lowerTitle.includes("asthma")) {
            relevantCondition = "Childhood asthma";
        } else if (lowerTitle.includes("heart") || lowerTitle.includes("cardiac")) {
            relevantCondition = "Family history of premature coronary artery disease";
        }
        
        // Select 2-4 random conditions
        const pmh = [];
        if (relevantCondition) pmh.push(relevantCondition);
        
        const numConditions = Math.floor(Math.random() * 3) + 2; // 2-4 conditions
        for (let i = 0; i < numConditions; i++) {
            const condition = conditions[Math.floor(Math.random() * conditions.length)];
            if (!pmh.includes(condition)) {
                pmh.push(condition);
            }
        }
        
        return pmh;
    };
    
    const pastMedicalHistory = getPastMedicalHistory();
    
    // Generate a fictional transcript
    const transcript = `
# Clinical Dictation

## Patient Information
- **Name**: ${firstName} ${lastName} (FICTIONAL PATIENT)
- **Age**: ${patientAge} years old
- **Gender**: ${patientGender}
- **Chief Complaint**: ${chiefComplaint}

## History of Present Illness
The patient presents today with ${chiefComplaint}. ${selectedSymptoms.length > 0 ? 'Associated symptoms include ' + selectedSymptoms.join(', ') + '.' : ''} Symptoms began approximately ${duration} ${durationUnit} ago and have been ${Math.random() > 0.5 ? 'gradually' : 'progressively'} ${Math.random() > 0.5 ? 'worsening' : 'changing'} since onset. 

The patient has tried ${Math.random() > 0.5 ? 'over-the-counter medications including NSAIDs and acetaminophen' : 'lifestyle modifications including dietary changes and increased physical activity'} with ${Math.random() > 0.7 ? 'minimal relief' : 'partial improvement'}. ${Math.random() > 0.5 ? 'Symptoms worsen with activity.' : 'Symptoms are worse in the morning.'} ${Math.random() > 0.5 ? 'The patient denies any recent trauma or injuries.' : 'No significant exacerbating factors identified.'}

## Past Medical History
${pastMedicalHistory.map(condition => `- ${condition}`).join('\n')}

## Medications
${Math.random() > 0.5 ? '- Lisinopril 10mg daily' : '- No anti-hypertensives'}
${Math.random() > 0.5 ? '- Metformin 500mg twice daily' : '- No anti-diabetics'}
${Math.random() > 0.5 ? '- Atorvastatin 20mg daily' : '- No lipid-lowering agents'}
${Math.random() > 0.5 ? '- Aspirin 81mg daily' : '- No antiplatelet therapy'}
${Math.random() > 0.5 ? '- Multivitamin daily' : '- No supplements'}

## Allergies
${Math.random() > 0.8 ? 'Penicillin (rash)' : 'No known drug allergies'}

## Social History
- Tobacco: ${Math.random() > 0.7 ? 'Current smoker, 1 pack per day for 15 years' : 'Never smoker'}
- Alcohol: ${Math.random() > 0.6 ? 'Social drinker, 2-3 drinks per week' : 'No alcohol consumption'}
- Occupation: ${Math.random() > 0.5 ? 'Office worker' : 'Construction worker'}
- Exercise: ${Math.random() > 0.5 ? 'Sedentary' : 'Moderate exercise 3 times per week'}

## Family History
- Father: ${Math.random() > 0.5 ? 'Hypertension, Myocardial infarction at age 65' : 'No significant medical history'}
- Mother: ${Math.random() > 0.5 ? 'Type 2 Diabetes, Breast cancer at age 58' : 'No significant medical history'}
- Siblings: ${Math.random() > 0.5 ? 'Brother with early-onset coronary artery disease' : 'No significant medical history'}

## Physical Examination
- **Vital Signs**: 
  - BP: ${vitals.systolic}/${vitals.diastolic} mmHg
  - HR: ${vitals.hr} bpm
  - RR: ${vitals.rr} /min
  - Temp: ${vitals.temp}°C
  - SpO2: ${vitals.spo2}% on room air
  - BMI: ${(Math.random() * 10 + 22).toFixed(1)} kg/m²

- **General**: Patient appears ${Math.random() > 0.5 ? 'well' : 'mildly distressed'} and ${Math.random() > 0.5 ? 'well-nourished' : 'slightly overweight'}
- **HEENT**: Normocephalic, atraumatic, PERRL, EOMI
- **Cardiovascular**: Regular rate and rhythm, no murmurs, rubs, or gallops
- **Respiratory**: Clear to auscultation bilaterally, no wheezes, rales, or rhonchi
- **Abdominal**: Soft, non-tender, non-distended, normal bowel sounds
- **Extremities**: No edema, pulses intact
- **Neurological**: Alert and oriented x3, cranial nerves II-XII intact

## Assessment and Plan
The patient presents with symptoms consistent with ${guideline.title || "a clinical condition that may benefit from guideline-based management"}. 

According to current clinical guidelines, the assessment and plan will include:
1. Further diagnostic evaluation
2. Appropriate management based on findings
3. Patient education regarding the condition
4. Follow-up recommendations

Will formulate a comprehensive management plan in accordance with current clinical guidelines.
`;

    // Apply to editor content
    if (window.setEditorContent) {
        window.setEditorContent(transcript);
        
        // Remove loading state
        if (editorElement) {
            editorElement.classList.remove('loading');
        }
        
        // Focus the editor
        setTimeout(() => {
            if (window.editor && window.editor.commands) {
                window.editor.commands.focus('end');
            }
        }, 100);
        
        // Show notice
        showNotice(`Generated fictional scenario for: ${guideline.title}`, "success");
        
        // Update UI state
        const suggestedGuidelines = document.getElementById('suggestedGuidelines');
        if (suggestedGuidelines) {
            suggestedGuidelines.style.display = 'block';
        }
        
        // Enable process button if it exists
        const processButton = document.getElementById('processButton') || document.getElementById('actionBtn');
        if (processButton) {
            processButton.disabled = false;
        }
    } else {
        console.error("Editor content setter function not available");
        
        // Try alternative method using TipTap directly
        try {
            if (window.clinicalNoteEditor) {
                // If we have access to the editor instance directly
                window.clinicalNoteEditor.commands.setContent(transcript);
                showNotice(`Generated fictional scenario for: ${guideline.title}`, "success");
                
                // Remove loading state
                if (editorElement) {
                    editorElement.classList.remove('loading');
                }
                
                // Update UI state
                const suggestedGuidelines = document.getElementById('suggestedGuidelines');
                if (suggestedGuidelines) {
                    suggestedGuidelines.style.display = 'block';
                }
                
                // Enable process button if it exists
                const processButton = document.getElementById('processButton') || document.getElementById('actionBtn');
                if (processButton) {
                    processButton.disabled = false;
                }
            } else if (document.getElementById('editor')) {
                // Try to set content via DOM
                const editorElement = document.getElementById('editor');
                editorElement.innerHTML = transcript;
                showNotice(`Generated fictional scenario for: ${guideline.title}`, "success");
                
                // Remove loading state
                editorElement.classList.remove('loading');
                
                // Update UI state
                const suggestedGuidelines = document.getElementById('suggestedGuidelines');
                if (suggestedGuidelines) {
                    suggestedGuidelines.style.display = 'block';
                }
                
                // Enable process button if it exists
                const processButton = document.getElementById('processButton') || document.getElementById('actionBtn');
                if (processButton) {
                    processButton.disabled = false;
                }
            } else if (document.getElementById('clinicalNoteOutput')) {
                // Last resort - try to find the clinical note output element
                const clinicalNoteOutput = document.getElementById('clinicalNoteOutput');
                clinicalNoteOutput.innerHTML = transcript;
                showNotice(`Generated fictional scenario for: ${guideline.title}`, "success");
                
                // Update UI state
                const suggestedGuidelines = document.getElementById('suggestedGuidelines');
                if (suggestedGuidelines) {
                    suggestedGuidelines.style.display = 'block';
                }
                
                // Enable process button if it exists
                const processButton = document.getElementById('processButton') || document.getElementById('actionBtn');
                if (processButton) {
                    processButton.disabled = false;
                }
            } else {
                showNotice("Failed to set editor content - editor not found", "error");
            }
        } catch (err) {
            console.error("Error setting editor content:", err);
            showNotice("Failed to set editor content", "error");
        }
    }
}

// Add to window object to make it accessible
window.generateScenario = generateScenario;

/**
 * Displays a notification message to the user
 * @param {string} message - The message to display
 * @param {string} type - The type of message (success, error, info)
 */
function showNotice(message, type = 'info') {
    // Remove any existing notices first
    const existingNotices = document.querySelectorAll('.notice');
    existingNotices.forEach(notice => {
        document.body.removeChild(notice);
    });
    
    // Create notice element
    const notice = document.createElement('div');
    notice.className = `notice ${type}`;
    notice.innerHTML = message;
    notice.style.position = 'fixed';
    notice.style.top = '20px';
    notice.style.right = '20px';
    notice.style.backgroundColor = type === 'success' ? '#4CAF50' : 
                                 type === 'error' ? '#F44336' : '#2196F3';
    notice.style.color = 'white';
    notice.style.padding = '15px 20px';
    notice.style.borderRadius = '4px';
    notice.style.boxShadow = '0 2px 5px rgba(0,0,0,0.2)';
    notice.style.zIndex = '9999';
    notice.style.opacity = '0';
    notice.style.transition = 'opacity 0.3s ease-in-out';
    
    // Add to DOM
    document.body.appendChild(notice);
    
    // Fade in
    setTimeout(() => {
        notice.style.opacity = '1';
    }, 10);
    
    // Auto remove after 5 seconds
    setTimeout(() => {
        notice.style.opacity = '0';
        setTimeout(() => {
            if (document.body.contains(notice)) {
                document.body.removeChild(notice);
            }
        }, 300);
    }, 5000);
}

/**
 * Shows a popup with a list of available guidelines for scenario generation
 */
function showScenarioSelectionPopup() {
    console.log("Showing scenario selection popup");
    
    // Create modal container
    const modal = document.createElement('div');
    modal.className = 'scenario-modal';
    modal.style.position = 'fixed';
    modal.style.top = '0';
    modal.style.left = '0';
    modal.style.width = '100%';
    modal.style.height = '100%';
    modal.style.backgroundColor = 'rgba(0, 0, 0, 0.5)';
    modal.style.display = 'flex';
    modal.style.justifyContent = 'center';
    modal.style.alignItems = 'center';
    modal.style.zIndex = '1000';
    
    // Create modal content
    const modalContent = document.createElement('div');
    modalContent.className = 'scenario-modal-content';
    modalContent.style.backgroundColor = 'white';
    modalContent.style.padding = '20px';
    modalContent.style.borderRadius = '5px';
    modalContent.style.maxWidth = '600px';
    modalContent.style.width = '90%';
    modalContent.style.maxHeight = '80vh';
    modalContent.style.overflowY = 'auto';
    
    // Create header
    const header = document.createElement('div');
    header.style.marginBottom = '20px';
    
    const title = document.createElement('h2');
    title.textContent = 'Select a Clinical Guideline';
    title.style.marginBottom = '10px';
    
    const description = document.createElement('p');
    description.textContent = 'Choose a guideline to generate a fictional clinical scenario:';
    
    header.appendChild(title);
    header.appendChild(description);
    
    // Create guidelines list container
    const guidelinesList = document.createElement('div');
    guidelinesList.className = 'guidelines-list';
    guidelinesList.style.display = 'flex';
    guidelinesList.style.flexDirection = 'column';
    guidelinesList.style.gap = '10px';
    guidelinesList.style.marginBottom = '20px';
    
    // Check if we have guidelines loaded
    if (!window.guidelineSummaries || !Array.isArray(window.guidelineSummaries) || window.guidelineSummaries.length === 0) {
        const noGuidelines = document.createElement('p');
        noGuidelines.textContent = 'No guidelines available. Please load guidelines first.';
        noGuidelines.style.color = 'red';
        guidelinesList.appendChild(noGuidelines);
    } else {
        // Add guidelines to the list
        window.guidelineSummaries.forEach((guideline, index) => {
            if (!guideline.title) return; // Skip guidelines without titles
            
            const guidelineItem = document.createElement('div');
            guidelineItem.className = 'guideline-item';
            guidelineItem.style.padding = '10px';
            guidelineItem.style.border = '1px solid #ddd';
            guidelineItem.style.borderRadius = '4px';
            guidelineItem.style.cursor = 'pointer';
            guidelineItem.style.transition = 'background-color 0.2s';
            
            const guidelineTitle = document.createElement('div');
            guidelineTitle.textContent = guideline.title;
            guidelineTitle.style.fontWeight = 'bold';
            
            guidelineItem.appendChild(guidelineTitle);
            
            // Add description if available
            if (guideline.description) {
                const guidelineDesc = document.createElement('div');
                guidelineDesc.textContent = guideline.description;
                guidelineDesc.style.fontSize = '0.9em';
                guidelineDesc.style.color = '#666';
                guidelineDesc.style.marginTop = '5px';
                guidelineItem.appendChild(guidelineDesc);
            }
            
            // Add hover effect
            guidelineItem.addEventListener('mouseover', () => {
                guidelineItem.style.backgroundColor = '#f0f0f0';
            });
            
            guidelineItem.addEventListener('mouseout', () => {
                guidelineItem.style.backgroundColor = 'white';
            });
            
            // Add click handler
            guidelineItem.addEventListener('click', () => {
                // Close modal
                document.body.removeChild(modal);
                
                // Generate scenario based on selected guideline
                generateScenario(guideline);
            });
            
            guidelinesList.appendChild(guidelineItem);
        });
    }
    
    // Create footer with close button
    const footer = document.createElement('div');
    footer.style.display = 'flex';
    footer.style.justifyContent = 'flex-end';
    
    const closeButton = document.createElement('button');
    closeButton.textContent = 'Cancel';
    closeButton.className = 'btn btn-secondary';
    closeButton.addEventListener('click', () => {
        document.body.removeChild(modal);
    });
    
    footer.appendChild(closeButton);
    
    // Assemble modal content
    modalContent.appendChild(header);
    modalContent.appendChild(guidelinesList);
    modalContent.appendChild(footer);
    modal.appendChild(modalContent);
    
    // Add modal to body
    document.body.appendChild(modal);
    
    // Close modal when clicking outside
    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            document.body.removeChild(modal);
        }
    });
}

// Add to window object to make it accessible
window.showScenarioSelectionPopup = showScenarioSelectionPopup;

// Function to load guidance data
async function loadGuidelineSummaries(retryCount = 0) {
    const MAX_RETRIES = 3;
    console.log('=== loadGuidelineSummaries ===');
    console.log('Current state:', {
        guidanceDataLoaded,
        filenamesLength: filenames.length,
        summariesLength: summaries.length,
        retryCount
    });
    
    try {
        console.log('Attempting to fetch guideline summaries from GitHub...');
        const response = await fetch('https://raw.githubusercontent.com/iannouvel/clerky/main/guidance/summary/list_of_summaries.json');
        console.log('Fetch response:', {
            ok: response.ok,
            status: response.status,
            statusText: response.statusText
        });
        
        if (!response.ok) {
            throw new Error('Network response was not ok: ' + response.status + ' ' + response.statusText);
        }
        
        console.log('Parsing JSON response...');
        const data = await response.json();
        console.log('JSON parsed successfully. Data structure:', {
            keys: Object.keys(data).length,
            hasData: !!data,
            sampleKey: Object.keys(data)[0]
        });
        
        // Store the data
        filenames = Object.keys(data);
        summaries = Object.values(data);
        
        console.log('Data stored successfully:', {
            filenamesLoaded: filenames.length,
            summariesLoaded: summaries.length,
            samplesMatch: filenames.length === summaries.length
        });
        
        // Process filenames and summaries into guideline objects
        window.guidelineSummaries = filenames.map((filename, index) => {
            // Extract title from filename by removing file extension and replacing underscores
            let title = filename.replace(/\.[^/.]+$/, ""); // Remove file extension
            title = title.replace(/_/g, " "); // Replace underscores with spaces
            
            // Get summary text
            const summary = summaries[index];
            
            // Create guideline object
            return {
                id: index,
                filename: filename,
                title: title,
                description: summary.substring(0, 200) + (summary.length > 200 ? '...' : ''),
                summary: summary
            };
        });
        
        console.log(`Processed ${window.guidelineSummaries.length} guidelines`);
        
        guidanceDataLoaded = true;
        return true;
    } catch (error) {
        console.error('Error in loadGuidelineSummaries:', {
            error: error.message,
            type: error.name,
            retryCount,
            maxRetries: MAX_RETRIES
        });
        
        if (retryCount < MAX_RETRIES) {
            console.log(`Retrying... (Attempt ${retryCount + 1} of ${MAX_RETRIES})`);
            // Wait for 1 second before retrying
            await new Promise(resolve => setTimeout(resolve, 1000));
            return loadGuidelineSummaries(retryCount + 1);
        }
        
        console.error('Max retries exceeded. Showing error to user.');
        // If we've exhausted retries, show an error message to the user
        const errorDiv = document.createElement('div');
        errorDiv.className = 'error-message';
        errorDiv.textContent = 'Failed to load guidelines. Please refresh the page and try again.';
        document.body.insertBefore(errorDiv, document.body.firstChild);
        
        return false;
    }
}

// Simplified server health check just returns true without UI updates
async function checkServerHealth() {
    // Simply return true as we now have retry logic for all server calls
    return true;
}

// Simplified ensureServerHealth function
async function ensureServerHealth() {
    // We now have retry logic for server calls, so no need to check health upfront
    return true;
}

// Initialize TipTap editors
function initializeEditors() {
    console.log('Initializing editors...');
    
    const clinicalNoteOutput = document.getElementById('clinicalNoteOutput');
    if (clinicalNoteOutput) {
        clinicalNoteEditor = initializeTipTap(clinicalNoteOutput, 'Write clinical note here...');
        
        // Listen for tiptap-update events
        clinicalNoteOutput.addEventListener('tiptap-update', (event) => {
            // You can add custom handling for content changes here if needed
            console.log('Clinical note updated:', event.detail.html);
        });
    }
    
    const summaryElement = document.getElementById('summary');
    if (summaryElement) {
        summaryEditor = initializeTipTap(summaryElement, 'Enter transcript here...');
        
        // Listen for tiptap-update events
        summaryElement.addEventListener('tiptap-update', (event) => {
            // You can add custom handling for content changes here if needed
            console.log('Summary updated:', event.detail.html);
        });
    }
}

// Define handleAction at the top level
async function handleAction(action, options = {}) {
    console.log(`Handling action: ${action}`);
    
    // Ensure we have the editor content
    const currentContent = getEditorContent();
    
    switch(action) {
        case 'test':
            // Updated test action to show scenario selection popup instead of generating a fake transcript
            window.showScenarioSelectionPopup();
            break;
        case 'process':
            // Existing process action logic
            break;
        default:
            // Handle other actions
            break;
    }
}

// Make handleAction available globally immediately
window.handleAction = handleAction;

// Modified DOMContentLoaded event listener
document.addEventListener('DOMContentLoaded', async function() {
    try {
        const loaded = await loadGuidelineSummaries();
        
        if (loaded) {
            // Make the clinicalNoteOutput element visible
            const clinicalNoteOutput = document.getElementById('clinicalNoteOutput');
            if (clinicalNoteOutput) {
                clinicalNoteOutput.style.display = 'block';
            }
            // Continue with initialization
            const loadingDiv = document.getElementById('loading');
            const userNameSpan = document.getElementById('userName');
            const promptsBtn = document.getElementById('promptsBtn');
            const linksBtn = document.getElementById('linksBtn');
            const guidelinesBtn = document.getElementById('guidelinesBtn');
            const workflowsBtn = document.getElementById('workflowsBtn');
            const mainSection = document.getElementById('mainSection');
            const promptsSection = document.getElementById('promptsSection');
            const linksSection = document.getElementById('linksSection');
            const guidelinesSection = document.getElementById('guidelinesSection');
            const savePromptsBtn = document.getElementById('savePromptsBtn');
            const promptIssues = document.getElementById('promptIssues');
            const promptGuidelines = document.getElementById('promptGuidelines');
            const promptNoteGenerator = document.getElementById('promptNoteGenerator');
            const recordBtn = document.getElementById('recordBtn');
            const generateClinicalNoteBtn = document.getElementById('generateClinicalNoteBtn');
            const actionBtn = document.getElementById('actionBtn');
            const summaryTextarea = document.getElementById('summary');
            const spinner = document.getElementById('spinner');
            const generateText = document.getElementById('generateText');
            const actionSpinner = document.getElementById('actionSpinner');
            const actionText = document.getElementById('actionText');
            const suggestedGuidelinesDiv = document.getElementById('suggestedGuidelines');
            const exportBtn = document.getElementById('exportBtn');
            const guidelinesList = document.getElementById('guidelinesList');
            const landingPage = document.getElementById('landingPage');
            const mainContent = document.getElementById('mainContent');
            const algosBtn = document.getElementById('algosBtn');
            const recordSymbol = document.getElementById('recordSymbol');
            const googleSignInBtn = document.getElementById('googleSignInBtn');
            const signOutBtn = document.getElementById('signOutBtn');
            const testBtn = document.getElementById('testBtn');
            const proformaBtn = document.getElementById('proformaBtn');
            const threeColumnView = document.getElementById('threeColumnView');
            const proformaView = document.getElementById('proformaView');
            const xCheckBtn = document.getElementById('xCheckBtn');
          
            // Firebase Authentication Provider
            const provider = new GoogleAuthProvider();

            // Function to show main content and hide the landing page
            function showMainContent() {
                landingPage.classList.add('hidden');
                mainContent.classList.remove('hidden');
            }

            // Function to show landing page and hide the main content
            function showLandingPage() {
                landingPage.classList.remove('hidden');
                mainContent.classList.add('hidden');
            }

            // Handle Sign-In
            let isSigningIn = false; // Prevent multiple popups
            googleSignInBtn.addEventListener('click', async () => {
                if (isSigningIn) return; // Block multiple sign-in attempts
                isSigningIn = true;
            
                try {
                    const result = await signInWithPopup(auth, provider);
                    const user = result.user;
                    showMainContent();
                } catch (error) {
                    if (error.code === 'auth/popup-blocked') {
                    } else if (error.code === 'auth/cancelled-popup-request') {
                    } else {
                    }
                } finally {
                    isSigningIn = false; // Reset flag
                }
            });

            // Handle Sign-out
            let isSigningOut = false; // Prevent multiple sign-out attempts
            signOutBtn.addEventListener('click', async () => {
                if (isSigningOut) return; // Block multiple requests
                isSigningOut = true;
            
                try {
                    await signOut(auth);
                    showLandingPage(); // Transition to the landing page
                } catch (error) {
                } finally {
                    isSigningOut = false; // Reset flag
                }
            });

            // Add these helper functions before generateFakeTranscript
            function getRandomInt(min, max) {
                return Math.floor(Math.random() * (max - min + 1)) + min;
            }

            // Generate a fake transcript
            async function generateFakeTranscript() {
                const testSpinner = document.getElementById('testSpinner');
                const testText = document.getElementById('testText');
            
                // Show spinner and hide text
                testSpinner.style.display = 'inline-block';
                testText.style.display = 'none';
            
                // Define retry settings
                const MAX_RETRIES = 3;
                const RETRY_DELAYS = [2000, 4000, 8000]; // 2, 4, 8 seconds

                // Helper function to delay execution
                const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

                let lastError = null;

                try {
                    // Get the current user's ID token
                    const user = auth.currentUser;
                    if (!user) {
                        throw new Error('Please sign in first');
                    }
                    const token = await user.getIdToken();

                    // Generate random patient data
                    const { age, bmi, previousPregnancies } = generateRandomPatientData();

                    // Fetch prompts
                    const prompts = await fetch('https://raw.githubusercontent.com/iannouvel/clerky/main/prompts.json')
                        .then(response => {
                            if (!response.ok) {
                                throw new Error(`Failed to fetch prompts: ${response.status} ${response.statusText}`);
                            }
                            return response.json();
                        })
                        .catch(error => {
                            console.error('Prompts fetch failed:', error);
                            throw new Error('Failed to load prompts configuration');
                        });

                    if (!prompts.testTranscript || !prompts.testTranscript.prompt) {
                        throw new Error('Test transcript prompt configuration is missing');
                    }

                    // Append the specific patient data to the prompt
                    const enhancedPrompt = `${prompts.testTranscript.prompt}\n\nMake the age ${age}, the BMI ${bmi} and the number of prior pregnancies ${previousPregnancies}`;

                    // Try the request with retries
                    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
                        try {
                            if (attempt > 0) {
                                console.log(`Retry attempt ${attempt}/${MAX_RETRIES} after ${RETRY_DELAYS[attempt-1]/1000} seconds...`);
                            }

                            console.log(`Making request to newFunctionName endpoint (attempt ${attempt+1}/${MAX_RETRIES+1})...`);
                            const response = await fetch(`${SERVER_URL}/newFunctionName`, {
                                method: 'POST',
                                credentials: 'include',
                                headers: { 
                                    'Content-Type': 'application/json',
                                    'Authorization': `Bearer ${token}`,
                                    'Accept': 'application/json'
                                },
                                body: JSON.stringify({ prompt: enhancedPrompt })
                            });

                            // If we get a successful response, process it
                            if (response.ok) {
                                const data = await response.json();
                                
                                if (data.success) {
                                    const summaryElement = document.getElementById('summary');
                                    
                                    // Check if the response is an object with a content property
                                    const responseText = data.response && typeof data.response === 'object' 
                                        ? data.response.content 
                                        : data.response;
                                        
                                    if (responseText) {
                                        // Convert newlines to <br> tags to preserve formatting
                                        const formattedText = responseText
                                            .replace(/\n/g, '<br>')
                                            .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>'); // Also convert Markdown bold to HTML
                                        
                                        setSummaryContent(formattedText);
                                        console.log('Successfully generated and displayed transcript');
                                        return; // Success, exit the function
                                    } else {
                                        console.error('Invalid response format:', data.response);
                                        throw new Error('Invalid response format from server');
                                    }
                                } else {
                                    throw new Error(data.message || 'Failed to generate transcript');
                                }
                            } else {
                                // If we get a non-OK response, throw to retry
                                const errorText = await response.text().catch(e => 'Could not read error response');
                                throw new Error(`Server error: ${response.status} ${response.statusText} - ${errorText}`);
                            }
                        } catch (error) {
                            lastError = error;
                            console.error(`Error generating transcript (attempt ${attempt+1}/${MAX_RETRIES+1}):`, error.message);
                            
                            // If this isn't the last attempt, wait before retrying
                            if (attempt < MAX_RETRIES) {
                                const retryDelay = RETRY_DELAYS[attempt];
                                console.log(`Will retry in ${retryDelay/1000} seconds...`);
                                await delay(retryDelay);
                            }
                        }
                    }
                    
                    // If we've exhausted all retries, throw the last error
                    console.error(`Failed to generate transcript after ${MAX_RETRIES+1} attempts`);
                    throw lastError || new Error('Failed to generate transcript after multiple attempts');
                } catch (error) {
                    alert(error.message || 'Failed to generate transcript. Please try again.');
                } finally {
                    // Hide spinner and restore text
                    testSpinner.style.display = 'none';
                    testText.style.display = 'inline-block';
                }
            }
            
            // Attach click event listener to the Test button
            testBtn.addEventListener('click', generateFakeTranscript);

          
            // Function to check if user is Ian Nouvel
            function isAdminUser(user) {
                return user && user.email === 'inouvel@gmail.com';
            }

            // Function to update button visibility based on user
            function updateButtonVisibility(user) {
                const adminButtons = [
                    'testBtn',
                    'promptsBtn',
                    'guidelinesBtn',
                    'algosBtn',
                    'linksBtn',
                    'workflowsBtn',
                    'proformaBtn',
                    'exportBtn'
                ];
                
                // Always show these buttons
                const alwaysShowButtons = [
                    'recordBtn',
                    'actionBtn',
                    'generateClinicalNoteBtn'
                ];
                
                // Show/hide admin buttons based on user
                adminButtons.forEach(btnId => {
                    const btn = document.getElementById(btnId);
                    if (btn) {
                        btn.style.display = isAdminUser(user) ? 'inline-block' : 'none';
                    }
                });
                
                // Ensure core buttons are always visible
                alwaysShowButtons.forEach(btnId => {
                    const btn = document.getElementById(btnId);
                    if (btn) {
                        btn.style.display = 'inline-block';
                    }
                });
            }

            // Update the updateUI function to include button visibility
            async function updateUI(user) {
                console.log('updateUI called with user:', user?.email);
                loadingDiv.classList.add('hidden'); // Hide the loading indicator once auth state is determined
                if (user) {
                    try {
                        // Check if user has accepted disclaimer
                        const disclaimerRef = doc(db, 'disclaimerAcceptance', user.uid);
                        console.log('Checking disclaimer acceptance for user:', user.uid);
                        const disclaimerDoc = await getDoc(disclaimerRef);
                        console.log('Disclaimer doc exists:', disclaimerDoc.exists());

                        if (!disclaimerDoc.exists()) {
                            console.log('No disclaimer acceptance found, redirecting to disclaimer page');
                            window.location.href = 'disclaimer.html';
                            return;
                        }

                        console.log('Disclaimer accepted, showing main content');
                        // If disclaimer is accepted, show main content
                        userNameSpan.textContent = user.displayName;
                        userNameSpan.classList.remove('hidden');
                        showMainContent();
                        updateButtonVisibility(user);

                        // Initialize model toggle
                        await initializeModelToggle();

                        // Check if we need to return to a previous page
                        const returnToPage = localStorage.getItem('returnToPage');
                        if (returnToPage) {
                            console.log('Returning to previous page:', returnToPage);
                            localStorage.removeItem('returnToPage'); // Clear the stored page
                            // Only redirect if we're not already on the target page
                            if (window.location.pathname !== '/' + returnToPage) {
                                window.location.href = returnToPage;
                            }
                        }
                    } catch (error) {
                        console.error('Error checking disclaimer:', error);
                        // If there's an error checking the disclaimer, redirect to disclaimer page
                        window.location.href = 'disclaimer.html';
                    }
                } else {
                    console.log('No user, showing landing page');
                    showLandingPage();
                    userNameSpan.classList.add('hidden');
                }
            }

            // Initial check of the auth state
            updateUI(auth.currentUser);

            // Register `onAuthStateChanged` listener to handle future auth state changes
            onAuthStateChanged(auth, updateUI);

            // Attach click listener for algos button
            if (algosBtn) {
                algosBtn.addEventListener('click', function () {
                    window.open('https://iannouvel.github.io/clerky/algos.html', '_blank'); // Open in new tab
                });
            }

            // Speech Recognition functionality
            if (window.SpeechRecognition || window.webkitSpeechRecognition) {
                const recognition = new (window.SpeechRecognition || window.webkitSpeechRecognition)();
                recognition.lang = 'en-US';
                recognition.interimResults = true;
                recognition.continuous = true;
                recognition.maxAlternatives = 1;
                let recording = false;

                recordBtn.addEventListener('click', function () {
                    if (!recording) {
                        recognition.start();
                        recording = true;
                        recordSymbol.textContent = "🔴"; // Show recording symbol
                    } else {
                        recognition.stop();
                        recording = false;
                        recordSymbol.textContent = ""; // Remove recording symbol
                    }
                });

                recognition.onstart = () => {};
                recognition.onend = () => {
                    if (recording) {
                        recognition.start();
                    } else {
                        recordSymbol.textContent = ""; // Reset recording symbol when stopped
                    }
                };

                recognition.onresult = (event) => {
                    const transcript = event.results[event.resultIndex][0].transcript;
                    if (event.results[event.resultIndex].isFinal) {
                        const summaryTextarea = document.getElementById('summary'); // Select the correct element by ID
                        if (summaryTextarea) {
                            const currentContent = getSummaryContent();
                            setSummaryContent(currentContent + transcript + "<br>");
                        } else {
                        }
                    } else {
                    }
                };

                recognition.onerror = (event) => {};
            } else {
            }
            
            let promptsData = JSON.parse(localStorage.getItem('promptsData')) || {}; // Retrieve saved prompts data from local storage

            // Populate filenames and summaries at the start
            let filenames = [];  // Initialize as empty
            let summaries = [];  // Initialize as empty

            fetch('https://raw.githubusercontent.com/iannouvel/clerky/main/guidance/summary/list_of_summaries.json')
                .then(response => {
                    if (!response.ok) { // Check for network errors
                        throw new Error('Network response was not ok ' + response.statusText);
                    }
                    return response.json(); // Parse the response as JSON
                })
                .then(data => {
                    // 'data' is the JSON object containing filenames and summaries
                    filenames = Object.keys(data); // Extract filenames
                    summaries = Object.values(data); // Extract summaries
            
                    // Now you can process the filenames and summaries as needed
            
                    // If you want to process them together:
                    filenames.forEach(filename => {
                        const summary = data[filename];
                    });
                })
                .catch(error => {
                });
            
            function loadPrompts() {
                console.log('Loading prompts into UI');
                // Try loading saved prompts data into the respective text areas
                try {
                    promptIssues.value = promptsData.promptIssues || document.getElementById('promptIssues').defaultValue; // Load issues
                    promptGuidelines.value = promptsData.promptGuidelines || document.getElementById('promptGuidelines').defaultValue; // Load guidelines
                    promptNoteGenerator.value = promptsData.promptNoteGenerator || document.getElementById('promptNoteGenerator').defaultValue; // Load note generator prompt
                    console.log('Loaded prompts into UI:', {
                        promptIssues: promptIssues.value,
                        promptGuidelines: promptGuidelines.value,
                        promptNoteGenerator: promptNoteGenerator.value
                    });
                } catch (error) {
                    console.error('Error loading prompts into UI:', error);
                }
            }

            function savePrompts() {
                // Save the current values of the prompts into local storage
                try {
                    promptsData.promptIssues = promptIssues.value || document.getElementById('promptIssues').defaultValue; // Save issues
                    promptsData.promptGuidelines = promptGuidelines.value || document.getElementById('promptGuidelines').defaultValue; // Save guidelines
                    promptsData.promptNoteGenerator = promptNoteGenerator.value || document.getElementById('promptNoteGenerator').defaultValue; // Save note generator prompt
                    localStorage.setItem('promptsData', JSON.stringify(promptsData)); // Store in local storage
                    alert('Prompts saved successfully!'); // Notify the user on successful save
                } catch (error) {
                }
            }

            savePromptsBtn.addEventListener('click', savePrompts); // Attach the savePrompts function to the save button

            // Select all tabs
            const tabs = document.querySelectorAll('.tab');

            // Handle prompts button click
            if (promptsBtn) {
                promptsBtn.addEventListener('click', () => {
                    window.open('prompts.html', '_blank');
                });
            }

            guidelinesBtn.addEventListener('click', () => {
                // Open guidelines.html in a new tab
                window.open('guidelines.html', '_blank');
            });

            async function loadLinks() {
                // Load links from a file and display them in the UI
                try {
                    const response = await fetch('links.txt'); // Fetch the links from a local file
                    const text = await response.text(); // Get the response text
                    const linksList = document.getElementById('linksList'); // Get the list element
                    linksList.innerHTML = ''; // Clear the list before adding new links
                    const links = text.split('\n'); // Split the text by line to get individual links
                    links.forEach(link => {
                        if (link.trim()) { // Check if the link is not empty
                            const [text, url] = link.split(';'); // Split the text into link description and URL
                            const listItem = document.createElement('li'); // Create a list item
                            const anchor = document.createElement('a'); // Create an anchor tag
                            anchor.href = url.trim(); // Set the anchor href
                            anchor.textContent = text.trim(); // Set the anchor text content
                            anchor.target = '_blank'; // Open the link in a new tab
                            listItem.appendChild(anchor); // Append the anchor to the list item
                            linksList.appendChild(listItem); // Append the list item to the list
                        }
                    });
                } catch (error) {
                }
            }

            async function loadGuidelines() {
                // Load guidelines from a remote file and display them in the UI
                guidelinesList.innerHTML = ''; // Clear existing guidelines

                fetch('https://raw.githubusercontent.com/iannouvel/clerky/main/guidance/list_of_guidelines.txt')
                    .then(response => response.text()) // Get the text response
                    .then(data => {
                        const guidelines = data.split('\n').filter(line => line.trim() !== ''); // Filter non-empty lines
                        guidelines.forEach(guideline => {
                            const listItem = document.createElement('li'); // Create a list item
                            const link = document.createElement('a'); // Create an anchor tag
                            const formattedGuideline = guideline.trim(); // Clean up the guideline text
                            const pdfGuideline = formattedGuideline.replace(/\.txt$/i, '.pdf'); // Convert txt to pdf
                            link.href = `https://github.com/iannouvel/clerky/raw/main/guidance/${encodeURIComponent(pdfGuideline)}`; // Set the URL
                            link.textContent = formattedGuideline; // Set the link text
                            link.target = '_blank'; // Open in a new tab

                            const algoLink = document.createElement('a'); // Create an additional link for algo
                            const htmlFilename = formattedGuideline.replace(/\.pdf$/i, '.html'); // Convert PDF to HTML filename
                            const algoUrl = `https://iannouvel.github.io/clerky/algos/${encodeURIComponent(htmlFilename)}`;
                            algoLink.href = algoUrl; // Set the algo link URL
                            algoLink.textContent = 'Algo'; // Set the algo link text
                            algoLink.target = '_blank'; // Open algo in a new tab
                            algoLink.style.marginLeft = '10px'; // Add space between the links

                            listItem.appendChild(link); // Add the main guideline link
                            listItem.appendChild(algoLink); // Add the algo link
                            guidelinesList.appendChild(listItem); // Append to the guidelines list
                        });
                    })
                    .catch(error => {}); // Log error if loading guidelines fails
            }

            // Add this helper function to collect proforma data
            function collectProformaData() {
                const obsProforma = document.getElementById('obsProforma');
                const gynProforma = document.getElementById('gynProforma');
                
                if (!obsProforma || !gynProforma) {
                    return { type: null, fields: {} };
                }

                const isObstetric = !obsProforma.classList.contains('hidden');
                const data = {
                    type: isObstetric ? 'obstetric' : 'gynaecological',
                    fields: {}
                };

                // Get all inputs from the active proforma
                const proforma = isObstetric ? obsProforma : gynProforma;
                const inputs = proforma.querySelectorAll('input, textarea, select');
                
                inputs.forEach(input => {
                    if (input.id && input.value) {
                        data.fields[input.id] = input.value;
                    }
                });

                return data;
            }

            // Modify generateClinicalNote to check server health first
            async function generateClinicalNote() {
                if (!await ensureServerHealth()) return;
                
                try {
                    const spinner = document.getElementById('spinner');
                    const generateText = document.getElementById('generateText');

                    // Show spinner and hide text
                    spinner.style.display = 'inline-block';
                    generateText.style.display = 'none';

                    // Fetch prompts from prompts.json
                    const prompts = await fetch('https://raw.githubusercontent.com/iannouvel/clerky/main/prompts.json')
                        .then(response => response.json());

                    const summaryDiv = document.getElementById('summary');
                    const text = summaryDiv.textContent.trim();
                    if (text === '') {
                        alert('Please enter text into the summary field.');
                        return;
                    }

                    const proformaData = collectProformaData();
                    
                    // Get the clinical note template and fill it with the text
                    let enhancedPrompt = prompts.clinicalNote.prompt;

                    // Add proforma data if it exists
                    if (proformaData.fields && Object.keys(proformaData.fields).length > 0) {
                        enhancedPrompt += `\n\nAdditional information from the ${proformaData.type} proforma:\n`;
                        for (const [key, value] of Object.entries(proformaData.fields)) {
                            if (value && value.trim()) {
                                const fieldName = key
                                    .replace(/^(obs|gyn)-/, '')
                                    .split('-')
                                    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
                                    .join(' ');
                                enhancedPrompt += `${fieldName}: ${value}\n`;
                            }
                        }
                        enhancedPrompt += '\nClinical transcript:\n';
                    }
                    
                    // Replace the {{text}} placeholder with the actual text
                    enhancedPrompt = enhancedPrompt.replace('{{text}}', text);

                    const user = auth.currentUser;
                    if (!user) {
                        throw new Error('Please sign in first');
                    }
                    const token = await user.getIdToken();

                    const response = await fetch(`${SERVER_URL}/newFunctionName`, {
                        method: 'POST',
                        headers: { 
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${token}`
                        },
                        body: JSON.stringify({ 
                            prompt: enhancedPrompt
                        })
                    });

                    if (!response.ok) {
                        const errorText = await response.text();
                        throw new Error(`Server error: ${errorText}`);
                    }

                    const data = await response.json();

                    if (data.success) {
                        // Extract the content from the response object if needed
                        const responseText = data.response && typeof data.response === 'object' 
                            ? data.response.content 
                            : data.response;
                            
                        if (!responseText) {
                            console.error('Invalid response format:', data.response);
                            throw new Error('Invalid response format from server');
                        }
                        
                        let formattedResponse = responseText
                            .replace(/\n{3,}/g, '\n\n')
                            .trim();
                        setClinicalNoteContent(formattedResponse.replace(/\n/g, '<br>'));
                    } else {
                        throw new Error(data.message || 'Failed to generate note');
                    }
                } catch (error) {
                    alert(error.message || 'Failed to generate clinical note. Please try again.');
                } finally {
                    // Hide spinner and restore text
                    spinner.style.display = 'none';
                    generateText.style.display = 'inline-block';
                }
            }

            generateClinicalNoteBtn.addEventListener('click', generateClinicalNote);

            const MAX_RETRIES = 2;

            // Add workflows button click handler
            if (workflowsBtn) {
                workflowsBtn.addEventListener('click', function() {
                    window.open('workflows.html', '_blank');
                });
            }

            // Attach the handleAction function to the action button
            actionBtn.addEventListener('click', handleAction);

            // Add event listener for X-check button
            if (xCheckBtn) {
                xCheckBtn.addEventListener('click', async function() {
                    if (!await ensureServerHealth()) return;
                    
                    // Get spinner and text elements
                    const xCheckSpinner = document.getElementById('xCheckSpinner');
                    const xCheckText = document.getElementById('xCheckText');
                    
                    // Show spinner and hide text
                    if (xCheckSpinner && xCheckText) {
                        xCheckSpinner.style.display = 'inline-block';
                        xCheckText.style.display = 'none';
                    }
                    xCheckBtn.disabled = true;
                    
                    try {
                        const summaryElement = document.getElementById('summary');
                        const clinicalNoteOutput = document.getElementById('clinicalNoteOutput');
                        const suggestedGuidelines = document.getElementById('suggestedGuidelines');
                        
                        if (!summaryElement || !clinicalNoteOutput) {
                            console.error('Required elements not found');
                            return;
                        }

                        const summaryText = getSummaryContent();
                        const clinicalNoteText = getClinicalNoteContent();

                        if (!summaryText || !clinicalNoteText) {
                            alert('Please ensure both the transcript and clinical note are populated before X-checking.');
                            return;
                        }

                        // Get the guidelines from the suggested guidelines container
                        const guidelines = Array.from(suggestedGuidelines.querySelectorAll('.accordion-item'))
                            .map(item => {
                                // Get only the text from the header (which contains the issue)
                                const header = item.querySelector('.accordion-header');
                                if (!header) return null;
                                
                                // Get all guideline links from the content
                                const guidelineLinks = Array.from(item.querySelectorAll('.guidelines-list a'))
                                    .filter(a => !a.textContent.includes('Algo')) // Exclude Algo links
                                    .map(a => a.textContent.trim())
                                    .filter(text => text); // Remove empty strings
                                    
                                return guidelineLinks;
                            })
                            .flat() // Flatten the array of arrays
                            .filter(text => text); // Remove null/empty values

                        if (guidelines.length === 0) {
                            alert('No guidelines available to check against. Please add some guidelines first.');
                            return;
                        }

                        // Create popup content with guideline toggles
                        const popupContent = `
                            <div style="padding: 20px;">
                                <h3 style="margin: 0 0 15px 0; font-size: 16px;">Select Guidelines for X-check</h3>
                                <div style="display: flex; gap: 10px; margin-bottom: 15px;">
                                    <button onclick="selectAllGuidelines()" 
                                            class="modal-btn secondary" 
                                            style="padding: 6px 12px; font-size: 14px;">Select All</button>
                                    <button onclick="deselectAllGuidelines()" 
                                            class="modal-btn secondary" 
                                            style="padding: 6px 12px; font-size: 14px;">Deselect All</button>
                                </div>
                                <div id="guidelineToggles" style="margin: 0; max-height: 300px; overflow-y: auto;">
                                    <form style="display: flex; flex-direction: column; gap: 8px;">
                                        ${guidelines.map((guideline, index) => `
                                            <label style="display: flex; align-items: flex-start; padding: 4px 0; cursor: pointer;">
                                                <input type="checkbox" 
                                                       id="guideline${index}" 
                                                       checked 
                                                       style="margin: 3px 10px 0 0;">
                                                <span style="font-size: 14px; line-height: 1.4;">${guideline}</span>
                                            </label>
                                        `).join('')}
                                    </form>
                                </div>
                                <div style="display: flex; justify-content: flex-end; gap: 10px; margin-top: 20px; border-top: 1px solid #eee; padding-top: 15px;">
                                    <button onclick="this.closest('.popup').remove(); document.querySelector('.overlay').remove()" 
                                            class="modal-btn secondary" 
                                            style="padding: 6px 12px; font-size: 14px;">Cancel</button>
                                    <button onclick="performXCheck(this)" 
                                            class="modal-btn primary" 
                                            style="padding: 6px 12px; font-size: 14px;">Run X-check</button>
                                </div>
                            </div>
                        `;

                        // Show popup
                        const popup = showPopup(popupContent);

                        // Add the selectAllGuidelines and deselectAllGuidelines functions to the window object
                        window.selectAllGuidelines = function() {
                            document.querySelectorAll('#guidelineToggles input[type="checkbox"]').forEach(checkbox => {
                                checkbox.checked = true;
                            });
                        };

                        window.deselectAllGuidelines = function() {
                            document.querySelectorAll('#guidelineToggles input[type="checkbox"]').forEach(checkbox => {
                                checkbox.checked = false;
                            });
                        };

                        // Add the performXCheck function to the window object
                        window.performXCheck = async function(button) {
                            const selectedGuidelines = Array.from(document.querySelectorAll('#guidelineToggles input:checked'))
                                .map((checkbox, index) => guidelines[index]);

                            if (selectedGuidelines.length === 0) {
                                alert('Please select at least one guideline to check against.');
                                return;
                            }

                            // Disable the button and show loading state
                            button.disabled = true;
                            button.innerHTML = '<span class="spinner">&#x21BB;</span> Processing...';

                            try {
                                const user = auth.currentUser;
                                if (!user) {
                                    throw new Error('Please sign in first');
                                }
                                const token = await user.getIdToken();

                                // Add retry logic
                                const MAX_RETRIES = 3;
                                const RETRY_DELAYS = [2000, 4000, 8000]; // 2, 4, 8 seconds
                                let lastError = null;

                                for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
                                    try {
                                        console.log(`Making request to crossCheck endpoint (attempt ${attempt + 1}/${MAX_RETRIES})...`);
                                        const response = await fetch(`${SERVER_URL}/crossCheck`, {
                                            method: 'POST',
                                            headers: {
                                                'Content-Type': 'application/json',
                                                'Authorization': `Bearer ${token}`
                                            },
                                            body: JSON.stringify({
                                                clinicalNote: getClinicalNoteContent(),
                                                guidelines: selectedGuidelines
                                            })
                                        });

                                        if (response.ok) {
                                            const data = await response.json();
                                            console.log('CrossCheck Response:', data);

                                            // Handle the response data
                                            if (typeof data.updatedNote === 'string') {
                                                // If it's a string, try to extract HTML content
                                                const htmlMatch = data.updatedNote.match(/```html\n([\s\S]*?)\n```/);
                                                console.log('HTML Match:', htmlMatch);
                                                
                                                if (htmlMatch && htmlMatch[1]) {
                                                    console.log('Found HTML content, updating clinical note output with track changes');
                                                    const suggestedHtml = htmlMatch[1];
                                                    const originalHtml = getClinicalNoteContent();
                                                    originalClinicalNoteContent = originalHtml;
                                                    
                                                    // Add track changes toolbar and apply tracked changes
                                                    const changesResult = applyTrackChanges(clinicalNoteEditor, originalHtml, suggestedHtml);
                                                    addTrackChangesToolbar(changesResult);
                                                } else {
                                                    console.log('No HTML content found, using raw response with track changes');
                                                    const suggestedText = data.updatedNote.replace(/\n/g, '<br>');
                                                    const originalHtml = getClinicalNoteContent();
                                                    originalClinicalNoteContent = originalHtml;
                                                    
                                                    // Add track changes toolbar and apply tracked changes
                                                    const changesResult = applyTrackChanges(clinicalNoteEditor, originalHtml, suggestedText);
                                                    addTrackChangesToolbar(changesResult);
                                                }
                                            } else if (typeof data.updatedNote === 'object') {
                                                // If it's an object, try to find HTML content in the object
                                                const suggestedHtml = data.updatedNote.html || data.updatedNote.content || JSON.stringify(data.updatedNote);
                                                const originalHtml = getClinicalNoteContent();
                                                originalClinicalNoteContent = originalHtml;
                                                
                                                // Add track changes toolbar and apply tracked changes
                                                const changesResult = applyTrackChanges(clinicalNoteEditor, originalHtml, suggestedHtml);
                                                addTrackChangesToolbar(changesResult);
                                            } else {
                                                console.error('Unexpected response format:', data.updatedNote);
                                                throw new Error('Unexpected response format from server');
                                            }

                                            alert('X-check completed successfully. Note has been updated with suggested improvements. You can now accept or reject the changes.');
                                            return; // Success, exit the retry loop
                                        }

                                        // If we get a 502 Bad Gateway or CORS error and haven't exceeded retries
                                        if ((response.status === 502 || response.status === 0) && attempt < MAX_RETRIES - 1) {
                                            const delay = RETRY_DELAYS[attempt];
                                            console.log(`Server returned ${response.status}, retrying in ${delay/1000} seconds...`);
                                            await new Promise(resolve => setTimeout(resolve, delay));
                                            continue;
                                        }

                                        // If we get here, the response wasn't ok and we've either exhausted retries or it's not a retryable error
                                        const errorText = await response.text();
                                        throw new Error(`Server error (${response.status}): ${errorText}`);
                                    } catch (error) {
                                        lastError = error;
                                        console.error(`Attempt ${attempt + 1} failed:`, error);
                                        
                                        // If it's a network error and we haven't exceeded retries
                                        if ((error.name === 'TypeError' || error.message.includes('Failed to fetch')) && attempt < MAX_RETRIES - 1) {
                                            const delay = RETRY_DELAYS[attempt];
                                            console.log(`Network error, retrying in ${delay/1000} seconds...`);
                                            await new Promise(resolve => setTimeout(resolve, delay));
                                            continue;
                                        }
                                        
                                        // If we get here, we've either exhausted retries or it's not a retryable error
                                        throw error;
                                    }
                                }

                                // If we get here, all retries failed
                                throw lastError || new Error('All retry attempts failed');
                            } catch (error) {
                                console.error('Error during X-check:', error);
                                alert('Failed to perform X-check: ' + error.message);
                            } finally {
                                // Close the popup
                                popup.remove();
                            }
                        };
                    } catch (error) {
                        console.error('Error during X-check:', error);
                        alert('Failed to perform X-check: ' + error.message);
                    } finally {
                        // Reset button state
                        if (xCheckSpinner && xCheckText) {
                            xCheckSpinner.style.display = 'none';
                            xCheckText.style.display = 'inline-block';
                        }
                        xCheckBtn.disabled = false;
                    }
                });
            }

            // Set initial model toggle text and state
            const modelToggle = document.getElementById('modelToggle');
            if (modelToggle) {
                const modelName = currentModel === 'OpenAI' ? 'gpt-3.5-turbo' : 'deepseek-chat';
                modelToggle.textContent = `AI: ${currentModel} (${modelName})`;
                modelToggle.classList.toggle('active', currentModel === 'DeepSeek');
                modelToggle.addEventListener('click', updateAIModel);
            }

            initializeEditors();

        } else {
            // Handle the error case
        }
    } catch (error) {
        console.error('Error in DOMContentLoaded:', error);
        alert('Failed to initialize the application. Please try again later.');
    }
});

// Add this after the other button declarations in the DOMContentLoaded event listener
const proformaBtn = document.getElementById('proformaBtn');
const threeColumnView = document.getElementById('threeColumnView');
const proformaView = document.getElementById('proformaView');

// Add this to the event listener section
if (proformaBtn) {
    proformaBtn.addEventListener('click', function() {
        // Toggle button active state
        proformaBtn.classList.toggle('active');
        
        // Toggle between views
        const isProformaView = proformaBtn.classList.contains('active');
        
        // Show/hide appropriate views
        threeColumnView.style.display = isProformaView ? 'none' : 'flex';
        proformaView.style.display = isProformaView ? 'flex' : 'none';
        
        // Copy content from main summary to proforma summary if switching to proforma view
        if (isProformaView) {
            const proformaSummary = document.getElementById('proformaSummary');
            const mainSummary = document.getElementById('summary');
            proformaSummary.value = mainSummary.value;
        }
    });
}

// Add this to sync the content between textareas
const mainSummary = document.getElementById('summary');
const proformaSummary = document.getElementById('proformaSummary');

if (mainSummary && proformaSummary) {
    mainSummary.addEventListener('input', function() {
        proformaSummary.value = this.value;
    });

    proformaSummary.addEventListener('input', function() {
        mainSummary.value = this.value;
    });
}

// Add this after the other DOM element declarations in the DOMContentLoaded event listener
const clerkyTitle = document.querySelector('.center-title');

// Update the clerky title click handler
if (clerkyTitle) {
    clerkyTitle.addEventListener('click', function() {
        // Hide all sections first
        mainSection.classList.remove('hidden');
        promptsSection.classList.add('hidden');
        linksSection.classList.add('hidden');
        guidelinesSection.classList.add('hidden');
        
        // Switch back to three-column view
        threeColumnView.style.display = 'flex';
        proformaView.style.display = 'none';
        
        // Update proforma button state
        proformaBtn.classList.remove('active');
        
        // Update tab states if they exist
        tabs.forEach(tab => {
            if (tab.dataset.tab === 'main') {
                tab.classList.add('active');
            } else {
                tab.classList.remove('active');
            }
        });
    });
}

// Add this after your other DOM content loaded event listeners
const obsProformaBtn = document.getElementById('obsProformaBtn');
const gynProformaBtn = document.getElementById('gynProformaBtn');
const obsProforma = document.getElementById('obsProforma');
const gynProforma = document.getElementById('gynProforma');

obsProformaBtn.addEventListener('click', () => {
    obsProformaBtn.classList.add('active');
    gynProformaBtn.classList.remove('active');
    obsProforma.classList.remove('hidden');
    gynProforma.classList.add('hidden');
});

gynProformaBtn.addEventListener('click', () => {
    gynProformaBtn.classList.add('active');
    obsProformaBtn.classList.remove('active');
    gynProforma.classList.remove('hidden');
    obsProforma.classList.add('hidden');
});

// Add after your other DOM content loaded event listeners
const populateProformaBtn = document.getElementById('populateProformaBtn');

populateProformaBtn.addEventListener('click', async () => {
    const transcript = document.getElementById('proformaSummary').value;

    if (!transcript.trim()) {
        alert('Please enter a transcript first');
        return;
    }

    // Show spinner and hide text
    const populateSpinner = document.getElementById('populateSpinner');
    const populateText = document.getElementById('populateText');
    populateSpinner.style.display = 'inline-block';
    populateText.style.display = 'none';
    populateProformaBtn.disabled = true;

    try {
        const isObstetric = !obsProforma.classList.contains('hidden');
        const proformaType = isObstetric ? 'obstetric' : 'gynaecological';
        
        const prompt = `Please extract relevant information from the following clinical transcript to populate a ${proformaType} proforma. 
        Return ONLY a JSON object (no markdown, no code blocks) with the following structure:
        ${getProformaStructure(proformaType)}
        
        Only include fields where information is available in the transcript. Use null for missing values.
        
        Transcript:
        ${transcript}`;

        const response = await fetch(`${SERVER_URL}/newFunctionName`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prompt })
        });

        if (!response.ok) {
            throw new Error('Failed to get AI response');
        }

        const data = await response.json();

        if (data.success) {
            // Extract the content from the response object if needed
            let jsonStr = data.response && typeof data.response === 'object' 
                ? data.response.content 
                : data.response;
                
            if (!jsonStr) {
                console.error('Invalid response format:', data.response);
                throw new Error('Invalid response format from server');
            }
            
            jsonStr = jsonStr.replace(/```json\n?/g, '');
            jsonStr = jsonStr.replace(/```\n?/g, '');
            jsonStr = jsonStr.trim();
            
            const proformaData = JSON.parse(jsonStr);
            
            populateProformaFields(proformaData, proformaType);
        } else {
            throw new Error(data.message || 'Failed to process response');
        }
    } catch (error) {
        alert('Failed to populate proforma. Please try again.');
    } finally {
        // Reset button state
        populateSpinner.style.display = 'none';
        populateText.style.display = 'inline-block';
        populateProformaBtn.disabled = false;
    }
});

// Helper function to get the proforma structure for the prompt
function getProformaStructure(type) {
    if (type === 'obstetric') {
        return `{
            "demographics": {
                "name": string,
                "age": number,
                "hospitalNo": string,
                "date": string (YYYY-MM-DD format),
                "time": string (HH:mm format)
            },
            "obstetricHistory": {
                "gravida": number,
                "para": number,
                "edd": string (YYYY-MM-DD format),
                "gestation": string,
                "previousDeliveries": string
            },
            "currentPregnancy": {
                "antenatalCare": "regular" | "irregular",
                "bloodGroup": string,
                "rhesus": string,
                "bookingBMI": number,
                "complications": string
            },
            "currentAssessment": {
                "presentingComplaint": string,
                "contractions": boolean,
                "fetalMovements": "normal" | "reduced",
                "vaginalLoss": "none" | "show" | "liquor" | "blood"
            },
            "examination": {
                "bp": string,
                "pulse": number,
                "temp": number,
                "fundalHeight": number,
                "lie": string,
                "presentation": string,
                "fh": number
            }
        }`;
    } else {
        return `{
            "demographics": {
                "name": string,
                "age": number,
                "hospitalNo": string,
                "date": string (YYYY-MM-DD format),
                "time": string (HH:mm format)
            },
            "presentingComplaint": string,
            "gynaecologicalHistory": {
                "lmp": string,
                "menstrualCycle": "regular" | "irregular",
                "contraception": string,
                "previousSurgery": string
            },
            "obstetricHistory": {
                "gravida": number,
                "para": number,
                "details": string
            },
            "examination": {
                "bp": string,
                "pulse": number,
                "temp": number,
                "abdominalExam": string,
                "vaginalExam": string
            }
        }`;
    }
}

// Function to update the AI model
async function updateAIModel() {
    const modelToggle = document.getElementById('modelToggle');
    
    // Store original button state
    const originalText = modelToggle.textContent;
    
    // Define retry settings
    const MAX_RETRIES = 3;
    const RETRY_DELAYS = [2000, 4000, 8000]; // 2, 4, 8 seconds

    // Helper function to delay execution
    const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
    
    // Show loading state
    modelToggle.disabled = true;
    modelToggle.textContent = 'Updating...';
    
    let lastError = null;
    
    try {
        const user = auth.currentUser;
        if (!user) {
            // Redirect to login page if not authenticated
            window.location.href = 'login.html';
            return;
        }
        
        // Toggle model preference
        currentModel = currentModel === 'OpenAI' ? 'DeepSeek' : 'OpenAI';
        
        // Get the current Firebase token
        const firebaseToken = await user.getIdToken();
        if (!firebaseToken) {
            throw new Error('Failed to get authentication token');
        }
        
        // Try the request with retries
        for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
            try {
                if (attempt > 0) {
                    console.log(`Retry attempt ${attempt}/${MAX_RETRIES} for updating AI model after ${RETRY_DELAYS[attempt-1]/1000} seconds...`);
                }
                
                console.log(`Sending request to update AI preference (attempt ${attempt+1}/${MAX_RETRIES+1})...`);
                // Send request to update AI preference
                const response = await fetch(`${SERVER_URL}/updateAIPreference`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${firebaseToken}`
                    },
                    body: JSON.stringify({ provider: currentModel })
                });
                
                // If we get a successful response, process it
                if (response.ok || response.status === 202) {
                    const responseData = await response.json();
                    console.log('Server response:', responseData);
                    
                    // Accept both 200 OK and 202 Accepted responses
                    currentModel = responseData.provider;
                    const modelName = currentModel === 'OpenAI' ? 'gpt-3.5-turbo' : 'deepseek-chat';
                    modelToggle.textContent = `AI: ${currentModel} (${modelName})`;
                    modelToggle.classList.toggle('active', currentModel === 'DeepSeek');
                    
                    // Show warning if preference might not persist
                    if (responseData.warning) {
                        console.warn('Warning from server:', responseData.warning);
                        // Optional: Display warning to user
                    }
                    
                    console.log('Successfully updated AI model to:', currentModel);
                    return; // Success, exit the function
                } else {
                    // If we get a non-OK response, throw to retry
                    const errorText = await response.text().catch(e => 'Could not read error response');
                    throw new Error(`Server returned ${response.status} ${response.statusText} - ${errorText}`);
                }
            } catch (error) {
                lastError = error;
                console.error(`Error updating AI model (attempt ${attempt+1}/${MAX_RETRIES+1}):`, error.message);
                
                // If this isn't the last attempt, wait before retrying
                if (attempt < MAX_RETRIES) {
                    const retryDelay = RETRY_DELAYS[attempt];
                    console.log(`Will retry updating AI model in ${retryDelay/1000} seconds...`);
                    await delay(retryDelay);
                }
            }
        }
        
        // If we've exhausted all retries, throw the last error
        console.error(`Failed to update AI model after ${MAX_RETRIES+1} attempts`);
        throw lastError || new Error('Failed to update AI model after multiple attempts');
    } catch (error) {
        console.error('Error updating AI model:', error);
        // Restore original button state
        modelToggle.textContent = originalText;
        modelToggle.disabled = false;
        alert('Failed to update AI model. Please try again later.');
    } finally {
        // Make sure button is re-enabled regardless of outcome
        modelToggle.disabled = false;
    }
}

// Add this function to initialize the model toggle
async function initializeModelToggle() {
    const modelToggle = document.getElementById('modelToggle');
    if (!modelToggle) return;

    // Define retry settings
    const MAX_RETRIES = 3;
    const RETRY_DELAYS = [2000, 4000, 8000]; // 2, 4, 8 seconds

    // Helper function to delay execution
    const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

    let lastError = null;

    try {
        const user = auth.currentUser;
        if (!user) {
            modelToggle.disabled = true;
            return;
        }

        // Get the current Firebase token
        const firebaseToken = await user.getIdToken();
        if (!firebaseToken) {
            throw new Error('Failed to get authentication token');
        }

        // Try the request with retries
        for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
            try {
                if (attempt > 0) {
                    console.log(`Retry attempt ${attempt}/${MAX_RETRIES} for model toggle after ${RETRY_DELAYS[attempt-1]/1000} seconds...`);
                }

                // Get user's AI preference from the server
                console.log(`Fetching AI preference (attempt ${attempt+1}/${MAX_RETRIES+1})...`);
                const response = await fetch(`${SERVER_URL}/updateAIPreference`, {
                    method: 'GET',
                    headers: {
                        'Authorization': `Bearer ${firebaseToken}`
                    }
                });

                if (response.ok) {
                    const data = await response.json();
                    currentModel = data.provider;
                    const modelName = currentModel === 'OpenAI' ? 'gpt-3.5-turbo' : 'deepseek-chat';
                    modelToggle.textContent = `AI: ${currentModel} (${modelName})`;
                    modelToggle.classList.toggle('active', currentModel === 'DeepSeek');
                    console.log('Successfully initialized model toggle with preference:', currentModel);
                    return; // Success, exit the function
                } else {
                    // If we get a non-OK response, throw to retry
                    const errorText = await response.text().catch(e => 'Could not read error response');
                    throw new Error(`Server returned ${response.status} ${response.statusText} - ${errorText}`);
                }
            } catch (error) {
                lastError = error;
                console.error(`Error initializing model toggle (attempt ${attempt+1}/${MAX_RETRIES+1}):`, error.message);
                
                // If this isn't the last attempt, wait before retrying
                if (attempt < MAX_RETRIES) {
                    const retryDelay = RETRY_DELAYS[attempt];
                    console.log(`Will retry model toggle in ${retryDelay/1000} seconds...`);
                    await delay(retryDelay);
                }
            }
        }
        
        // If we've exhausted all retries, fall back to a default
        console.error(`Failed to get AI preference after ${MAX_RETRIES+1} attempts, using default`);
        modelToggle.textContent = `AI: DeepSeek (deepseek-chat)`;
        modelToggle.classList.add('active');
        throw lastError || new Error('Failed to initialize model toggle after multiple attempts');
    } catch (error) {
        console.error('Error initializing model toggle:', error);
        // Don't disable the toggle, just show default
        modelToggle.textContent = `AI: DeepSeek (deepseek-chat)`;
    }
}

// Update the displayIssues function to use the global arrays
async function displayIssues(response, prompts) {
    console.log('=== displayIssues ===');
    console.log('Input response:', response);
    
    // Parse the AI response into an array of issues
    let issues = [];
    
    // If response is already an array, use it directly
    if (Array.isArray(response)) {
        issues = response;
    } 
    // If it's a string, parse the text into an array of issues
    else if (typeof response === 'string') {
        // Split by new lines and clean up each issue
        issues = response.split('\n')
            .map(line => line.trim())
            .filter(line => line.length > 0)
            // Remove numbering if present (like "1. ", "2. ", etc.)
            .map(line => line.replace(/^\d+[\.\)\-]\s*/, '').trim())
            // Remove bullet points if present
            .map(line => line.replace(/^[\-\*•]\s*/, '').trim())
            .filter(line => line.length > 0);
    }
    
    console.log('Parsed issues:', {
        issuesCount: issues?.length,
        hasPrompts: !!prompts,
        guidanceDataLoaded,
        filenamesCount: filenames.length,
        summariesCount: summaries.length
    });
    
    // Store the parsed issues in our global array
    AIGeneratedListOfIssues = issues;
    guidelinesForEachIssue = new Array(issues.length).fill([]);

    const suggestedGuidelinesDiv = document.getElementById('suggestedGuidelines');
    if (!suggestedGuidelinesDiv) {
        console.error('suggestedGuidelinesDiv not found in DOM');
        return;
    }
    suggestedGuidelinesDiv.innerHTML = '';

    if (!issues || issues.length === 0) {
        console.log('No issues provided, displaying "No clinical issues" message');
        const noIssuesDiv = document.createElement('div');
        noIssuesDiv.textContent = 'No clinical issues identified.';
        suggestedGuidelinesDiv.appendChild(noIssuesDiv);
        return;
    }

    // Process each issue
    for (let i = 0; i < issues.length; i++) {
        const issue = issues[i];
        console.log(`Processing issue ${i + 1}:`, issue);
        
        // Create issue container
        const issueDiv = document.createElement('div');
        issueDiv.className = 'accordion-item';
        issueDiv.style.textAlign = 'left';
        
        // Remove prefix hyphen if present
        const cleanIssue = issue.startsWith('-') ? issue.substring(1).trim() : issue;
        
        // Create issue header
        const issueTitle = document.createElement('h4');
        issueTitle.className = 'accordion-header';
        
        // Create header content wrapper for flex layout
        const headerContent = document.createElement('div');
        headerContent.style.display = 'flex';
        headerContent.style.justifyContent = 'space-between';
        headerContent.style.alignItems = 'center';
        headerContent.style.width = '100%';
        headerContent.style.padding = '0';
        headerContent.style.margin = '0';
        headerContent.style.minHeight = '0';
        headerContent.style.height = 'auto';
        
        // Add issue text (editable)
        const issueText = document.createElement('span');
        issueText.contentEditable = true;
        issueText.textContent = cleanIssue;
        issueText.style.padding = '0';
        issueText.style.margin = '0';
        issueText.style.lineHeight = '1';
        issueText.style.display = 'inline-block';
        issueText.style.verticalAlign = 'middle';
        
        // Create delete button (trash can icon)
        const deleteBtn = document.createElement('button');
        deleteBtn.innerHTML = '🗑️';
        deleteBtn.className = 'delete-btn';
        deleteBtn.style.background = 'none';
        deleteBtn.style.border = 'none';
        deleteBtn.style.cursor = 'pointer';
        deleteBtn.style.fontSize = '1rem';
        deleteBtn.style.padding = '0';
        deleteBtn.style.margin = '0';
        deleteBtn.style.lineHeight = '1';
        deleteBtn.style.marginLeft = '8px';
        deleteBtn.style.display = 'flex';
        deleteBtn.style.alignItems = 'center';
        deleteBtn.style.justifyContent = 'center';
        deleteBtn.onclick = (e) => {
            e.stopPropagation(); // Prevent accordion toggle
            if (confirm('Are you sure you want to delete this issue?')) {
                issueDiv.remove();
            }
        };
        
        // Assemble header
        headerContent.appendChild(issueText);
        headerContent.appendChild(deleteBtn);
        issueTitle.appendChild(headerContent);
        
        // Add click handler for accordion functionality
        issueTitle.addEventListener('click', function() {
            // Toggle active class on the header
            this.classList.toggle('active');
            // Toggle the content visibility
            const content = this.nextElementSibling;
            if (content.style.maxHeight && content.style.maxHeight !== '0px') {
                content.style.maxHeight = '0px';
                content.style.padding = '0px';
            } else {
                content.style.padding = '12px';
                content.style.maxHeight = content.scrollHeight + 12 + 'px';
            }
        });
        
        issueDiv.appendChild(issueTitle);

        // Create content container
        const contentDiv = document.createElement('div');
        contentDiv.className = 'accordion-content';
        contentDiv.style.maxHeight = '0px';
        contentDiv.style.padding = '0px';
        contentDiv.style.overflow = 'hidden';
        contentDiv.style.transition = 'all 0.3s ease-out';

        try {
            // Get relevant guidelines for this issue
            const guidelinesData = await findRelevantGuidelines(cleanIssue, prompts, i);
            
            if (guidelinesData.success && guidelinesData.guidelines) {
                // Create list for guidelines
                const guidelinesList = document.createElement('ul');
                guidelinesList.className = 'guidelines-list';

                // Add each guideline
                guidelinesData.guidelines.forEach((guideline, index) => {
                    console.log(`Processing guideline ${index + 1}:`, guideline);
                    
                    const listItem = document.createElement('li');
                    
                    // Create guideline link
                    const guidelineLink = document.createElement('a');
                    const pdfGuideline = guideline.replace(/\.txt$/i, '.pdf');
                    guidelineLink.href = `https://github.com/iannouvel/clerky/raw/main/guidance/${encodeURIComponent(pdfGuideline)}`;
                    // Remove .txt suffix from display text
                    guidelineLink.textContent = guideline.replace(/\.txt$/i, '');
                    guidelineLink.target = '_blank';
                    
                    // Create algo link
                    const algoLink = document.createElement('a');
                    const htmlFilename = guideline.replace(/\.txt$/i, '.html');
                    algoLink.href = `https://iannouvel.github.io/clerky/algos/${encodeURIComponent(htmlFilename)}`;
                    algoLink.textContent = 'Algo';
                    algoLink.target = '_blank';
                    algoLink.style.marginLeft = '10px';
                    
                    // Add apply button
                    const applyButton = document.createElement('button');
                    applyButton.textContent = 'Apply';
                    applyButton.className = 'apply-btn';
                    applyButton.style.marginLeft = '10px';
                    applyButton.onclick = async () => {
                        try {
                            const response = await applyGuideline(guideline, cleanIssue);
                            showPopup(response);
                        } catch (error) {
                            console.error('Error applying guideline:', error);
                            alert('Failed to apply guideline. Please try again.');
                        }
                    };
                    
                    // Assemble list item
                    listItem.appendChild(guidelineLink);
                    listItem.appendChild(algoLink);
                    listItem.appendChild(applyButton);
                    guidelinesList.appendChild(listItem);
                });

                contentDiv.appendChild(guidelinesList);
            }
        } catch (error) {
            console.error('Error processing guidelines for issue:', error);
            const errorDiv = document.createElement('div');
            errorDiv.className = 'error-message';
            errorDiv.textContent = 'Error loading guidelines for this issue.';
            contentDiv.appendChild(errorDiv);
        }

        issueDiv.appendChild(contentDiv);
        suggestedGuidelinesDiv.appendChild(issueDiv);
    }

    // Add click handler for the "+" button
    const addIssueBtn = document.getElementById('addIssueBtn');
    if (addIssueBtn) {
        addIssueBtn.onclick = () => {
            // Create a new issue with default text
            const newIssue = 'New Issue';
            const issues = [...AIGeneratedListOfIssues, newIssue];
            AIGeneratedListOfIssues = issues;
            displayIssues(issues, prompts);
            
            // Find the newly added issue and trigger a click to expand it
            const lastIssue = suggestedGuidelinesDiv.lastElementChild;
            if (lastIssue) {
                const header = lastIssue.querySelector('.accordion-header');
                if (header) {
                    const textElement = header.querySelector('[contenteditable]');
                    if (textElement) {
                        // Focus and select the text for immediate editing
                        textElement.focus();
                        const range = document.createRange();
                        range.selectNodeContents(textElement);
                        const selection = window.getSelection();
                        selection.removeAllRanges();
                        selection.addRange(range);
                    }
                    // Expand the accordion
                    header.click();
                }
            }
        };
    }

    // Log the final state of our global arrays
    console.log('Final state of global arrays:', {
        issues: AIGeneratedListOfIssues,
        guidelines: guidelinesForEachIssue
    });
}

// Make handleAction and displayIssues available globally
window.handleAction = handleAction;
window.displayIssues = displayIssues;

// Add the missing getPrompts function
async function getPrompts() {
    try {
        const response = await fetch(`${SERVER_URL}/getPrompts`);
        if (!response.ok) {
            throw new Error(`Server responded with ${response.status}: ${response.statusText}`);
        }
        const data = await response.json();
        return data.prompts || {};
    } catch (error) {
        console.error('Error fetching prompts:', error);
        return {}; // Return empty object as fallback
    }
}

// Make getPrompts available globally
window.getPrompts = getPrompts;

// Add event listener for dev button
document.getElementById('devBtn').addEventListener('click', function() {
    window.open('dev.html', '_blank');
});

// Function to create and show popup
function showPopup(content) {
    // Create popup container
    const popup = document.createElement('div');
    popup.style.cssText = `
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        background: white;
        padding: 20px;
        border-radius: 8px;
        box-shadow: 0 2px 10px rgba(0,0,0,0.1);
        max-width: 80%;
        max-height: 80vh;
        overflow-y: auto;
        z-index: 1000;
    `;

    // Create close button
    const closeButton = document.createElement('button');
    closeButton.textContent = '×';
    closeButton.style.cssText = `
        position: absolute;
        top: 10px;
        right: 10px;
        border: none;
        background: none;
        font-size: 24px;
        cursor: pointer;
        padding: 0;
        width: 30px;
        height: 30px;
        display: flex;
        align-items: center;
        justify-content: center;
    `;

    // Create overlay
    const overlay = document.createElement('div');
    overlay.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0,0,0,0.5);
        z-index: 999;
    `;

    // Create content container
    const contentDiv = document.createElement('div');
    contentDiv.style.marginTop = '20px';
    contentDiv.style.whiteSpace = 'pre-wrap';
    contentDiv.innerHTML = content; // Use innerHTML to render HTML content

    // Function to remove popup and overlay
    const removePopup = () => {
        popup.remove();
        overlay.remove();
    };

    // Add click handlers
    closeButton.onclick = removePopup;
    overlay.onclick = removePopup;

    // Assemble popup
    popup.appendChild(closeButton);
    popup.appendChild(contentDiv);
    document.body.appendChild(overlay);
    document.body.appendChild(popup);

    // Return an object with the elements and remove function
    return {
        popup,
        overlay,
        remove: removePopup
    };
}

// Function to apply guideline to clinical situation
async function applyGuideline(guideline, clinicalSituation) {
    try {
        const user = auth.currentUser;
        if (!user) {
            throw new Error('Please sign in first');
        }
        const token = await user.getIdToken();

        const prompts = await getPrompts();
        
        if (!prompts || !prompts.applyGuideline) {
            throw new Error('Application configuration error: Missing applyGuideline prompt');
        }

        if (!prompts.applyGuideline.prompt) {
            throw new Error('Application configuration error: Invalid applyGuideline prompt structure');
        }

        const prompt = prompts.applyGuideline.prompt
            .replace('{{guideline}}', guideline)
            .replace('{{situation}}', clinicalSituation);

        const response = await fetch(`${SERVER_URL}/newFunctionName`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ prompt })
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error('Failed to get AI response: ' + errorText);
        }

        const data = await response.json();
        
        if (data.success) {
            return data.response;
        } else {
            throw new Error(data.message || 'Failed to process response');
        }
    } catch (error) {
        throw error;
    }
}

// Function to find relevant guidelines for a clinical issue
async function findRelevantGuidelines(issue, prompts, issueIndex) {
    console.log('Finding relevant guidelines for issue:', issue);
    
    const guidelinesPrompt = prompts.guidelines.prompt
        .replace('{{text}}', issue)
        .replace('{{guidelines}}', filenames.map((filename, i) => `${filename}: ${summaries[i]}`).join('\n'));
    
    const guidelinesRequestData = {
        prompt: guidelinesPrompt,
        filenames: filenames,
        summaries: summaries
    };
    
    console.log('Guidelines request data prepared:', {
        promptLength: guidelinesPrompt.length,
        filenamesCount: guidelinesRequestData.filenames.length,
        summariesCount: guidelinesRequestData.summaries.length
    });

    // Define retry settings
    const MAX_RETRIES = 3;
    const RETRY_DELAYS = [2000, 4000, 8000]; // 2, 4, 8 seconds

    // Helper function to delay execution
    const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

    let lastError = null;
    
    // Try the request with retries
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        try {
            const user = auth.currentUser;
            if (!user) {
                throw new Error('Please sign in first');
            }
            const token = await user.getIdToken();
            
            if (attempt > 0) {
                console.log(`Retry attempt ${attempt}/${MAX_RETRIES} after ${RETRY_DELAYS[attempt-1]/1000} seconds...`);
            }
            
            console.log('Making request to handleGuidelines endpoint...');
            const guidelinesResponse = await fetch(`${SERVER_URL}/handleGuidelines`, {
                method: 'POST',
                credentials: 'include',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`,
                    'Accept': 'application/json'
                },
                body: JSON.stringify(guidelinesRequestData)
            });

            console.log('Guidelines response received:', {
                ok: guidelinesResponse.ok,
                status: guidelinesResponse.status,
                statusText: guidelinesResponse.statusText
            });

            // If we get a successful response, parse and return it
            if (guidelinesResponse.ok) {
                const guidelinesData = await guidelinesResponse.json();
                console.log('Guidelines data parsed:', {
                    success: guidelinesData.success,
                    guidelinesCount: guidelinesData.guidelines?.length
                });

                // Store the guidelines in our global array at the correct index
                if (guidelinesData.success && Array.isArray(guidelinesData.guidelines)) {
                    guidelinesForEachIssue[issueIndex] = guidelinesData.guidelines;
                }
                
                return guidelinesData;
            } else {
                // If we get a 502 or other server error, throw so we can retry
                throw new Error(`Server returned ${guidelinesResponse.status} ${guidelinesResponse.statusText}`);
            }
        } catch (error) {
            lastError = error;
            console.error(`Error finding relevant guidelines (attempt ${attempt+1}/${MAX_RETRIES+1}):`, error.message);
            
            // If this isn't the last attempt, wait before retrying
            if (attempt < MAX_RETRIES) {
                const retryDelay = RETRY_DELAYS[attempt];
                console.log(`Will retry in ${retryDelay/1000} seconds...`);
                await delay(retryDelay);
            }
        }
    }
    
    // If we've exhausted all retries, throw the last error
    console.error(`Failed to get guidelines after ${MAX_RETRIES+1} attempts`);
    throw lastError;
}

// For setting clinical note content
function setClinicalNoteContent(content) {
    if (clinicalNoteEditor) {
        setEditorContent(clinicalNoteEditor, content);
    } else {
        const clinicalNoteOutput = document.getElementById('clinicalNoteOutput');
        if (clinicalNoteOutput) {
            clinicalNoteOutput.innerHTML = content;
        }
    }
}

// For getting clinical note content
function getClinicalNoteContent() {
    if (clinicalNoteEditor) {
        return getEditorContent(clinicalNoteEditor);
    } else {
        const clinicalNoteOutput = document.getElementById('clinicalNoteOutput');
        return clinicalNoteOutput ? clinicalNoteOutput.innerHTML : '';
    }
}

// For setting summary content
function setSummaryContent(content) {
    if (summaryEditor) {
        setEditorContent(summaryEditor, content);
    } else {
        const summaryElement = document.getElementById('summary');
        if (summaryElement) {
            summaryElement.innerHTML = content;
        }
    }
}

// For getting summary content
function getSummaryContent() {
    if (summaryEditor) {
        return getEditorContent(summaryEditor);
    } else {
        const summaryElement = document.getElementById('summary');
        return summaryElement ? summaryElement.innerHTML : '';
    }
}

// Function to add track changes toolbar
function addTrackChangesToolbar(changesResult) {
    // Remove any existing toolbar first
    const existingToolbar = document.querySelector('.track-changes-toolbar');
    if (existingToolbar) {
        existingToolbar.remove();
    }
    
    // Create the toolbar
    const toolbar = document.createElement('div');
    toolbar.className = 'track-changes-toolbar';
    
    // Add header
    const header = document.createElement('div');
    header.className = 'track-changes-header';
    header.innerHTML = '<h3>Review Suggested Changes</h3>';
    toolbar.appendChild(header);
    
    // Create global action buttons
    const globalActions = document.createElement('div');
    globalActions.className = 'track-changes-global-actions';
    
    // Add accept all button
    const acceptAllBtn = document.createElement('button');
    acceptAllBtn.className = 'accept-btn';
    acceptAllBtn.textContent = 'Accept All Changes';
    acceptAllBtn.addEventListener('click', () => {
        acceptAllTrackChanges(clinicalNoteEditor);
        toolbar.remove(); // Remove toolbar after accepting
    });
    
    // Add reject all button
    const rejectAllBtn = document.createElement('button');
    rejectAllBtn.className = 'reject-btn';
    rejectAllBtn.textContent = 'Reject All Changes';
    rejectAllBtn.addEventListener('click', () => {
        rejectAllTrackChanges(clinicalNoteEditor, originalClinicalNoteContent);
        toolbar.remove(); // Remove toolbar after rejecting
    });
    
    // Add buttons to global actions
    globalActions.appendChild(acceptAllBtn);
    globalActions.appendChild(rejectAllBtn);
    toolbar.appendChild(globalActions);
    
    // Create individual changes section
    const changes = getTrackChanges(clinicalNoteEditor);
    
    if (changes.length > 0) {
        const changesSection = document.createElement('div');
        changesSection.className = 'track-changes-list';
        
        const changesTitle = document.createElement('h4');
        changesTitle.textContent = 'Individual Changes';
        changesSection.appendChild(changesTitle);
        
        // Create a list of changes
        const changesList = document.createElement('ul');
        changesList.className = 'changes-list';
        
        changes.forEach(change => {
            const changeItem = document.createElement('li');
            changeItem.className = `change-item change-type-${change.type}`;
            changeItem.setAttribute('data-change-id', change.id);
            
            // Preview of the change
            const changePreview = document.createElement('div');
            changePreview.className = 'change-preview';
            changePreview.textContent = change.text || '[formatting change]';
            changeItem.appendChild(changePreview);
            
            // Change actions
            const changeActions = document.createElement('div');
            changeActions.className = 'change-actions';
            
            // Accept button
            const acceptBtn = document.createElement('button');
            acceptBtn.className = 'accept-btn small';
            acceptBtn.textContent = 'Accept';
            acceptBtn.addEventListener('click', () => {
                acceptChange(clinicalNoteEditor, change.id);
                changeItem.classList.add('accepted');
                checkAllChangesProcessed();
            });
            changeActions.appendChild(acceptBtn);
            
            // Reject button
            const rejectBtn = document.createElement('button');
            rejectBtn.className = 'reject-btn small';
            rejectBtn.textContent = 'Reject';
            rejectBtn.addEventListener('click', () => {
                rejectChange(clinicalNoteEditor, change.id);
                changeItem.classList.add('rejected');
                checkAllChangesProcessed();
            });
            changeActions.appendChild(rejectBtn);
            
            changeItem.appendChild(changeActions);
            changesList.appendChild(changeItem);
        });
        
        changesSection.appendChild(changesList);
        toolbar.appendChild(changesSection);
    } else {
        // If we couldn't identify individual changes
        const noChangesMsg = document.createElement('p');
        noChangesMsg.className = 'no-individual-changes';
        noChangesMsg.textContent = 'Individual changes could not be identified. Please use Accept All or Reject All.';
        toolbar.appendChild(noChangesMsg);
    }
    
    // Function to check if all changes have been processed
    function checkAllChangesProcessed() {
        const remainingChanges = changesList.querySelectorAll('li:not(.accepted):not(.rejected)');
        if (remainingChanges.length === 0) {
            // All changes have been processed, remove the toolbar
            setTimeout(() => {
                toolbar.remove();
            }, 1000);
        }
    }
    
    // Add toolbar to the editor container
    const editorContainer = document.getElementById('clinicalNoteOutput').parentNode;
    editorContainer.insertBefore(toolbar, document.getElementById('clinicalNoteOutput'));
}

// Function to test track changes (accessible from console)
window.testTrackChanges = function() {
    try {
        const originalContent = getClinicalNoteContent();
        if (!originalContent) {
            console.error('No content found in clinical note editor');
            return { success: false, error: 'No content to test with' };
        }
        
        originalClinicalNoteContent = originalContent;
        
        // Create a modified version of the content with some changes
        const modifiedContent = originalContent
            .replace(/patient/gi, '<b>patient</b>')
            .replace(/the/gi, 'THE')
            .replace(/and/gi, 'AND')
            .replace(/risk/gi, 'RISK FACTOR')
            .replace(/symptoms/gi, '<i>symptoms and signs</i>');
        
        console.log('Original content:', originalContent);
        console.log('Modified content:', modifiedContent);
        
        // Verify editor is available
        if (!clinicalNoteEditor) {
            console.error('Clinical note editor not initialized');
            return { success: false, error: 'Editor not initialized' };
        }
        
        // Add toolbar and apply track changes
        console.log('Applying track changes...');
        const changesResult = applyTrackChanges(clinicalNoteEditor, originalContent, modifiedContent);
        console.log('Track changes result:', changesResult);
        
        addTrackChangesToolbar(changesResult);
        
        console.log('Track changes applied. Use the toolbar to accept or reject changes.');
        return {
            success: true,
            changesCount: changesResult?.changes?.length || 0
        };
    } catch (error) {
        console.error('Error testing track changes:', error);
        return {
            success: false,
            error: error.message,
            stack: error.stack
        };
    }
};

// Add the document load event handler at the end of the file to cleanly update the test button
document.addEventListener('DOMContentLoaded', function() {
    console.log("DOM loaded, updating test button to use scenario popup");
    const testBtn = document.getElementById('testBtn');
    if (testBtn) {
        // Remove any existing event listeners by cloning
        const newTestBtn = testBtn.cloneNode(true);
        testBtn.parentNode.replaceChild(newTestBtn, testBtn);
        
        // Add our updated handler
        newTestBtn.addEventListener('click', function() {
            console.log("Test button clicked, showing scenario popup");
            
            // Show/hide spinner elements if they exist
            const testSpinner = document.getElementById('testSpinner');
            const testText = document.getElementById('testText');
            if (testSpinner) testSpinner.style.display = 'inline-block';
            if (testText) testText.style.display = 'none';
            
            // Use our popup function
            window.showScenarioSelectionPopup();
            
            // Reset spinner after a short delay
            setTimeout(() => {
                if (testSpinner) testSpinner.style.display = 'none';
                if (testText) testText.style.display = 'inline-block';
            }, 300);
        });
        
        console.log("Test button updated successfully");
    }
});