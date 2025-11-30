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

**✅ STATUS**: **IN PROGRESS**
- **CSO Designate**: Ian Nouvel
- **Training Status**: Currently completing online CSO training
- **Next Steps**: 
  - Complete training and obtain certification
  - Confirm registered healthcare professional status
  - Begin developing Clinical Risk Management File (CRMF)
  - Establish clinical safety documentation structure

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

**Requirements** (may vary by deployment model):
- HL7 FHIR integration capabilities (may be optional for standalone systems)
- NHS Number validation (if integrating with patient records)
- Integration with NHS systems (e.g., Spine, GP Connect) - depends on use case
- SNOMED CT coding support (if coding clinical data)
- Terminology standards compliance

**Current State**:
- No HL7 FHIR implementation
- No NHS Number validation
- No integration with NHS systems
- No SNOMED CT coding
- No terminology standards implementation

**⚠️ CLARIFICATION NEEDED**:
- **Standalone Deployment**: If Clerky operates as a standalone tool where clinicians manually input data, interoperability may be **optional** for initial DTAC assessment
- **Integrated Deployment**: If Clerky integrates with NHS EHRs or patient record systems, interoperability becomes **mandatory**
- **Recommendation**: 
  - Start with standalone deployment to achieve DTAC compliance faster
  - Add interoperability features as Phase 2 based on specific NHS trust requirements
  - Document interoperability roadmap in DTAC submission

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

**✅ SOLUTION IDENTIFIED**: Deploy open-source/weighted LLMs on UK-based AWS servers.

**Recommended Approach**:
- **Option 1 (Recommended)**: Deploy open-source LLMs (Llama 2/3, Mistral, or similar) on AWS UK (eu-west-2) infrastructure
  - Models can be self-hosted on EC2 instances with GPU support (e.g., g4dn, g5 instances)
  - Complete data residency within UK
  - No third-party data processing agreements needed
  - Full control over data processing

- **Option 2**: Use managed AI services with UK data residency (if available)
- **Option 3**: Hybrid approach - critical processing on UK servers, non-sensitive tasks on managed services with DPAs

**Implementation Considerations**:
- Model selection: Llama 2/3, Mistral 7B/8x7B, or other open-source models suitable for clinical text
- Infrastructure: AWS EC2 with GPU instances (g4dn.xlarge or larger for inference)
- Containerization: Docker containers for model deployment
- API compatibility: Maintain existing API structure for minimal code changes
- Performance: May require optimization for latency compared to managed services
- Cost: Self-hosted may be more cost-effective than API-based pricing at scale

### 10.2 Infrastructure Migration
**Challenge**: Migration to UK/EU-based infrastructure required.

**✅ SOLUTION IDENTIFIED**: Migrate to AWS UK regions.

**Migration Plan**:
- **Target**: AWS London region (eu-west-2) for all services
- **Services to Migrate**:
  - Backend: Render.com → AWS EC2/ECS/EKS (UK region)
  - Database: Firebase Firestore → AWS RDS or DynamoDB (UK region)
  - Storage: Firebase Storage → AWS S3 (UK region)
  - Authentication: Firebase Auth → AWS Cognito or maintain Firebase with UK data residency
  - Frontend: Current Firebase Hosting → AWS S3 + CloudFront (UK edge locations)

**Migration Considerations**:
- Firebase may offer UK data residency options - evaluate before full migration
- AWS UK regions fully support NHS DTAC requirements
- Data migration strategy needed for existing Firestore data
- API compatibility layer may be needed during transition
- Cost analysis: AWS UK pricing vs current Firebase/Render costs

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

## 12. Recommended Approach - UPDATED WITH SOLUTIONS

### Phase 1: Critical Foundations (Months 1-3)
1. ✅ **Complete CSO Training** - Ian Nouvel to finish online CSO training
2. **Conduct Data Protection Impact Assessment (DPIA)**
3. **Plan Infrastructure Migration**:
   - Design AWS UK architecture
   - Select open-source LLM models for deployment
   - Plan data migration from Firebase/Render
4. **Establish Clinical Risk Management System**:
   - Create Clinical Risk Management File (CRMF) structure
   - Begin hazard identification and risk assessment
5. **Begin AWS Migration Planning**:
   - Set up AWS UK account
   - Design infrastructure architecture
   - Plan LLM deployment strategy

### Phase 2: Infrastructure Migration & Core Compliance (Months 4-8)
1. **Execute Infrastructure Migration**:
   - Migrate backend to AWS UK (EC2/ECS)
   - Deploy open-source LLMs on AWS UK GPU instances
   - Migrate database to AWS UK (RDS/DynamoDB)
   - Migrate storage to AWS S3 UK
   - Test and validate UK data residency
2. **Implement Clinical Safety Documentation**:
   - Complete Clinical Safety Case Report
   - Maintain Hazard Log
   - Document clinical risk mitigations
3. **Complete Cyber Essentials Certification**
4. **Conduct Penetration Testing** (CREST-approved provider)
5. **Complete DSPT Assessment**
6. **Develop Comprehensive Documentation**:
   - Update DPIA with new infrastructure
   - Document data flows
   - Create technical security documentation
7. **Implement Accessibility Improvements** (WCAG 2.1 AA)

### Phase 3: Advanced Requirements (Months 9-12)
1. **Interoperability (Conditional)**:
   - Assess specific NHS trust requirements
   - If required: Begin HL7 FHIR implementation
   - If standalone: Document interoperability roadmap
2. **Complete Clinical Validation Studies**
3. **Implement Change Management Processes**
4. **Establish Ongoing Compliance Monitoring**
5. **Prepare for DTAC Submission**:
   - Compile all documentation
   - Complete DTAC assessment form
   - Submit for review

### Phase 4: Ongoing Maintenance
1. Annual certifications and assessments (Cyber Essentials, DSPT)
2. Continuous monitoring and updates
3. Regular clinical safety reviews
4. Documentation maintenance
5. Infrastructure monitoring and optimization

## 13. Key Questions to Resolve - UPDATED WITH ANSWERS

1. **Data Residency**: ✅ **ANSWERED** - Migration to AWS UK-based servers is feasible and acceptable for NHS DTAC compliance. AWS offers UK data centers (London region) that meet NHS data residency requirements.

2. **AI Providers**: ✅ **ANSWERED** - Open-source/weighted LLMs (e.g., Llama, Mistral) deployed on UK-based AWS servers would meet data residency criteria. This approach eliminates concerns about US-based AI providers processing clinical data.

3. **Clinical Safety Officer**: ✅ **ANSWERED** - Ian Nouvel is currently completing CSO online training. Once training is complete and registered clinician status is confirmed, this requirement will be met.

4. **Infrastructure**: ✅ **ANSWERED** - Migration to AWS UK-based infrastructure is feasible and aligns with NHS requirements. AWS UK regions (eu-west-2) provide the necessary data residency guarantees.

5. **Interoperability**: ⚠️ **NEEDS CLARIFICATION** - The level of NHS system integration required depends on:
   - Whether Clerky will integrate with existing NHS systems (EHRs, patient records)
   - Whether it will be used standalone or as part of a larger system
   - Specific NHS trust requirements
   - **Recommendation**: Start with standalone deployment, then add interoperability features as needed. HL7 FHIR may not be mandatory for initial deployment if the system operates independently.

6. **Timeline**: To be determined based on migration and implementation complexity.

7. **Resources**: To be determined, but migration to AWS and open-source LLMs may reduce ongoing compliance costs compared to US-based services.

## 14. Conclusion - UPDATED WITH SOLUTIONS

Achieving NHS DTAC compliance for Clerky is a substantial undertaking, but **key solutions have been identified**:

### ✅ Solutions Identified:

1. **Data Protection & Residency** - **SOLVED**:
   - Migration to AWS UK regions (eu-west-2) will meet data residency requirements
   - Open-source LLMs deployed on UK servers eliminate third-party data processing concerns
   - No DPAs needed for self-hosted models

2. **Clinical Safety** - **IN PROGRESS**:
   - CSO training underway (Ian Nouvel)
   - Clinical risk management system can be established once training complete

3. **Infrastructure** - **SOLUTION IDENTIFIED**:
   - AWS UK migration is feasible and acceptable
   - Clear migration path from current Firebase/Render setup

4. **Interoperability** - **CLARIFICATION NEEDED**:
   - May be optional for standalone deployment
   - Can be addressed in Phase 2 based on specific requirements

5. **Documentation** - **ACTIONABLE**:
   - Clear documentation requirements identified
   - Can be developed in parallel with infrastructure work

### Key Advantages of Identified Solutions:

- **Cost Control**: Self-hosted LLMs may be more cost-effective than API-based services at scale
- **Data Sovereignty**: Complete control over data processing location
- **Compliance Simplicity**: Fewer third-party agreements needed
- **Flexibility**: Open-source models allow customization for clinical use cases

### Remaining Work:

- Complete CSO training and establish clinical safety processes
- Execute AWS UK migration
- Deploy and optimize open-source LLM models
- Complete documentation and certifications
- Determine interoperability requirements with NHS trusts

### Next Immediate Steps:

1. **Complete CSO Training** (Ian Nouvel)
2. **Begin AWS UK Architecture Design**
3. **Select and Test Open-Source LLM Models** for clinical text processing
4. **Conduct DPIA** with new infrastructure plan
5. **Engage with NHS Digital** to clarify interoperability requirements

Early engagement with NHS Digital and compliance experts is still strongly recommended, but the path forward is now clearer with these solutions identified.

