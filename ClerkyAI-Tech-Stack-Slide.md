# ClerkyAI Tech Stack

## How Clerky's technology delivers safe, real-time decision support

---

## 1. Front-End (Clinician Application)

**Technologies:** Progressive Web App (PWA) | TipTap Rich Text Editor | Firebase SDK | PDF.js Viewer

A responsive web application accessible on mobile and desktop devices, providing clinicians with a modern, intuitive interface. The application features:

- **Rich text editing** powered by TipTap (built on ProseMirror) for structured consultation note entry
- **Real-time collaboration capabilities** through Firebase Firestore's live data synchronisation
- **Integrated PDF viewer** using Mozilla's PDF.js with intelligent search and annotation features
- **Offline-first architecture** enabling continued operation during network interruptions
- **Progressive Web App (PWA)** capabilities for app-like experience on mobile devices

---

## 2. Client-Side Anonymisation & Security

**Technologies:** Custom PII Redaction Engine | AES-256 Encryption | Firebase Authentication

Privacy-by-design architecture ensuring patient data never leaves the clinical environment:

- **Client-side PII stripping** using pattern-matching algorithms and named entity recognition (NER) to identify and remove NHS numbers, patient names, dates of birth, and postcodes before cloud transmission
- **Tokenisation system** replaces identifiable information with anonymous tokens, maintaining clinical context whilst ensuring GDPR compliance
- **End-to-end encryption** (TLS 1.3) for all data in transit
- **Zero-knowledge architecture** ensures the cloud backend never accesses identifiable patient information
- **Firebase Authentication** with Google OAuth 2.0 and JWT token-based session management for secure clinician identity verification

---

## 3. Back-End & AI Engine

**Technologies:** Node.js/Express.js | Firebase Firestore | OpenAI GPT-4 | Google Gemini | Custom NLP Pipeline

Scalable cloud infrastructure processing anonymised clinical notes in real-time:

### Application Layer
- RESTful API built on Node.js/Express.js with rate limiting, input validation, and comprehensive error handling
- Helmet.js security middleware enforcing strict CSP headers and OWASP security best practices
- Winston logging framework for audit trails and system monitoring

### Database Layer
- **Firebase Firestore** NoSQL database providing scalable document storage with real-time synchronisation
- Optimised data structures for fast guideline retrieval and version control
- Automated backup and disaster recovery mechanisms

### AI/NLP Pipeline
- **Multi-model LLM architecture** leveraging OpenAI GPT-4 Turbo and Google Gemini Pro for clinical reasoning
- **Guideline knowledge base** containing structured representations of NICE, RCOG, FSRH, BASHH, and local NHS Trust protocols
- **Intelligent document processing** using pdf-parse and custom NLP for extracting and structuring guideline content
- **Semantic search algorithms** matching clinical scenarios against guideline corpus using vector embeddings
- **Real-time decision support** generating contextual recommendations, flagging deviations from best practice, and providing citation-backed guidance
- **Classification engine** using DeepSeek AI for automated guideline categorisation and tagging

### Guideline Maintenance
- Automated web scraping (Cheerio + Axios) for monitoring guideline updates from authoritative sources
- Version control system tracking guideline revisions and deprecations
- Content validation ensuring URL integrity and domain verification

---

## 4. Integration Layer (EHR Connectivity)

**Technologies:** FHIR R4 API | HL7 Standards | REST/JSON

Standards-based interoperability ensuring seamless integration with existing NHS infrastructure:

- **FHIR R4-compliant APIs** enabling bidirectional data exchange with Electronic Health Record systems
- **HL7 v2.x support** for legacy system compatibility
- **RESTful endpoints** for pulling patient demographics (name, age, gender, relevant medical history) and pushing back annotated consultation notes
- **Webhook integration** for real-time event notifications to EPR systems
- **Data mapping layer** translating between proprietary EHR formats and ClerkyAI's internal data models
- **Audit trail integration** ensuring all AI suggestions are logged within the patient record for medico-legal purposes

---

## 5. Security, Compliance & Infrastructure

**Standards:** ISO 27001 | ISO 13485 (in progress) | NHS Data Security and Protection Toolkit | GDPR

Enterprise-grade security architecture meeting NHS Digital and MHRA requirements:

### Data Security
- AES-256 encryption for data at rest, TLS 1.3 for data in transit
- No long-term storage of clinical content – processing occurs in-memory with immediate deletion post-analysis
- Client-side anonymisation ensures sensitive data remains within NHS Trust boundaries
- Multi-factor authentication (MFA) for all clinician accounts

### Compliance & Governance
- **GDPR compliance** through privacy-by-design architecture and data processing agreements
- **NHS Data Security and Protection Toolkit** certification (in progress)
- **ISO 13485 Medical Device QMS** readiness for MHRA Software as a Medical Device (SaMD) classification
- **ISO 27001 Information Security Management** (roadmap)
- Role-based access control (RBAC) ensuring clinicians only access appropriate resources
- Comprehensive audit logging for regulatory compliance and medico-legal defence

### Infrastructure
- Hosted on **Render** cloud platform with auto-scaling capabilities
- Geographic data residency controls ensuring UK-based data processing
- High availability architecture with 99.9% uptime SLA
- Automated security patching and vulnerability scanning
- DDoS protection and Web Application Firewall (WAF)

### Defence-in-Depth
- Multiple security layers from device to cloud
- Express-rate-limit for API throttling and abuse prevention
- Express-validator for input sanitisation preventing injection attacks
- Regular penetration testing and security audits (planned)

---

## Technical Architecture Summary

```
Clinician Device → Client-side PII Redaction → TLS 1.3 Encryption →
    ↓
Cloud Backend (Node.js/Express) → AI Analysis (GPT-4/Gemini) →
    ↓
Decision Support + Citations → Encrypted Response →
    ↓
Clinician Interface + EHR Integration
```

---

## Key Technical Differentiators

- **Zero-knowledge architecture** protecting patient privacy
- **Multi-model AI approach** ensuring robust clinical reasoning
- **FHIR-native interoperability** for NHS ecosystem integration
- **Scalable cloud infrastructure** supporting Trust-wide deployment

---

*Document prepared for ClerkyAI Business Plan Presentation*  
*Last Updated: November 2025*

