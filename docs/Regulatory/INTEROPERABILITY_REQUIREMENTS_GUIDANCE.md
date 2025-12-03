# NHS DTAC Interoperability Requirements - Guidance

## When is Interoperability Required?

NHS DTAC interoperability requirements depend on **how your system will be deployed and used**:

### Standalone Deployment (Interoperability May Be Optional)

**Scenario**: Clerky is used as a standalone tool where:
- Clinicians manually input clinical transcripts/notes
- System provides guidance and recommendations
- Outputs are reviewed by clinicians and manually entered into patient records
- No direct integration with NHS EHR systems

**Interoperability Status**: 
- **May be optional** for initial DTAC assessment
- Can be documented as a "roadmap item" for future phases
- Focus on demonstrating the system works effectively standalone

**What You Still Need**:
- Document interoperability roadmap
- Explain why standalone deployment is appropriate
- Show how data can be exported/manually integrated
- Plan for future interoperability if needed

### Integrated Deployment (Interoperability Mandatory)

**Scenario**: Clerky integrates with:
- NHS EHR systems (e.g., Epic, Cerner, SystemOne)
- Patient record systems
- NHS Spine services
- GP Connect
- Other NHS clinical systems

**Interoperability Status**: 
- **Mandatory** - must demonstrate HL7 FHIR or equivalent standards
- NHS Number validation required
- SNOMED CT coding may be required
- Integration testing with NHS systems needed

## How to Determine Your Requirements

### Questions to Ask:

1. **How will clinicians use Clerky?**
   - [ ] Standalone web application
   - [ ] Integrated into existing EHR
   - [ ] Both (standalone initially, integrated later)

2. **Will Clerky access patient records directly?**
   - [ ] No - clinicians input data manually
   - [ ] Yes - system reads from patient records
   - [ ] Yes - system writes to patient records

3. **What is your target NHS trust's preference?**
   - Some trusts prefer standalone tools initially
   - Others require full integration from day one
   - **Recommendation**: Start conversations with target trusts early

4. **What is your go-to-market strategy?**
   - [ ] Deploy standalone first, add integration later
   - [ ] Full integration required from launch
   - [ ] Hybrid approach

## Recommended Approach for Clerky

Based on Clerky's current architecture and use case:

### Phase 1: Standalone Deployment (Recommended for Initial DTAC)

**Rationale**:
- Clerky is designed as a clinical decision support tool
- Current workflow involves manual input of transcripts
- Standalone deployment is faster to achieve DTAC compliance
- Allows validation of clinical effectiveness before integration complexity

**What to Document**:
- System operates as standalone clinical decision support tool
- Manual data input workflow
- Export capabilities for integration into patient records
- Interoperability roadmap for future phases
- Clear explanation of why standalone is appropriate for initial deployment

**DTAC Submission**:
- Mark interoperability as "roadmap item" or "future enhancement"
- Provide clear timeline for integration if required
- Demonstrate system effectiveness without integration

### Phase 2: Integration (If Required)

**When to Add**:
- After successful standalone deployment
- When specific NHS trusts require integration
- When clinical workflows demand direct EHR access

**What to Implement**:
- HL7 FHIR API endpoints
- NHS Number validation service
- SNOMED CT terminology service (if coding required)
- Integration with target EHR systems
- Write-back capabilities (if required)

## NHS Digital Engagement

**Critical Step**: Engage with NHS Digital early to clarify:

1. **DTAC Assessment Team**: Ask specifically about interoperability requirements for standalone clinical decision support tools
2. **Target NHS Trusts**: Discuss with potential pilot trusts about their integration requirements
3. **Clinical Safety**: Ensure standalone deployment is acceptable from clinical safety perspective

## Documentation Requirements

Even for standalone deployment, document:

1. **Interoperability Roadmap**:
   - Current state: Standalone deployment
   - Future state: Integration capabilities planned
   - Timeline: When integration will be added
   - Standards: HL7 FHIR, SNOMED CT, etc.

2. **Data Export Capabilities**:
   - How clinicians can export recommendations
   - Format of exported data
   - Manual integration workflow

3. **Future Integration Design**:
   - Planned API structure
   - Integration points identified
   - Standards to be used

## Conclusion

**For Clerky's initial DTAC submission**:
- **Recommendation**: Proceed with standalone deployment model
- **Interoperability**: Document as roadmap item
- **Focus**: Demonstrate clinical effectiveness and safety
- **Future**: Add integration based on specific NHS trust requirements

**Key Action**: Engage with NHS Digital DTAC team to confirm this approach is acceptable before finalizing your submission.



