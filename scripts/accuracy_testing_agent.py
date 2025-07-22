#!/usr/bin/env python3
"""
Automated Accuracy Testing Agent for Clinical Guidelines System

This agent tests the accuracy of the clinical guidelines recommendation system by:
1. Extracting key safety elements from guidelines
2. Modifying transcripts to introduce compliance issues
3. Testing the system's ability to detect these issues
4. Reporting accuracy metrics

Author: AI Assistant
Created: January 2025
"""

import asyncio
import json
import random
import re
import logging
from typing import Dict, List, Tuple, Optional, Union
from dataclasses import dataclass, asdict
from datetime import datetime, timedelta
import aiohttp
import time
from pathlib import Path
import argparse
import sys
import os

# Add the parent directory to the path to import shared modules
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

@dataclass
class SafetyElement:
    """Represents a key safety element extracted from a guideline"""
    id: str
    guideline_id: str
    guideline_title: str
    condition: str  # The "if" part - what condition triggers this rule
    action: str     # The "then" part - what should be done
    severity: str   # high, medium, low
    element_type: str  # assessment, investigation, treatment, monitoring, referral
    source_text: str   # Original text from guideline
    confidence: float  # AI confidence in extraction (0-1)

@dataclass
class TranscriptModification:
    """Represents a modification made to a transcript for testing"""
    modification_id: str
    transcript_id: str
    safety_element_id: str
    modification_type: str  # omission, non_compliance, incorrect_advice
    original_text: str
    modified_text: str
    expected_detection: str  # What the system should detect
    severity: str

@dataclass
class TestResult:
    """Results from a single test run"""
    test_id: str
    timestamp: datetime
    guideline_id: str
    guideline_title: str
    transcript_id: str
    safety_element: SafetyElement
    modification: TranscriptModification
    system_response: Dict
    detected_issue: bool
    correct_detection: bool
    accuracy_score: float  # 0-1
    details: Dict

@dataclass
class AccuracyReport:
    """Comprehensive accuracy report"""
    report_id: str
    timestamp: datetime
    total_tests: int
    overall_accuracy: float
    accuracy_by_severity: Dict[str, float]
    accuracy_by_modification_type: Dict[str, float]
    accuracy_by_guideline: Dict[str, float]
    failed_tests: List[TestResult]
    recommendations: List[str]

class GuidelineSafetyExtractor:
    """Extracts key safety elements from clinical guidelines"""
    
    def __init__(self, server_url: str, auth_token: str = None):
        self.server_url = server_url
        self.auth_token = auth_token
        self.logger = logging.getLogger(__name__)
        
    async def extract_safety_elements(self, guideline_content: str, guideline_id: str, guideline_title: str) -> List[SafetyElement]:
        """Extract key safety elements from a guideline using AI analysis"""
        
        prompt = f"""You are a medical AI expert specializing in clinical safety analysis. Your task is to extract key safety-critical elements from clinical guidelines that follow "if-then" logic patterns.

GUIDELINE TO ANALYZE:
Title: {guideline_title}
Content: {guideline_content}

EXTRACTION TASK:
Identify safety-critical elements that follow clear conditional logic:
- IF [specific clinical condition/scenario] THEN [required action/intervention]

Focus on elements that:
1. Are CRITICAL for patient safety (not optional recommendations)
2. Have clear triggers (specific conditions, test results, timeframes)
3. Require specific actions (assessments, investigations, treatments, monitoring, referrals)
4. Would represent significant safety failures if omitted

SEVERITY CLASSIFICATION:
- HIGH: Life-threatening if omitted (emergency interventions, critical monitoring)
- MEDIUM: Significant morbidity if omitted (important assessments, key treatments)
- LOW: Quality of care impact if omitted (routine monitoring, documentation)

ELEMENT TYPES:
- assessment: Required clinical assessments or examinations
- investigation: Mandatory tests, scans, or laboratory work
- treatment: Required medications, procedures, or interventions
- monitoring: Essential ongoing surveillance or follow-up
- referral: Required specialist consultations or transfers

Return your analysis as a JSON array with this exact structure:
[
  {{
    "condition": "Clear description of the trigger condition",
    "action": "Specific required action or intervention", 
    "severity": "high|medium|low",
    "element_type": "assessment|investigation|treatment|monitoring|referral",
    "source_text": "Direct quote from guideline supporting this element",
    "confidence": 0.95
  }}
]

CRITICAL REQUIREMENTS:
- Only include elements that are MANDATORY, not suggested
- Be specific about conditions and actions
- Quote exact text from the guideline as evidence
- Ensure each element represents a testable safety requirement

Return ONLY the JSON array, no additional text."""

        try:
            # Call AI service to extract safety elements
            async with aiohttp.ClientSession() as session:
                headers = {'Content-Type': 'application/json'}
                if self.auth_token:
                    headers['Authorization'] = f'Bearer {self.auth_token}'
                
                payload = {
                    'messages': [
                        {'role': 'user', 'content': prompt}
                    ]
                }
                
                async with session.post(f'{self.server_url}/routeToAI', 
                                      json=payload, headers=headers) as response:
                    if response.status != 200:
                        raise Exception(f"AI service error: {response.status}")
                    
                    result = await response.json()
                    ai_response = result.get('content', '')
                    
                    # Parse JSON response
                    try:
                        elements_data = json.loads(ai_response)
                        safety_elements = []
                        
                        for i, element_data in enumerate(elements_data):
                            element = SafetyElement(
                                id=f"{guideline_id}_safety_{i+1}",
                                guideline_id=guideline_id,
                                guideline_title=guideline_title,
                                condition=element_data['condition'],
                                action=element_data['action'],
                                severity=element_data['severity'],
                                element_type=element_data['element_type'],
                                source_text=element_data['source_text'],
                                confidence=element_data.get('confidence', 0.8)
                            )
                            safety_elements.append(element)
                        
                        self.logger.info(f"Extracted {len(safety_elements)} safety elements from {guideline_title}")
                        return safety_elements
                        
                    except json.JSONDecodeError as e:
                        self.logger.error(f"Failed to parse AI response as JSON: {e}")
                        return []
                        
        except Exception as e:
            self.logger.error(f"Error extracting safety elements: {e}")
            return []

class TranscriptModifier:
    """Modifies clinical transcripts to introduce compliance issues for testing"""
    
    def __init__(self, server_url: str, auth_token: str = None):
        self.server_url = server_url
        self.auth_token = auth_token
        self.logger = logging.getLogger(__name__)
        
    async def create_test_modifications(self, original_transcript: str, safety_element: SafetyElement) -> List[TranscriptModification]:
        """Create various types of test modifications based on a safety element"""
        
        modifications = []
        
        # Type 1: Complete omission - remove mention of the required action
        omission_mod = await self._create_omission_modification(original_transcript, safety_element)
        if omission_mod:
            modifications.append(omission_mod)
        
        # Type 2: Non-compliant advice - include incorrect or contraindicated advice
        non_compliance_mod = await self._create_non_compliance_modification(original_transcript, safety_element)
        if non_compliance_mod:
            modifications.append(non_compliance_mod)
        
        # Type 3: Incorrect advice - provide advice that doesn't follow the guideline
        incorrect_mod = await self._create_incorrect_advice_modification(original_transcript, safety_element)
        if incorrect_mod:
            modifications.append(incorrect_mod)
            
        return modifications
    
    async def _create_omission_modification(self, transcript: str, safety_element: SafetyElement) -> Optional[TranscriptModification]:
        """Create a modification that omits required safety actions"""
        
        prompt = f"""You are a medical AI assistant creating test scenarios for clinical guidelines compliance testing.

TASK: Modify the clinical transcript to OMIT the required safety action while keeping the transcript realistic and clinically coherent.

ORIGINAL TRANSCRIPT:
{transcript}

SAFETY ELEMENT TO OMIT:
Condition: {safety_element.condition}
Required Action: {safety_element.action}
Type: {safety_element.element_type}

MODIFICATION INSTRUCTIONS:
1. Remove or avoid mentioning the required action from the RECOMMENDATION section
2. Keep all other clinical details intact and realistic
3. Ensure the modification creates a clear compliance gap that should be detected
4. Maintain professional medical documentation style
5. Do NOT include any explanation or commentary

Return the modified transcript only, maintaining the same SBAR structure (Situation, Background, Assessment, Recommendation).

CRITICAL: The modification should create a scenario where the required safety action is missing, which a compliant system should flag as non-adherent to guidelines."""

        try:
            async with aiohttp.ClientSession() as session:
                headers = {'Content-Type': 'application/json'}
                if self.auth_token:
                    headers['Authorization'] = f'Bearer {self.auth_token}'
                
                payload = {
                    'messages': [
                        {'role': 'user', 'content': prompt}
                    ]
                }
                
                async with session.post(f'{self.server_url}/routeToAI', 
                                      json=payload, headers=headers) as response:
                    if response.status != 200:
                        return None
                    
                    result = await response.json()
                    modified_transcript = result.get('content', '').strip()
                    
                    if modified_transcript and modified_transcript != transcript:
                        return TranscriptModification(
                            modification_id=f"{safety_element.id}_omission_{int(time.time())}",
                            transcript_id="test_transcript",
                            safety_element_id=safety_element.id,
                            modification_type="omission",
                            original_text=transcript,
                            modified_text=modified_transcript,
                            expected_detection=f"System should detect missing: {safety_element.action}",
                            severity=safety_element.severity
                        )
                    
        except Exception as e:
            self.logger.error(f"Error creating omission modification: {e}")
            
        return None
    
    async def _create_non_compliance_modification(self, transcript: str, safety_element: SafetyElement) -> Optional[TranscriptModification]:
        """Create a modification that includes non-compliant advice"""
        
        prompt = f"""You are a medical AI assistant creating test scenarios for clinical guidelines compliance testing.

TASK: Modify the clinical transcript to include advice that is NON-COMPLIANT with the required safety guideline while keeping the transcript realistic.

ORIGINAL TRANSCRIPT:
{transcript}

SAFETY ELEMENT FOR NON-COMPLIANCE:
Condition: {safety_element.condition}
Required Action: {safety_element.action}
Type: {safety_element.element_type}

MODIFICATION INSTRUCTIONS:
1. Include advice in the RECOMMENDATION section that contradicts or ignores the required safety action
2. Make the non-compliance subtle but clear (not obviously dangerous)
3. Keep all other clinical details intact and realistic
4. Ensure the modification represents a missed guideline requirement
5. Maintain professional medical documentation style
6. Do NOT include any explanation or commentary

Examples of non-compliance:
- Recommending routine follow-up when urgent action is required
- Omitting required investigations before treatment
- Suggesting delayed intervention when immediate action is mandated
- Using inappropriate monitoring intervals

Return the modified transcript only, maintaining the same SBAR structure.

CRITICAL: The modification should create a scenario where the provided advice doesn't follow the guideline requirement, which a compliant system should flag."""

        try:
            async with aiohttp.ClientSession() as session:
                headers = {'Content-Type': 'application/json'}
                if self.auth_token:
                    headers['Authorization'] = f'Bearer {self.auth_token}'
                
                payload = {
                    'messages': [
                        {'role': 'user', 'content': prompt}
                    ]
                }
                
                async with session.post(f'{self.server_url}/routeToAI', 
                                      json=payload, headers=headers) as response:
                    if response.status != 200:
                        return None
                    
                    result = await response.json()
                    modified_transcript = result.get('content', '').strip()
                    
                    if modified_transcript and modified_transcript != transcript:
                        return TranscriptModification(
                            modification_id=f"{safety_element.id}_noncompliance_{int(time.time())}",
                            transcript_id="test_transcript",
                            safety_element_id=safety_element.id,
                            modification_type="non_compliance",
                            original_text=transcript,
                            modified_text=modified_transcript,
                            expected_detection=f"System should detect non-compliance with: {safety_element.action}",
                            severity=safety_element.severity
                        )
                    
        except Exception as e:
            self.logger.error(f"Error creating non-compliance modification: {e}")
            
        return None
    
    async def _create_incorrect_advice_modification(self, transcript: str, safety_element: SafetyElement) -> Optional[TranscriptModification]:
        """Create a modification that provides incorrect advice"""
        
        prompt = f"""You are a medical AI assistant creating test scenarios for clinical guidelines compliance testing.

TASK: Modify the clinical transcript to include INCORRECT advice that goes against the safety guideline while maintaining clinical realism.

ORIGINAL TRANSCRIPT:
{transcript}

SAFETY ELEMENT TO CONTRADICT:
Condition: {safety_element.condition}
Correct Action: {safety_element.action}
Type: {safety_element.element_type}

MODIFICATION INSTRUCTIONS:
1. Include advice in the RECOMMENDATION section that is incorrect according to the guideline
2. Make the incorrect advice plausible but wrong (not obviously dangerous)
3. Keep all other clinical details intact and realistic
4. Ensure the advice represents a clear deviation from evidence-based practice
5. Maintain professional medical documentation style
6. Do NOT include any explanation or commentary

Examples of incorrect advice:
- Wrong medication dosing or timing
- Inappropriate investigation sequence
- Incorrect monitoring intervals
- Wrong referral thresholds
- Inappropriate treatment delays

Return the modified transcript only, maintaining the same SBAR structure.

CRITICAL: The modification should provide advice that contradicts the guideline, which a compliant system should identify and correct."""

        try:
            async with aiohttp.ClientSession() as session:
                headers = {'Content-Type': 'application/json'}
                if self.auth_token:
                    headers['Authorization'] = f'Bearer {self.auth_token}'
                
                payload = {
                    'messages': [
                        {'role': 'user', 'content': prompt}
                    ]
                }
                
                async with session.post(f'{self.server_url}/routeToAI', 
                                      json=payload, headers=headers) as response:
                    if response.status != 200:
                        return None
                    
                    result = await response.json()
                    modified_transcript = result.get('content', '').strip()
                    
                    if modified_transcript and modified_transcript != transcript:
                        return TranscriptModification(
                            modification_id=f"{safety_element.id}_incorrect_{int(time.time())}",
                            transcript_id="test_transcript",
                            safety_element_id=safety_element.id,
                            modification_type="incorrect_advice",
                            original_text=transcript,
                            modified_text=modified_transcript,
                            expected_detection=f"System should correct incorrect advice and recommend: {safety_element.action}",
                            severity=safety_element.severity
                        )
                    
        except Exception as e:
            self.logger.error(f"Error creating incorrect advice modification: {e}")
            
        return None

class AccuracyTestRunner:
    """Orchestrates the accuracy testing process"""
    
    def __init__(self, server_url: str, auth_token: str = None):
        self.server_url = server_url
        self.auth_token = auth_token
        self.safety_extractor = GuidelineSafetyExtractor(server_url, auth_token)
        self.transcript_modifier = TranscriptModifier(server_url, auth_token)
        self.logger = logging.getLogger(__name__)
        
        # Load clinical data
        self.guidelines = {}
        self.transcripts = {}
        self.clinical_issues = {}
        
    async def initialize(self):
        """Load necessary data for testing"""
        try:
            # Load clinical issues
            with open('clinical_issues.json', 'r') as f:
                self.clinical_issues = json.load(f)
            
            # Load fake transcripts
            with open('fake_transcripts.json', 'r') as f:
                self.transcripts = json.load(f)
            
            # Load guidelines from server
            await self._load_guidelines()
            
            self.logger.info(f"Initialized with {len(self.guidelines)} guidelines and {sum(len(category) for category in self.transcripts.values())} transcripts")
            
        except Exception as e:
            self.logger.error(f"Error during initialization: {e}")
            raise
    
    async def _load_guidelines(self):
        """Load guidelines from the server"""
        try:
            async with aiohttp.ClientSession() as session:
                headers = {}
                if self.auth_token:
                    headers['Authorization'] = f'Bearer {self.auth_token}'
                
                async with session.get(f'{self.server_url}/getAllGuidelines', 
                                     headers=headers) as response:
                    if response.status == 200:
                        result = await response.json()
                        if result.get('success'):
                            for guideline in result.get('guidelines', []):
                                self.guidelines[guideline['id']] = guideline
                            
        except Exception as e:
            self.logger.error(f"Error loading guidelines: {e}")
    
    async def run_random_test(self) -> TestResult:
        """Run a single random accuracy test"""
        
        # Step 1: Randomly select a guideline
        guideline_id = random.choice(list(self.guidelines.keys()))
        guideline = self.guidelines[guideline_id]
        
        self.logger.info(f"Testing guideline: {guideline.get('title', guideline_id)}")
        
        # Step 2: Extract safety elements from the guideline
        guideline_content = guideline.get('content') or guideline.get('condensed', '')
        if not guideline_content:
            raise Exception(f"No content available for guideline {guideline_id}")
        
        safety_elements = await self.safety_extractor.extract_safety_elements(
            guideline_content, guideline_id, guideline.get('title', '')
        )
        
        if not safety_elements:
            raise Exception(f"No safety elements extracted from guideline {guideline_id}")
        
        # Step 3: Select a random safety element
        safety_element = random.choice(safety_elements)
        self.logger.info(f"Testing safety element: {safety_element.action}")
        
        # Step 4: Find a relevant transcript
        transcript_text = await self._find_relevant_transcript(safety_element)
        if not transcript_text:
            raise Exception(f"No relevant transcript found for safety element {safety_element.id}")
        
        # Step 5: Create test modification
        modifications = await self.transcript_modifier.create_test_modifications(transcript_text, safety_element)
        if not modifications:
            raise Exception(f"Failed to create test modifications for safety element {safety_element.id}")
        
        modification = random.choice(modifications)
        
        # Step 6: Test the system with the modified transcript
        system_response = await self._test_system_response(modification.modified_text, guideline_id)
        
        # Step 7: Evaluate the results
        test_result = await self._evaluate_test_result(safety_element, modification, system_response)
        
        return test_result
    
    async def _find_relevant_transcript(self, safety_element: SafetyElement) -> Optional[str]:
        """Find a transcript relevant to the safety element's condition"""
        
        # Try to find transcripts that match the safety element's condition
        condition_keywords = safety_element.condition.lower().split()
        
        # Search through all transcripts
        all_transcripts = []
        for category in self.transcripts.values():
            if isinstance(category, dict):
                all_transcripts.extend(category.values())
        
        # Score transcripts by relevance
        scored_transcripts = []
        for transcript in all_transcripts:
            if isinstance(transcript, str):
                transcript_lower = transcript.lower()
                score = sum(1 for keyword in condition_keywords if keyword in transcript_lower)
                if score > 0:
                    scored_transcripts.append((transcript, score))
        
        if scored_transcripts:
            # Return the most relevant transcript
            scored_transcripts.sort(key=lambda x: x[1], reverse=True)
            return scored_transcripts[0][0]
        
        # Fallback: return a random transcript
        if all_transcripts:
            return random.choice(all_transcripts)
        
        return None
    
    async def _test_system_response(self, modified_transcript: str, guideline_id: str) -> Dict:
        """Test the system's response to the modified transcript"""
        
        try:
            # Step 1: Find relevant guidelines (should include our target guideline)
            relevant_guidelines = await self._find_relevant_guidelines(modified_transcript)
            
            # Step 2: Get dynamic advice for the specific guideline
            dynamic_advice = await self._get_dynamic_advice(modified_transcript, guideline_id)
            
            return {
                'relevant_guidelines': relevant_guidelines,
                'dynamic_advice': dynamic_advice,
                'target_guideline_found': any(g.get('id') == guideline_id for g in relevant_guidelines.get('guidelines', [])),
                'suggestions_count': len(dynamic_advice.get('suggestions', [])),
                'suggestions': dynamic_advice.get('suggestions', [])
            }
            
        except Exception as e:
            self.logger.error(f"Error testing system response: {e}")
            return {'error': str(e)}
    
    async def _find_relevant_guidelines(self, transcript: str) -> Dict:
        """Call the system to find relevant guidelines"""
        
        try:
            async with aiohttp.ClientSession() as session:
                headers = {'Content-Type': 'application/json'}
                if self.auth_token:
                    headers['Authorization'] = f'Bearer {self.auth_token}'
                
                # Prepare guidelines list for the API
                guidelines_list = [
                    {
                        'id': guideline_id,
                        'title': guideline.get('title', ''),
                        'summary': guideline.get('summary', ''),
                        'condensed': guideline.get('condensed', ''),
                        'keywords': guideline.get('keywords', [])
                    }
                    for guideline_id, guideline in self.guidelines.items()
                ]
                
                payload = {
                    'transcript': transcript,
                    'guidelines': guidelines_list
                }
                
                async with session.post(f'{self.server_url}/findRelevantGuidelines', 
                                      json=payload, headers=headers) as response:
                    if response.status == 200:
                        return await response.json()
                    else:
                        return {'error': f'API error: {response.status}'}
                        
        except Exception as e:
            return {'error': str(e)}
    
    async def _get_dynamic_advice(self, transcript: str, guideline_id: str) -> Dict:
        """Get dynamic advice for a specific guideline"""
        
        try:
            async with aiohttp.ClientSession() as session:
                headers = {'Content-Type': 'application/json'}
                if self.auth_token:
                    headers['Authorization'] = f'Bearer {self.auth_token}'
                
                payload = {
                    'transcript': transcript,
                    'analysis': 'Test analysis for accuracy testing',
                    'guidelineId': guideline_id,
                    'guidelineTitle': self.guidelines[guideline_id].get('title', '')
                }
                
                async with session.post(f'{self.server_url}/dynamicAdvice', 
                                      json=payload, headers=headers) as response:
                    if response.status == 200:
                        return await response.json()
                    else:
                        return {'error': f'API error: {response.status}'}
                        
        except Exception as e:
            return {'error': str(e)}
    
    async def _evaluate_test_result(self, safety_element: SafetyElement, modification: TranscriptModification, 
                                  system_response: Dict) -> TestResult:
        """Evaluate whether the system correctly identified the compliance issue"""
        
        # Check if there was a system error
        if 'error' in system_response:
            return TestResult(
                test_id=f"test_{int(time.time())}",
                timestamp=datetime.now(),
                guideline_id=safety_element.guideline_id,
                guideline_title=safety_element.guideline_title,
                transcript_id=modification.transcript_id,
                safety_element=safety_element,
                modification=modification,
                system_response=system_response,
                detected_issue=False,
                correct_detection=False,
                accuracy_score=0.0,
                details={'error': 'System error during testing'}
            )
        
        # Analyze the suggestions to see if the issue was detected
        suggestions = system_response.get('suggestions', [])
        detected_issue = False
        correct_detection = False
        accuracy_score = 0.0
        
        # Look for suggestions that address the safety element
        safety_keywords = safety_element.action.lower().split()
        
        for suggestion in suggestions:
            suggestion_text = suggestion.get('suggestedText', '').lower()
            suggestion_context = suggestion.get('context', '').lower()
            
            # Check if suggestion addresses the safety element
            keyword_matches = sum(1 for keyword in safety_keywords 
                                if keyword in suggestion_text or keyword in suggestion_context)
            
            if keyword_matches >= len(safety_keywords) * 0.5:  # At least 50% keyword match
                detected_issue = True
                
                # Evaluate correctness based on modification type
                if modification.modification_type == 'omission':
                    # For omissions, we expect suggestions to add the missing element
                    if suggestion.get('category') == 'addition':
                        correct_detection = True
                        accuracy_score = 0.8 + (keyword_matches / len(safety_keywords)) * 0.2
                        
                elif modification.modification_type in ['non_compliance', 'incorrect_advice']:
                    # For non-compliance/incorrect advice, we expect modifications or corrections
                    if suggestion.get('category') in ['modification', 'addition']:
                        correct_detection = True
                        accuracy_score = 0.8 + (keyword_matches / len(safety_keywords)) * 0.2
                
                break
        
        # Adjust accuracy score based on priority
        if correct_detection and suggestion.get('priority') == 'high':
            accuracy_score = min(1.0, accuracy_score + 0.1)
        
        return TestResult(
            test_id=f"test_{int(time.time())}",
            timestamp=datetime.now(),
            guideline_id=safety_element.guideline_id,
            guideline_title=safety_element.guideline_title,
            transcript_id=modification.transcript_id,
            safety_element=safety_element,
            modification=modification,
            system_response=system_response,
            detected_issue=detected_issue,
            correct_detection=correct_detection,
            accuracy_score=accuracy_score,
            details={
                'target_guideline_found': system_response.get('target_guideline_found', False),
                'suggestions_count': len(suggestions),
                'evaluation_method': 'keyword_matching'
            }
        )
    
    async def run_batch_tests(self, num_tests: int = 10) -> List[TestResult]:
        """Run a batch of accuracy tests"""
        
        results = []
        for i in range(num_tests):
            try:
                self.logger.info(f"Running test {i+1}/{num_tests}")
                result = await self.run_random_test()
                results.append(result)
                
                # Small delay between tests
                await asyncio.sleep(1)
                
            except Exception as e:
                self.logger.error(f"Test {i+1} failed: {e}")
                continue
        
        return results

class AccuracyReporter:
    """Generates accuracy reports and tracks metrics over time"""
    
    def __init__(self, results_dir: str = "test_results"):
        self.results_dir = Path(results_dir)
        self.results_dir.mkdir(exist_ok=True)
        self.logger = logging.getLogger(__name__)
    
    def generate_report(self, test_results: List[TestResult]) -> AccuracyReport:
        """Generate a comprehensive accuracy report"""
        
        if not test_results:
            return AccuracyReport(
                report_id=f"report_{int(time.time())}",
                timestamp=datetime.now(),
                total_tests=0,
                overall_accuracy=0.0,
                accuracy_by_severity={},
                accuracy_by_modification_type={},
                accuracy_by_guideline={},
                failed_tests=[],
                recommendations=["No tests were completed successfully"]
            )
        
        total_tests = len(test_results)
        correct_detections = sum(1 for result in test_results if result.correct_detection)
        overall_accuracy = correct_detections / total_tests if total_tests > 0 else 0.0
        
        # Accuracy by severity
        accuracy_by_severity = {}
        for severity in ['high', 'medium', 'low']:
            severity_results = [r for r in test_results if r.safety_element.severity == severity]
            if severity_results:
                severity_correct = sum(1 for r in severity_results if r.correct_detection)
                accuracy_by_severity[severity] = severity_correct / len(severity_results)
        
        # Accuracy by modification type
        accuracy_by_modification_type = {}
        for mod_type in ['omission', 'non_compliance', 'incorrect_advice']:
            mod_results = [r for r in test_results if r.modification.modification_type == mod_type]
            if mod_results:
                mod_correct = sum(1 for r in mod_results if r.correct_detection)
                accuracy_by_modification_type[mod_type] = mod_correct / len(mod_results)
        
        # Accuracy by guideline
        accuracy_by_guideline = {}
        guideline_groups = {}
        for result in test_results:
            guideline_id = result.guideline_id
            if guideline_id not in guideline_groups:
                guideline_groups[guideline_id] = []
            guideline_groups[guideline_id].append(result)
        
        for guideline_id, results in guideline_groups.items():
            correct = sum(1 for r in results if r.correct_detection)
            accuracy_by_guideline[guideline_id] = correct / len(results)
        
        # Failed tests
        failed_tests = [r for r in test_results if not r.correct_detection]
        
        # Generate recommendations
        recommendations = self._generate_recommendations(test_results, overall_accuracy, accuracy_by_severity)
        
        return AccuracyReport(
            report_id=f"report_{int(time.time())}",
            timestamp=datetime.now(),
            total_tests=total_tests,
            overall_accuracy=overall_accuracy,
            accuracy_by_severity=accuracy_by_severity,
            accuracy_by_modification_type=accuracy_by_modification_type,
            accuracy_by_guideline=accuracy_by_guideline,
            failed_tests=failed_tests,
            recommendations=recommendations
        )
    
    def _generate_recommendations(self, test_results: List[TestResult], overall_accuracy: float, 
                                accuracy_by_severity: Dict[str, float]) -> List[str]:
        """Generate actionable recommendations based on test results"""
        
        recommendations = []
        
        if overall_accuracy < 0.7:
            recommendations.append("CRITICAL: Overall accuracy is below 70%. Immediate review of guideline compliance system required.")
        elif overall_accuracy < 0.85:
            recommendations.append("Overall accuracy is below 85%. Consider improving guideline analysis algorithms.")
        
        # Check high-severity performance
        if 'high' in accuracy_by_severity and accuracy_by_severity['high'] < 0.9:
            recommendations.append("HIGH PRIORITY: Accuracy for high-severity safety elements is below 90%. Focus on improving detection of critical safety issues.")
        
        # Check for patterns in failed tests
        failed_tests = [r for r in test_results if not r.correct_detection]
        if failed_tests:
            # Analyze common failure patterns
            omission_failures = [r for r in failed_tests if r.modification.modification_type == 'omission']
            if len(omission_failures) > len(failed_tests) * 0.5:
                recommendations.append("System struggles with detecting omitted safety elements. Consider improving missing element detection algorithms.")
            
            # Check for specific guidelines with poor performance
            guideline_failures = {}
            for result in failed_tests:
                guideline_id = result.guideline_id
                guideline_failures[guideline_id] = guideline_failures.get(guideline_id, 0) + 1
            
            worst_guideline = max(guideline_failures.items(), key=lambda x: x[1], default=None)
            if worst_guideline and worst_guideline[1] >= 3:
                recommendations.append(f"Guideline {worst_guideline[0]} shows poor performance ({worst_guideline[1]} failures). Review guideline content processing.")
        
        if not recommendations:
            recommendations.append("System performance is satisfactory. Continue regular accuracy monitoring.")
        
        return recommendations
    
    def save_report(self, report: AccuracyReport):
        """Save the accuracy report to disk"""
        
        report_file = self.results_dir / f"accuracy_report_{report.report_id}.json"
        
        # Convert dataclasses to dict for JSON serialization
        report_dict = asdict(report)
        
        # Handle datetime serialization
        report_dict['timestamp'] = report.timestamp.isoformat()
        for i, test_result in enumerate(report_dict['failed_tests']):
            test_result['timestamp'] = report.failed_tests[i].timestamp.isoformat()
            test_result['safety_element'] = asdict(report.failed_tests[i].safety_element)
            test_result['modification'] = asdict(report.failed_tests[i].modification)
        
        with open(report_file, 'w') as f:
            json.dump(report_dict, f, indent=2)
        
        self.logger.info(f"Accuracy report saved to {report_file}")
    
    def print_summary(self, report: AccuracyReport):
        """Print a summary of the accuracy report"""
        
        print(f"\n{'='*60}")
        print(f"ACCURACY TESTING REPORT - {report.timestamp.strftime('%Y-%m-%d %H:%M:%S')}")
        print(f"{'='*60}")
        print(f"Total Tests: {report.total_tests}")
        print(f"Overall Accuracy: {report.overall_accuracy:.1%}")
        print()
        
        print("Accuracy by Severity:")
        for severity, accuracy in report.accuracy_by_severity.items():
            print(f"  {severity.upper()}: {accuracy:.1%}")
        print()
        
        print("Accuracy by Modification Type:")
        for mod_type, accuracy in report.accuracy_by_modification_type.items():
            print(f"  {mod_type.replace('_', ' ').title()}: {accuracy:.1%}")
        print()
        
        if report.failed_tests:
            print(f"Failed Tests: {len(report.failed_tests)}")
            for i, failed_test in enumerate(report.failed_tests[:3]):  # Show first 3 failures
                print(f"  {i+1}. {failed_test.guideline_title} - {failed_test.modification.modification_type}")
            if len(report.failed_tests) > 3:
                print(f"  ... and {len(report.failed_tests) - 3} more")
            print()
        
        print("Recommendations:")
        for i, recommendation in enumerate(report.recommendations, 1):
            print(f"  {i}. {recommendation}")
        print(f"{'='*60}\n")

async def main():
    """Main function to run the accuracy testing agent"""
    
    parser = argparse.ArgumentParser(description='Clinical Guidelines Accuracy Testing Agent')
    parser.add_argument('--server-url', default='http://localhost:3000', 
                       help='Server URL for the clinical guidelines system')
    parser.add_argument('--auth-token', help='Authentication token for API access')
    parser.add_argument('--num-tests', type=int, default=10, 
                       help='Number of tests to run')
    parser.add_argument('--log-level', default='INFO', 
                       choices=['DEBUG', 'INFO', 'WARNING', 'ERROR'],
                       help='Logging level')
    parser.add_argument('--results-dir', default='test_results',
                       help='Directory to save test results')
    
    args = parser.parse_args()
    
    # Configure logging
    logging.basicConfig(
        level=getattr(logging, args.log_level),
        format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
        handlers=[
            logging.FileHandler('accuracy_testing.log'),
            logging.StreamHandler()
        ]
    )
    
    logger = logging.getLogger(__name__)
    logger.info(f"Starting accuracy testing agent with {args.num_tests} tests")
    
    try:
        # Initialize the test runner
        test_runner = AccuracyTestRunner(args.server_url, args.auth_token)
        await test_runner.initialize()
        
        # Run the tests
        test_results = await test_runner.run_batch_tests(args.num_tests)
        
        # Generate and save report
        reporter = AccuracyReporter(args.results_dir)
        report = reporter.generate_report(test_results)
        reporter.save_report(report)
        reporter.print_summary(report)
        
        logger.info("Accuracy testing completed successfully")
        
    except Exception as e:
        logger.error(f"Accuracy testing failed: {e}")
        raise

if __name__ == "__main__":
    asyncio.run(main()) 