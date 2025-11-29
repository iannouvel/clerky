# NHS DTAC Compliance Challenges for Clerky

## Executive Summary

Clerky is an AI-powered clinical decision support platform designed for NHS maternity care. Achieving NHS Digital Technology Assessment Criteria (DTAC) compliance presents several significant challenges across multiple domains. This document identifies and analyses these challenges to support compliance planning.

## 1. Data Protection & Privacy Challenges

### 1.1 Third-Party AI Provider Data Processing
**Challenge**: Clerky uses multiple external AI providers (OpenAI, Anthropic, DeepSeek, Mistral, Google Gemini) that process clinical data, potentially including patient information.

**Specific Issues**:
- Clinical transcripts are sent to US-based AI providers (OpenAI, Anthropic, Google)
- Even with PII anonymization, clinical context may constitute personal data under GDPR
- No explicit data processing agreements (DPAs) with AI providers visible in codebase
- Data residency requirements: NHS requires UK/EU data processing for sensitive health data
- Provider terms of service may claim rights to use data for training

**DTAC Requirements**:
- Data Protection Impact Assessment (DPIA) required
- Data processing agreements with all third-party processors
- Clear data flow documentation
- UK/EU data residency for patient data

**Current State**:
- PII anonymization implemented using `@libretto/redact-pii-light`
- User review workflow for PII detection
- No visible DPAs or data residency controls for AI providers

### 1.2 Infrastructure & Data Residency
**Challenge**: Core infrastructure services are US-based or may process data outside UK/EU.

**Specific Issues**:
- **Firebase (Google)**: Authentication, Firestore database, Storage - US-based service
- **Render.com**: Backend hosting - US-based service
- **GitHub**: Code repository and guideline storage - US-based service
- No evidence of UK/EU data residency guarantees

**DTAC Requirements**:
- UK/EU data residency for patient data
- Data processing agreements with infrastructure providers
- Clear documentation of data locations

**Current State**:
- Firebase encryption at rest and in transit
- No visible data residency controls or UK/EU-specific deployments

### 1.3 Data Minimization & Retention
**Challenge**: DTAC requires strict data minimization and retention policies.

**Current Gaps**:
- No visible data retention policies in codebase
- No automated data deletion workflows
- Session data stored in Firestore without clear retention limits
- Audit logs may contain clinical data without retention controls

**DTAC Requirements**:
- Documented data retention policies
- Automated data deletion after retention period
- Clear data minimization principles

## 2. Clinical Safety Challenges

### 2.1 Clinical Safety Officer (CSO)
**Challenge**: DTAC requires a designated Clinical Safety Officer with appropriate qualifications.

**Requirements**:
- CSO must be a registered healthcare professional
- CSO must complete clinical safety training
- CSO responsible for clinical risk management
- CSO must sign off on clinical safety documentation

**Current State**:
- No visible CSO designation in codebase
- No clinical safety documentation structure visible

### 2.2 Clinical Risk Management
**Challenge**: Comprehensive clinical risk management system required.

**DTAC Requirements**:
- Clinical Risk Management File (CRMF)
- Hazard identification and analysis
- Risk assessment and mitigation
- Clinical safety case report
- Post-market surveillance plan

**Current State**:
- ISO 13485 compliance documentation exists for audit system
- No visible clinical safety risk management system
- No hazard log or clinical risk register

### 2.3 Incident Reporting & Adverse Events
**Challenge**: System for reporting and managing clinical safety incidents.

**DTAC Requirements**:
- Clinical incident reporting mechanism
- Integration with NHS incident reporting systems (e.g., DATIX)
- Adverse event tracking and analysis
- Root cause analysis capabilities
- Learning and improvement processes

**Current State**:
- No clinical incident reporting system in codebase
- No adverse event tracking
- No integration with NHS incident systems

### 2.4 Clinical Validation
**Challenge**: Evidence of clinical validation and effectiveness.

**DTAC Requirements**:
- Clinical validation studies
- Evidence of clinical effectiveness
- User acceptance testing with clinicians
- Clinical accuracy metrics

**Current State**:
- Audit system exists for guideline compliance testing
- No visible clinical validation studies
- No clinical accuracy metrics documentation

## 3. Technical Security Challenges

### 3.1 Cyber Essentials Certification
**Challenge**: DTAC requires Cyber Essentials or Cyber Essentials Plus certification.

**Requirements**:
- Annual Cyber Essentials certification
- Security controls implementation
- Vulnerability management
- Patch management processes

**Current State**:
- Security measures implemented (helmet, rate limiting, input validation)
- No visible Cyber Essentials certification
- No documented vulnerability management process

### 3.2 Penetration Testing
**Challenge**: Regular penetration testing required.

**DTAC Requirements**:
- Annual penetration testing by qualified testers
- Remediation of identified vulnerabilities
- Penetration test reports
- Evidence of remediation

**Current State**:
- No visible penetration testing reports
- No documented penetration testing schedule

### 3.3 Data Security and Protection Toolkit (DSPT)
**Challenge**: Annual DSPT assessment required.

**Requirements**:
- Complete DSPT assessment annually
- Evidence of security controls
- Data flow documentation
- Incident response procedures

**Current State**:
- No visible DSPT documentation
- Security controls exist but may not be fully documented for DSPT

### 3.4 Access Controls & Authentication
**Challenge**: Robust access controls required.

**Current State**:
- Firebase Authentication implemented
- JWT token validation
- Role-based access control mentioned but not fully visible
- Daily disclaimer acceptance

**Gaps**:
- No visible multi-factor authentication (MFA) requirement
- No session timeout policies visible
- No audit trail for access control changes

## 4. Interoperability Challenges

### 4.1 NHS Standards Compliance
**Challenge**: DTAC requires compliance with NHS interoperability standards.

**Requirements**:
- HL7 FHIR integration capabilities
- NHS Number validation
- Integration with NHS systems (e.g., Spine, GP Connect)
- SNOMED CT coding support
- Terminology standards compliance

**Current State**:
- No HL7 FHIR implementation
- No NHS Number validation
- No integration with NHS systems
- No SNOMED CT coding
- No terminology standards implementation

### 4.2 API Standards
**Challenge**: APIs must follow NHS standards.

**Requirements**:
- RESTful API design following NHS standards
- OpenAPI/Swagger documentation
- API versioning
- Authentication/authorization standards

**Current State**:
- RESTful APIs exist
- No visible OpenAPI documentation
- No API versioning strategy visible

## 5. Usability & Accessibility Challenges

### 5.1 WCAG Compliance
**Challenge**: DTAC requires WCAG 2.1 AA compliance.

**Requirements**:
- WCAG 2.1 Level AA compliance
- Accessibility testing
- Screen reader compatibility
- Keyboard navigation support
- Colour contrast compliance

**Current State**:
- Some ARIA labels found in codebase
- No comprehensive accessibility audit visible
- No WCAG compliance documentation

### 5.2 User Testing
**Challenge**: Evidence of user testing with target users.

**Requirements**:
- User acceptance testing with clinicians
- Usability testing reports
- User feedback incorporation
- Iterative design improvements

**Current State**:
- No visible user testing documentation
- No usability testing reports

## 6. Documentation Challenges

### 6.1 Comprehensive Documentation Requirements
**Challenge**: Extensive documentation required across all DTAC domains.

**Required Documentation**:
- Clinical Safety Case Report
- Data Protection Impact Assessment (DPIA)
- Technical Security Documentation
- Interoperability Documentation
- Usability Documentation
- Clinical Validation Reports
- Risk Management Documentation
- Incident Management Procedures
- Data Processing Agreements
- Privacy Policy & Terms of Service

**Current State**:
- Intended Use Statement exists
- ISO 13485 compliance documentation for audit system
- Technical specifications exist
- Missing most DTAC-specific documentation

### 6.2 Ongoing Documentation Maintenance
**Challenge**: Documentation must be kept current.

**Requirements**:
- Regular documentation updates
- Version control for documentation
- Change management documentation
- Document approval workflows

**Current State**:
- Documentation exists but may not be structured for DTAC requirements
- No visible document control system

## 7. Regulatory & Legal Challenges

### 7.1 UKCA/MHRA Medical Device Registration
**Challenge**: Clerky may require registration as a Software as a Medical Device (SaMD).

**Requirements**:
- UKCA marking (if Class I or higher)
- MHRA registration
- Quality Management System (QMS)
- Post-market surveillance
- Vigilance reporting

**Current State**:
- Intended Use Statement indicates anticipated Class I classification
- ISO 13485 compliance framework exists
- No visible MHRA registration
- No QMS documentation structure

### 7.2 Data Processing Agreements
**Challenge**: DPAs required with all data processors.

**Required DPAs**:
- Firebase/Google Cloud
- Render.com
- GitHub (if processing data)
- AI providers (OpenAI, Anthropic, DeepSeek, Mistral, Google)
- Any other third-party processors

**Current State**:
- No visible DPAs in codebase
- Standard terms of service likely in use

### 7.3 Terms of Service & Privacy Policy
**Challenge**: NHS-compliant terms and privacy policy required.

**Requirements**:
- Clear data processing purposes
- Legal basis for processing
- Data subject rights
- Complaint procedures
- Contact information for Data Protection Officer

**Current State**:
- Privacy policy exists (`privacy-policy.html`)
- May need updates for NHS-specific requirements

## 8. Operational Challenges

### 8.1 Ongoing Compliance Maintenance
**Challenge**: Compliance is not one-time; requires continuous maintenance.

**Ongoing Requirements**:
- Annual DSPT assessment
- Annual Cyber Essentials certification
- Annual penetration testing
- Regular clinical safety reviews
- Continuous monitoring and updates
- Incident response and management

**Current State**:
- No visible compliance maintenance schedule
- No ongoing compliance monitoring system

### 8.2 Change Management
**Challenge**: Changes must be assessed for compliance impact.

**Requirements**:
- Change impact assessment process
- Clinical safety impact assessment
- Data protection impact assessment for changes
- Documentation updates for changes
- Testing and validation of changes

**Current State**:
- No visible change management process
- No change impact assessment procedures

### 8.3 Training & Support
**Challenge**: User training and support documentation required.

**Requirements**:
- User training materials
- Clinical user guides
- Technical support procedures
- Incident reporting procedures for users

**Current State**:
- README and documentation exist
- May need NHS-specific user guides

## 9. Cost & Resource Challenges

### 9.1 Compliance Resource Requirements
**Challenge**: Significant resources required for compliance.

**Resource Needs**:
- Clinical Safety Officer (part-time or full-time)
- Data Protection Officer (if required)
- Compliance officer/team
- Legal support for DPAs
- Penetration testing services
- Certification costs (Cyber Essentials, etc.)
- Documentation development time
- Ongoing maintenance resources

### 9.2 Timeline Challenges
**Challenge**: Compliance process is time-consuming.

**Typical Timeline**:
- Initial assessment: 1-2 months
- Documentation development: 3-6 months
- Implementation of required controls: 2-4 months
- Testing and validation: 2-3 months
- Review and approval: 1-3 months
- **Total: 9-18 months** (depending on resources and complexity)

## 10. Specific Technical Implementation Challenges

### 10.1 AI Provider Data Processing
**Critical Challenge**: Clinical data sent to multiple AI providers.

**Required Solutions**:
- Implement UK/EU-based AI providers or on-premise solutions
- Negotiate DPAs with all AI providers
- Implement additional anonymization layers
- Consider federated learning or local AI models
- Implement data processing agreements with explicit UK/EU data residency

### 10.2 Infrastructure Migration
**Challenge**: May need to migrate to UK/EU-based infrastructure.

**Options**:
- Migrate Firebase to UK/EU region (if available)
- Consider UK-based cloud providers (e.g., UKCloud, AWS UK regions)
- Implement hybrid architecture with UK data residency
- Evaluate on-premise deployment options

### 10.3 Interoperability Implementation
**Challenge**: Significant development required for NHS standards.

**Required Work**:
- HL7 FHIR implementation
- NHS Number validation service integration
- Terminology service integration (SNOMED CT)
- API development following NHS standards
- Integration testing with NHS systems

## 11. Risk Assessment Summary

### High-Risk Areas
1. **Data Processing by US AI Providers** - Critical data protection issue
2. **US-Based Infrastructure** - Data residency concerns
3. **Missing Clinical Safety System** - Fundamental requirement
4. **Lack of Interoperability Standards** - Major gap for NHS integration
5. **Incomplete Documentation** - Blocks DTAC assessment

### Medium-Risk Areas
1. **Accessibility Compliance** - Requires testing and remediation
2. **Penetration Testing** - Required but not yet completed
3. **DSPT Assessment** - Annual requirement
4. **Change Management** - Needed for ongoing compliance

### Lower-Risk Areas
1. **User Testing** - Can be addressed with planning
2. **Training Materials** - Documentation task
3. **Terms of Service Updates** - Legal review needed

## 12. Recommended Approach

### Phase 1: Critical Foundations (Months 1-3)
1. Appoint Clinical Safety Officer
2. Conduct Data Protection Impact Assessment
3. Negotiate Data Processing Agreements with all third parties
4. Establish clinical risk management system
5. Begin infrastructure assessment for UK/EU data residency

### Phase 2: Core Compliance (Months 4-8)
1. Implement clinical safety documentation
2. Complete Cyber Essentials certification
3. Conduct penetration testing
4. Complete DSPT assessment
5. Develop comprehensive documentation
6. Implement accessibility improvements

### Phase 3: Advanced Requirements (Months 9-12)
1. Begin interoperability implementation (HL7 FHIR)
2. Complete clinical validation studies
3. Implement change management processes
4. Establish ongoing compliance monitoring
5. Prepare for DTAC submission

### Phase 4: Ongoing Maintenance
1. Annual certifications and assessments
2. Continuous monitoring and updates
3. Regular clinical safety reviews
4. Documentation maintenance

## 13. Key Questions to Resolve

1. **Data Residency**: Can we achieve UK/EU data residency with current providers, or is migration required?
2. **AI Providers**: Can we use UK/EU-based AI providers, or must we implement additional controls?
3. **Clinical Safety Officer**: Who will serve as CSO, and what are their qualifications?
4. **Infrastructure**: Is migration to UK-based infrastructure feasible and cost-effective?
5. **Interoperability**: What level of NHS system integration is required for initial deployment?
6. **Timeline**: What is the target timeline for DTAC compliance?
7. **Resources**: What budget and resources are available for compliance activities?

## 14. Conclusion

Achieving NHS DTAC compliance for Clerky is a substantial undertaking requiring significant resources, time, and expertise. The most critical challenges are:

1. **Data protection and residency** - particularly regarding AI provider data processing
2. **Clinical safety** - establishing comprehensive clinical risk management
3. **Infrastructure** - ensuring UK/EU data residency
4. **Interoperability** - implementing NHS standards
5. **Documentation** - developing comprehensive compliance documentation

Success will require:
- Dedicated compliance resources
- Clinical safety expertise
- Legal support for agreements
- Technical implementation of required controls
- Ongoing commitment to compliance maintenance

Early engagement with NHS Digital and compliance experts is strongly recommended to navigate these challenges effectively.

