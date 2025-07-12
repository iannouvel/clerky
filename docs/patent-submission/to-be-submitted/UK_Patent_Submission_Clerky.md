# UK PATENT APPLICATION
## CLERKY - AI-POWERED CLINICAL DECISION SUPPORT PLATFORM

**Application Type:** Standard Patent Application  
**Classification:** Medical Device Software (Class IIa)  
**Field of Invention:** Computer-Implemented Medical Systems, Artificial Intelligence in Healthcare, Clinical Decision Support  
**Priority Date:** July 12, 2025  
**Applicant:** CLERKYAI LTD  
**Address:** 4 Harrington Road, Brighton, BN1 6RE, United Kingdom  

---

## ABSTRACT

The present invention relates to an AI-powered clinical decision support platform that provides privacy-preserving analysis of clinical documentation against evidence-based medical guidelines. The system implements a novel anonymisation engine that removes personally identifiable information at source while preserving clinical context, combined with an AI model-agnostic architecture that intelligently routes requests across multiple AI providers (OpenAI, DeepSeek, Anthropic, Mistral, Gemini) with automatic failover capabilities. The platform simultaneously analyses clinical cases against hundreds of medical guidelines using privacy-protected data, presenting categorised recommendations that healthcare professionals can accept, reject, or modify. The system maintains comprehensive audit trails and adapts to user preferences whilst ensuring regulatory compliance through GDPR-aligned data protection. This technical approach addresses key limitations in existing clinical decision support systems including privacy vulnerabilities, AI vendor dependency, and fragmented guideline analysis, providing a comprehensive solution for evidence-based clinical decision-making with enhanced privacy protection.

---

## 1. TECHNICAL FIELD

This invention relates to computer-implemented medical systems, specifically an artificial intelligence-powered clinical decision support platform that provides real-time analysis of clinical documentation against evidence-based medical guidelines while ensuring patient privacy through advanced anonymisation techniques and maintaining optimal performance through AI model-agnostic architecture.

---

## 2. BACKGROUND OF THE INVENTION

### 2.1 Problem Statement

Healthcare professionals face increasing challenges in maintaining adherence to the rapidly expanding corpus of evidence-based medical guidelines while protecting patient privacy and managing AI service dependencies. Current systems suffer from several critical limitations:

1. **Manual Guideline Consultation**: Healthcare professionals must manually search through extensive guideline databases during patient consultations, causing delays and potential oversights.

2. **Fragmented Decision Support**: Existing clinical decision support systems typically address single guidelines or narrow clinical domains, failing to provide comprehensive multi-guideline analysis.

3. **Static Documentation Review**: Current systems lack real-time, intelligent analysis of clinical documentation against current best practice guidelines.

4. **Privacy and Security Vulnerabilities**: Most systems transmit sensitive patient data to external AI services without adequate anonymisation, creating privacy risks and regulatory compliance issues.

5. **AI Provider Dependency**: Existing solutions rely on single AI providers, creating vulnerabilities when services become unavailable, expensive, or fail to meet performance requirements.

6. **Limited Learning Integration**: Existing solutions do not provide interactive learning mechanisms that adapt to user decisions and preferences.

7. **Poor Workflow Integration**: Most clinical decision support tools operate as standalone systems that disrupt clinical workflows rather than enhancing them.

### 2.2 Prior Art Limitations

Existing clinical decision support systems, while providing some guidance, fail to offer:
- Real-time, intelligent analysis of free-text clinical documentation
- Privacy-preserving anonymisation at source before data transmission
- AI model-agnostic architecture with automatic failover capabilities
- Multi-guideline simultaneous analysis with parallel processing
- Interactive recommendation systems with comprehensive user decision tracking
- Structured clinical documentation enhancement based on AI-generated suggestions

---

## 3. SUMMARY OF THE INVENTION

### 3.1 Overview

The present invention provides a novel AI-powered clinical decision support platform ("Clerky") that addresses the aforementioned limitations through several innovative technical solutions:

### 3.2 Key Technical Innovations

**Innovation 1: Privacy-Preserving Anonymisation at Source**
A breakthrough in healthcare data privacy, Clerky implements comprehensive anonymisation of clinical data before it ever leaves the healthcare provider's environment. Using advanced natural language processing and medical-context-aware algorithms, the system identifies and removes personally identifiable information (PII) while preserving all clinically relevant content. This includes specialized medical patterns, NHS numbers, hospital identifiers, and personal details, ensuring complete privacy protection without compromising clinical utility. The anonymisation process uses the @libretto/redact-pii-light library combined with custom medical patterns to achieve comprehensive PII detection while avoiding false positives with medical terminology.

**Innovation 2: AI Model-Agnostic Architecture with Intelligent Routing**
Rather than being locked into a single AI provider, Clerky implements a sophisticated AI model-agnostic architecture that intelligently routes requests across multiple AI service providers including OpenAI, DeepSeek, Anthropic (Claude), Mistral, and Google Gemini. The system automatically selects the optimal provider based on user preferences, cost considerations, performance metrics, and availability. When one service becomes unavailable or reaches quota limits, the system seamlessly switches to alternative providers without interruption. This approach ensures healthcare professionals always receive fast, reliable responses while maintaining optimal cost-efficiency and avoiding vendor lock-in.

**Innovation 3: Comprehensive Medical Guideline Analysis**
When a healthcare professional enters a clinical case, Clerky simultaneously checks it against hundreds of relevant medical guidelines rather than forcing manual searches. The system currently contains approximately 300 guidelines focused on obstetrics and gynaecology, with capability for expansion to other medical specialties. It intelligently identifies which guidelines are most relevant to the specific case and presents them in order of importance, allowing healthcare professionals to quickly access the most applicable evidence-based recommendations.

**Innovation 4: Interactive Decision Support Interface**
Rather than providing static recommendations, Clerky creates an interactive experience where healthcare professionals can review each AI-generated suggestion and choose to accept, reject, or modify it to better fit their clinical judgment. The system tracks these decisions to maintain a comprehensive record of how recommendations were applied. Each suggestion is presented with supporting evidence, and healthcare professionals can customise recommendations in real-time to match their specific clinical context and patient needs.

**Innovation 5: AI-Generated Documentation Suggestions**
Clerky uses multiple AI providers to analyse clinical notes against specific medical guidelines and generate categorised improvement suggestions. The system provides structured recommendations organised by importance level (Very Important to Unimportant) that healthcare professionals can review, accept, reject, or modify. When suggestions are accepted or modified, they are automatically applied to update the clinical documentation, helping ensure better alignment with evidence-based guidelines while maintaining the healthcare professional's clinical judgment.

**Innovation 6: Reliable Multi-Service Architecture**
The system is built with multiple backup systems to ensure it remains available when healthcare professionals need it most. By connecting to several different AI services simultaneously, Clerky can continue operating even if one or more services experience problems. The system monitors performance and costs across all providers, automatically routing requests to the most efficient service while maintaining backup options. This redundant approach ensures consistent availability and optimal performance for time-sensitive clinical decision-making.

---

## 4. DETAILED DESCRIPTION OF THE INVENTION

### 4.1 System Architecture

The invention comprises a distributed architecture with the following novel components:

#### 4.1.1 Frontend Application Layer
- **Single-Page Web Application**: 7,710-line JavaScript application (`script.js`)
- **Firebase Authentication**: Secure user authentication and session management
- **Real-time Processing**: Instant analysis and recommendation display with live status updates
- **Interactive Elements**: Accept/reject/modify interface for AI recommendations with decision tracking
- **Session Management**: Persistent clinical consultation tracking with Firestore integration
- **Privacy Interface**: Built-in PII review and anonymisation confirmation dialogs
- **Responsive Design**: Optimised interface for healthcare professional workflows

#### 4.1.2 Server API Layer  
- **Express.js Backend**: 7,721-line Node.js server (`server.js`) hosted on Render.com
- **AI Model-Agnostic Integration**: Intelligent routing between multiple AI service providers (OpenAI, DeepSeek, Anthropic, Mistral, Gemini)
- **GitHub Integration**: Automated guideline ingestion and version control via GitHub API
- **Firebase Admin SDK**: Secure database operations and user management
- **Privacy Processing**: Server-side anonymisation validation and logging
- **RESTful API Design**: Comprehensive endpoints for guideline processing and AI analysis

#### 4.1.3 Privacy-Preserving Anonymisation Engine
The system implements a sophisticated anonymisation engine that processes clinical data before transmission:

```javascript
// Clinical Data Anonymiser with medical context awareness
class ClinicalDataAnonymiser {
    constructor() {
        this.customPatterns = this.getMedicalPatterns();
        this.enhancedPatterns = this.getEnhancedPIIPatterns();
    }

    async anonymise(text, options = {}) {
        // Step 1: Use Libretto library for PII detection
        const libraryResult = await this.redactPIIFunction(text);
        
        // Step 2: Apply medical-specific patterns
        let anonymisedText = this.applyMedicalPatterns(libraryResult);
        
        // Step 3: Preserve clinical information
        if (options.preserveClinicalInfo) {
            anonymisedText = this.preserveClinicalTerms(anonymisedText);
        }
        
        return {
            anonymisedText,
            metadata: this.generateMetadata(text, anonymisedText),
            success: true
        };
    }
}
```

#### 4.1.4 AI Model-Agnostic Processing Engine
The system implements intelligent routing across multiple AI providers:

```javascript
// AI routing based on user preferences and availability
async function routeToAI(prompt, userId = null) {
    // Get user's preferred AI provider
    const preferredProvider = await getUserAIPreference(userId);
    
    // Check availability and quota limits
    const availableProviders = await checkProviderAvailability();
    
    // Select optimal provider
    const selectedProvider = selectOptimalProvider(
        preferredProvider, 
        availableProviders
    );
    
    // Send request with automatic failover
    return await sendToAIWithFailover(prompt, selectedProvider);
}

// Supported AI providers with automatic failover
const AI_PROVIDERS = {
    OpenAI: { model: 'gpt-3.5-turbo', endpoint: 'https://api.openai.com/v1/chat/completions' },
    DeepSeek: { model: 'deepseek-chat', endpoint: 'https://api.deepseek.com/v1/chat/completions' },
    Anthropic: { model: 'claude-3-sonnet-20240229', endpoint: 'https://api.anthropic.com/v1/messages' },
    Mistral: { model: 'mistral-large-latest', endpoint: 'https://api.mistral.ai/v1/chat/completions' },
    Gemini: { model: 'gemini-1.5-pro', endpoint: 'https://generativelanguage.googleapis.com/v1/models' }
};
```

#### 4.1.5 Guideline Intelligence System
- **Automated Guideline Processing**: Conversion of PDF guidelines to structured, searchable format
- **Metadata Enhancement**: AI-powered extraction of guideline metadata and clinical relevance
- **Dynamic Updating**: Automatic synchronisation with latest guideline versions
- **Contextual Indexing**: Advanced indexing for rapid retrieval and relevance matching

#### 4.1.6 Clinical Analysis Pipeline
```javascript
// Multi-guideline parallel processing with privacy protection
async function multiGuidelineDynamicAdvice(selectedGuidelines) {
    // First, anonymise the clinical data
    const anonymisedData = await anonymiseTranscript(transcript);
    
    // Process guidelines in parallel with error isolation
    const guidelinePromises = selectedGuidelines.map(async (guideline) => {
        try {
            // Call dynamicAdvice API for individual guideline using anonymised data
            const response = await fetch('/dynamicAdvice', {
                method: 'POST',
                body: JSON.stringify({
                    transcript: anonymisedData.anonymisedText,
                    analysis: window.latestAnalysis.analysis,
                    guidelineId: guideline.id,
                    guidelineTitle: guideline.title,
                    anonymisationInfo: anonymisedData.metadata
                })
            });
            return await response.json();
        } catch (error) {
            return { success: false, error: error.message, guideline: guideline.id };
        }
    });
    
    // Wait for all parallel processing to complete
    const results = await Promise.all(guidelinePromises);
    return results;
}
```

### 4.2 Novel Algorithmic Innovations

#### 4.2.1 Privacy-Preserving Data Processing

The system employs a comprehensive privacy-preserving approach:

1. **PII Detection**: Advanced pattern matching using @libretto/redact-pii-light library combined with medical-specific patterns
2. **Medical Context Awareness**: Intelligent differentiation between PII and clinical terminology
3. **User Review Interface**: Interactive confirmation of anonymisation decisions
4. **Audit Trail**: Comprehensive logging of all privacy-related decisions

```javascript
// Privacy-preserving workflow
async function processWithPrivacyProtection(clinicalData) {
    // Check for PII
    const piiAnalysis = await clinicalAnonymiser.checkForPII(clinicalData);
    
    if (piiAnalysis.containsPII) {
        // Show interactive review interface
        const reviewResult = await showPIIReviewInterface(clinicalData, piiAnalysis);
        
        if (reviewResult.approved) {
            // Use anonymised data for AI processing
            return await processWithAI(reviewResult.anonymisedText);
        }
    }
    
    // Process with original data if no PII detected
    return await processWithAI(clinicalData);
}
```

#### 4.2.2 AI Model-Agnostic Request Routing

The system implements intelligent routing across multiple AI providers:

```javascript
// Intelligent AI provider selection
async function selectOptimalProvider(userPreference, availableProviders) {
    // Priority 1: User preference (if available)
    if (userPreference && availableProviders.includes(userPreference)) {
        return userPreference;
    }
    
    // Priority 2: Performance and cost optimization
    const providerMetrics = await getProviderMetrics();
    const optimalProvider = calculateOptimalProvider(providerMetrics);
    
    // Priority 3: Failover to any available provider
    return availableProviders.includes(optimalProvider) ? 
           optimalProvider : 
           availableProviders[0];
}
```

#### 4.2.3 AI-Powered Guideline Matching Process

The system employs a streamlined AI-powered process for identifying relevant guidelines:

1. **Privacy-Protected Data Submission**: Anonymised clinical transcript and complete guideline database sent to AI provider
2. **AI-Based Categorisation**: AI service analyses content and categorises guidelines into relevance levels
3. **Response Processing**: System parses AI response using fuzzy string matching
4. **User Interface Presentation**: Guidelines presented with relevance scores and interactive selection

#### 4.2.4 Interactive Decision Tracking System

```javascript
// Enhanced decision tracking with privacy audit
function handleSuggestionAction(suggestionId, action) {
    const suggestion = currentSuggestions.find(s => s.id === suggestionId);
    
    // Record decision with privacy metadata
    userDecisions[suggestionId] = {
        action: action,
        suggestion: suggestion,
        timestamp: new Date().toISOString(),
        anonymisationApplied: suggestion.anonymisationInfo?.applied || false
    };
    
    // Update UI and maintain audit trail
    updateSuggestionStatus(suggestionId, action);
    updateDecisionsSummary();
}
```

### 4.3 Technical Implementation Details

#### 4.3.1 Enhanced Data Processing Pipeline

**Privacy-First Clinical Analysis Workflow**:
1. **Input Processing**: 
   - Multi-format clinical text input (copy-paste, file upload, direct typing)
   - Real-time PII detection and anonymisation
   - Medical context preservation during anonymisation

2. **Anonymisation Pipeline**:
   - Advanced PII detection using @libretto/redact-pii-light
   - Medical-specific pattern matching for NHS numbers, hospital identifiers
   - Interactive user review and confirmation process
   - Audit trail generation for privacy compliance

3. **AI Provider Selection**:
   - User preference-based provider selection
   - Automatic failover on provider unavailability
   - Cost and performance optimization
   - Real-time provider health monitoring

4. **Multi-Provider AI Analysis**:
   - Intelligent routing between OpenAI, DeepSeek, Anthropic, Mistral, and Gemini
   - Automatic failover on provider unavailability or quota limits
   - Structured prompt engineering for clinical contexts
   - Quality validation and response processing

#### 4.3.2 Privacy-Preserving Database Architecture

- **Anonymised Data Storage**: All transmitted data is anonymised before storage
- **Audit Logging**: Comprehensive privacy decision audit trails
- **Metadata Preservation**: Clinical relevance maintained while removing PII
- **Compliance Frameworks**: GDPR and healthcare data protection compliance

### 4.4 Database and Knowledge Management

#### 4.4.1 Enhanced Guideline Database Architecture

- **Comprehensive Coverage**: Approximately 300 medical guidelines from authoritative sources
- **Structured Storage**: Firebase Firestore with optimised indexing
- **Version Control**: Automated guideline update tracking
- **Multi-Provider Processing**: Guidelines processed using optimal AI provider selection

```javascript
// Enhanced guideline synchronization with AI provider selection
async function syncGuidelinesWithMetadata() {
    const guidelines = await getGuidelinesList();
    
    for (const guideline of guidelines) {
        const content = await getFileContents(`guidance/condensed/${guideline}`);
        const summary = await getFileContents(`guidance/summary/${guideline}`);
        
        // Use optimal AI provider for metadata enhancement
        const optimalProvider = await selectOptimalProvider();
        const enhancedMetadata = await enhanceGuidelineMetadata(
            guideline, 
            optimalProvider
        );
        
        await storeGuideline({
            id: generateCleanDocId(guideline),
            content: content,
            summary: summary,
            metadata: enhancedMetadata,
            processedWith: optimalProvider
        });
    }
}
```

---

## 5. CLAIMS

### Independent Claims

**Claim 1:** A computer-implemented system for providing privacy-preserving clinical decision support comprising a privacy-preserving anonymisation engine configured to identify and remove personally identifiable information from clinical documentation before transmission to external services while preserving clinical relevance, an AI model-agnostic processing system configured to intelligently route requests across multiple AI service providers including OpenAI, DeepSeek, Anthropic, Mistral, and Gemini with automatic failover capabilities, a clinical text analysis engine configured to process anonymised clinical documentation using the selected AI service provider, a guideline database containing a plurality of medical guidelines in structured searchable format, a multi-guideline analysis engine configured to simultaneously analyse anonymised clinical input against multiple relevant guidelines using parallel processing, an artificial intelligence recommendation system configured to generate prioritised clinical recommendations based on guideline analysis, an interactive user interface configured to present recommendations and capture user decisions through accept/reject/modify functionality, and a decision tracking system configured to store user decisions and apply them to modify clinical documentation.

**Claim 2:** The system of claim 1, wherein the privacy-preserving anonymisation engine further comprises a medical context-aware PII detection system using @libretto/redact-pii-light library combined with custom medical patterns, an interactive user review interface for confirming anonymisation decisions, a clinical information preservation system configured to maintain medical relevance while removing personal identifiers, and an audit trail system for tracking all privacy-related decisions and actions.

**Claim 3:** The system of claim 1, wherein the AI model-agnostic processing system comprises a provider selection algorithm configured to choose optimal AI services based on user preferences, cost, performance, and availability, an automatic failover mechanism configured to seamlessly switch between AI providers upon service interruption, a real-time provider health monitoring system configured to track availability and performance metrics across multiple AI services, and support for multiple AI providers including OpenAI GPT models, DeepSeek, Anthropic Claude, Mistral, and Google Gemini.

**Claim 4:** The system of claim 1, wherein the multi-guideline analysis engine further comprises a relevance scoring algorithm configured to rank guidelines based on anonymised clinical context using AI-powered analysis, a privacy-protected text similarity matching system configured to identify relevant guidelines using anonymised clinical data, and a parallel processing engine configured to analyse multiple guidelines simultaneously while maintaining data privacy.

### Dependent Claims

**Claim 5:** The system of claim 1, wherein the clinical text analysis engine is configured to process anonymised clinical documentation using AI-powered analysis to identify significant clinical issues while maintaining patient privacy, generate AI-powered suggestions for documentation enhancement based on privacy-protected guideline analysis, and provide interactive interfaces for reviewing and applying documentation improvements without exposing patient identifiers.

**Claim 6:** The system of claim 1, wherein the decision tracking system is configured to track user acceptance, rejection, and modification of AI recommendations in real-time while maintaining privacy audit trails, store individual user decisions with anonymisation metadata for current clinical session processing, and apply user decisions to modify clinical transcript based on accepted and modified suggestions while preserving privacy protections.

**Claim 7:** The system of claim 1, further comprising a privacy-preserving AI-enhanced documentation system configured to generate documentation improvement suggestions based on AI analysis of anonymised clinical data against guideline requirements, provide interactive recommendation interfaces with accept/reject/modify functionality while maintaining patient privacy, and deliver real-time AI-powered feedback on clinical documentation enhancement opportunities using privacy-protected data.

**Claim 8:** A computer-implemented method for providing privacy-preserving clinical decision support comprising the steps of receiving clinical documentation in natural language format, anonymising the clinical documentation using advanced PII detection and medical context-aware algorithms before external transmission, selecting an optimal AI service provider from multiple available providers based on user preferences, performance metrics, and availability, processing the anonymised clinical documentation using the selected AI service provider with automatic failover capabilities, identifying relevant medical guidelines from a database using AI-based categorisation of anonymised clinical content, analysing the anonymised clinical documentation against multiple identified guidelines simultaneously using parallel processing, generating prioritised recommendations using artificial intelligence analysis from the selected AI service provider, presenting interactive recommendations to a user interface with accept/reject/modify functionality, capturing user decisions regarding presented recommendations with privacy audit trail maintenance, and applying user decisions to modify clinical documentation based on accepted and modified suggestions while preserving anonymisation protections.

**Claim 9:** The method of claim 8, wherein anonymising the clinical documentation comprises detecting personally identifiable information using @libretto/redact-pii-light library combined with custom medical patterns, presenting detected PII to healthcare professionals through interactive review interface, preserving clinical terminology and medical context while removing personal identifiers, and generating comprehensive audit trails of all anonymisation decisions and actions.

**Claim 10:** The method of claim 8, wherein selecting an optimal AI service provider comprises evaluating user preferences for AI provider selection from available options, monitoring real-time availability and performance metrics for multiple AI service providers, implementing automatic failover mechanisms when primary AI service becomes unavailable, and optimising cost and performance across multiple AI service providers including OpenAI, DeepSeek, Anthropic, Mistral, and Gemini.

**Claim 11:** A non-transitory computer-readable storage medium containing instructions that, when executed by a processor, cause the processor to perform operations comprising anonymising clinical text input using advanced PII detection and medical context-aware algorithms before external transmission, selecting optimal AI service providers from multiple available options with automatic failover capabilities, analysing anonymised clinical content against a database of medical guidelines using AI-based categorisation, generating clinical recommendations using artificial intelligence analysis with privacy-protected data, providing an interactive interface for user feedback on recommendations with accept/reject/modify functionality while maintaining privacy audit trails, and tracking user decisions and applying them to modify clinical documentation based on user selections while preserving anonymisation protections.

---

## 6. TECHNICAL ADVANTAGES AND BENEFITS

### 6.1 Technical Superiority

**Unprecedented Privacy Protection**
Unlike existing systems that transmit raw clinical data to external AI services, this invention offers:
- Comprehensive anonymisation at source before any external data transmission
- Medical context-aware PII detection that preserves clinical relevance
- Interactive user review and confirmation of anonymisation decisions
- Complete audit trails for regulatory compliance and privacy governance

**Advanced AI Architecture with Vendor Independence**
The AI model-agnostic system with intelligent routing provides:
- Enhanced reliability through automatic failover between multiple AI providers
- Cost optimization through intelligent provider selection algorithms
- Improved performance through load balancing across multiple AI services
- Complete vendor independence through provider abstraction and intelligent routing
- Future-proof architecture supporting new AI providers as they emerge

**Superior Integration Depth**
Unlike existing systems that provide isolated clinical decision support, this invention offers:
- Simultaneous multi-guideline analysis with parallel processing capabilities
- Real-time decision tracking and comprehensive audit trails
- AI-enhanced documentation improvement suggestions using privacy-protected data
- Seamless workflow integration without disrupting clinical practice

### 6.2 Clinical Impact

**Enhanced Patient Privacy Protection**
- Complete anonymisation of patient data before external transmission
- Regulatory compliance with GDPR and healthcare data protection requirements
- Reduced liability through comprehensive privacy audit trails
- Patient trust enhancement through transparent privacy protection

**Improved Clinical Decision-Making**
- Reduced medical errors through comprehensive guideline checking using privacy-protected data
- Enhanced diagnostic accuracy through multi-guideline validation
- Better documentation quality reducing liability and improving patient care
- Real-time identification of potential safety concerns while maintaining privacy

**Healthcare System Resilience**
- Elimination of single points of failure through multi-provider AI architecture
- Continued operation during AI service outages or quota limitations
- Cost optimization through intelligent provider selection and competition
- Future-proof architecture supporting emerging AI technologies

### 6.3 Privacy and Security Benefits

**Data Protection Excellence**
- No transmission of raw patient data to external AI services
- Medical context-aware anonymisation preserving clinical utility
- Interactive user control over privacy decisions
- Comprehensive audit trails for regulatory compliance

**Regulatory Compliance**
- GDPR compliance through data anonymisation at source
- Healthcare data protection regulation adherence
- Audit trail generation for privacy governance
- Transparent privacy protection processes

---

## 7. INDUSTRIAL APPLICABILITY

### 7.1 Healthcare Industry Applications

**Primary Healthcare Settings**
- General practice clinics with enhanced privacy protection for routine patient consultations
- Specialist clinics requiring multi-AI provider support for complex diagnostic scenarios
- Emergency departments needing reliable AI services with automatic failover capabilities
- Hospital wards requiring comprehensive patient management with privacy protection

**Healthcare Technology Integration**
- Electronic Health Record (EHR) systems requiring privacy-preserving AI integration
- Clinical decision support systems needing multi-provider AI capabilities
- Healthcare analytics platforms requiring anonymised data processing
- Medical education systems with privacy-protected clinical scenario analysis

**Regulatory and Compliance Applications**
- Healthcare organizations requiring GDPR-compliant AI processing
- Clinical audit systems needing privacy-protected data analysis
- Quality assurance departments requiring anonymised clinical data processing
- Risk management systems with comprehensive privacy audit trails

### 7.2 Market Demand Evidence

The invention addresses clearly demonstrated market needs:
- Growing regulatory requirements for patient data protection and privacy
- Healthcare industry demand for vendor-independent AI solutions
- Increasing complexity of medical guidelines requiring intelligent processing
- Rising healthcare costs requiring cost-optimized AI service utilization
- Healthcare workforce challenges requiring reliable, always-available decision support tools

### 7.3 Technical Feasibility

The invention has been successfully implemented and tested:
- Working prototype with comprehensive privacy protection functionality
- Validated anonymisation engine with medical context awareness
- Demonstrated AI model-agnostic integration with multiple providers (OpenAI, DeepSeek, Anthropic, Mistral, Gemini)
- Tested automatic failover capabilities across multiple AI service providers
- User interface testing with healthcare professionals for privacy workflows
- Performance optimization for real-time clinical use with privacy protection

---

## 8. NOVELTY AND INVENTIVE STEP

### 8.1 Novelty Assessment

**Unique Technical Combinations**
The invention combines several technical elements in novel ways:
- Privacy-preserving anonymisation at source with medical context awareness
- AI model-agnostic architecture with intelligent routing and automatic failover across five major AI providers
- Simultaneous multi-guideline analysis with privacy-protected parallel processing capabilities
- Interactive decision tracking system with comprehensive privacy audit trails

**Non-Obvious Technical Solutions**
The inventive step is evident in:
- Novel approach to healthcare AI privacy through medical context-aware anonymisation at source
- Innovative solution to AI vendor lock-in through intelligent multi-provider routing
- Unique integration of privacy protection with multi-guideline processing using parallel analysis
- Original approach to real-time clinical documentation enhancement using privacy-protected AI analysis

### 8.2 Technical Challenges Overcome

**Privacy and Security Challenges**
- Solved the problem of patient data privacy in AI-powered healthcare systems through comprehensive anonymisation at source
- Addressed regulatory compliance challenges through medical context-aware PII detection
- Overcame the balance between privacy protection and clinical utility through intelligent anonymisation

**AI Reliability and Performance**
- Solved the problem of AI provider dependency through comprehensive multi-provider architecture
- Addressed cost optimization challenges through intelligent routing algorithms across five major AI providers
- Overcame performance variability through adaptive load balancing and automatic failover

**Clinical Workflow Integration**
- Resolved the challenge of privacy-preserving clinical decision support through seamless anonymisation workflows
- Addressed the problem of AI service reliability through redundant provider architecture
- Solved vendor lock-in challenges through complete AI model-agnostic design

---

## 9. SYSTEM ARCHITECTURE OVERVIEW

The invention comprises a distributed multi-layer architecture that ensures privacy protection whilst maintaining high availability through AI provider redundancy. The system architecture includes three primary components: a privacy-aware frontend application layer, a multi-provider server API layer, and an intelligent AI services routing layer.

The frontend application layer implements privacy-preserving user interfaces with built-in anonymisation confirmation dialogs and real-time decision tracking capabilities. The server API layer provides AI model-agnostic integration with intelligent routing between multiple AI service providers including OpenAI, DeepSeek, Anthropic, Mistral, and Gemini. The AI services routing layer implements automatic failover mechanisms and performance optimisation across all connected providers.

Supporting components include an anonymisation engine that processes clinical data before external transmission, a GitHub-integrated guideline management system for automated updates, and comprehensive privacy audit logging systems that maintain regulatory compliance records. The architecture ensures that patient data remains protected throughout the entire processing pipeline whilst providing reliable clinical decision support through multi-provider AI redundancy.

---

## 10. EXAMPLES AND EMBODIMENTS

### Example 1: Privacy-Preserving Obstetric Care Decision Support

**Clinical Scenario**: A healthcare professional enters a consultation note for a pregnant patient (Sarah Johnson, NHS: 123-456-7890, DOB: 01/15/1990) presenting with hypertension.

**Privacy Protection Processing**:
1. System detects PII: patient name, NHS number, date of birth
2. Interactive review interface presents anonymisation options
3. User confirms anonymisation: "Patient [NAME], NHS: [NHS_NUMBER], DOB: [DATE]"
4. Anonymised data: "Patient [NAME], NHS: [NHS_NUMBER], DOB: [DATE] presenting with hypertension"

**AI Provider Selection**:
1. System checks user's preferred AI provider (DeepSeek)
2. Verifies DeepSeek availability and quota limits
3. Routes request to DeepSeek with automatic failover to OpenAI if needed

**System Processing**:
1. AI provider analysis identifies: pregnancy, hypertension, blood pressure readings from anonymised data
2. Guideline matching identifies relevant protocols using privacy-protected content
3. Multi-guideline analysis detects potential preeclampsia risk
4. AI generates prioritized recommendations using anonymised clinical context

**User Interaction**:
1. System presents recommendations with privacy audit information
2. User accepts blood pressure monitoring recommendation
3. User modifies suggested follow-up interval based on clinical judgment
4. System applies suggestions to original (non-anonymised) clinical documentation

**Outcome**: Enhanced clinical decision-making with comprehensive privacy protection and AI provider redundancy.

### Example 2: Multi-Provider Emergency Department Support

**Clinical Scenario**: Emergency physician documenting patient with chest pain, with primary AI provider (OpenAI) experiencing service interruption.

**Privacy Protection**:
1. System anonymises patient identifiers before processing
2. Clinical symptoms and findings preserved in anonymised format
3. Privacy audit trail maintained throughout process

**AI Provider Failover**:
1. System attempts to use OpenAI (user preference)
2. Detects OpenAI service interruption
3. Automatically switches to DeepSeek without user intervention
4. Maintains same clinical analysis quality with alternative provider

**Documentation Enhancement**:
1. AI analysis identifies areas for improvement against cardiac guidelines using anonymised data
2. System generates categorised suggestions for additional documentation elements
3. Healthcare professional reviews and selects implementation options
4. Accepted suggestions automatically applied to original clinical documentation

---

## 11. CONCLUSION

This patent application presents a comprehensive and novel approach to clinical decision support through innovative privacy-preserving AI-powered technology. The invention addresses critical healthcare challenges including patient privacy protection, AI vendor independence, and clinical workflow optimization while providing significant technical advances over existing solutions.

The combination of privacy-preserving anonymisation at source, AI model-agnostic architecture with intelligent routing, real-time multi-guideline analysis, and adaptive learning mechanisms represents a substantial technological leap in clinical decision support systems. The demonstrated clinical utility, privacy protection capabilities, AI provider redundancy, and strong market demand support the commercial viability and patent worthiness of this invention.

The technical innovations described herein are both novel and non-obvious, representing significant advances in healthcare privacy protection, AI service architecture, medical informatics, and clinical workflow optimization. The system's ability to maintain complete patient privacy while providing superior clinical decision support through vendor-independent AI services establishes a new paradigm for healthcare AI applications.

---

**Document Prepared By**: CLERKYAI LTD (Pro Se Application)  
**Date**: July 12, 2025  
**Reference**: Clerky Patent Application v2.0 (Updated)  
**Classification**: Computer-Implemented Medical Systems, AI Healthcare Applications, Healthcare Privacy Protection 