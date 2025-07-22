#!/usr/bin/env python3
"""
Autonomous AI Testing Agent for Clinical Guidelines System

This agent is given high-level objectives and tools, then figures out how to test
the system autonomously rather than following pre-programmed test scenarios.

The agent has access to:
1. Firestore guidelines database
2. Server API endpoints  
3. File system for results
4. Its own reasoning to design tests

Author: AI Assistant
Created: January 2025
"""

import asyncio
import json
import logging
from datetime import datetime
from pathlib import Path
import aiohttp
import firebase_admin
from firebase_admin import credentials, firestore
import argparse
import sys

class AutonomousTestingAgent:
    """An AI agent that autonomously designs and executes accuracy tests"""
    
    def __init__(self, server_url: str, firebase_credentials_path: str = None, auth_token: str = None):
        self.server_url = server_url
        self.auth_token = auth_token
        self.logger = logging.getLogger(__name__)
        
        # Initialize Firebase
        if firebase_credentials_path:
            cred = credentials.Certificate(firebase_credentials_path)
            firebase_admin.initialize_app(cred)
        else:
            # Use default credentials or application default credentials
            firebase_admin.initialize_app()
        
        self.db = firestore.client()
        self.results_dir = Path("autonomous_test_results")
        self.results_dir.mkdir(exist_ok=True)
        
    async def run_autonomous_testing_session(self, objectives: list = None) -> dict:
        """Run an autonomous testing session with high-level objectives"""
        
        if not objectives:
            objectives = [
                "Test the accuracy of clinical guidelines safety recommendations",
                "Identify if the system detects omitted critical safety steps", 
                "Verify the system flags non-compliant clinical advice",
                "Evaluate performance across different severity levels",
                "Generate actionable insights for system improvement"
            ]
        
        session_id = f"autonomous_session_{int(datetime.now().timestamp())}"
        self.logger.info(f"Starting autonomous testing session: {session_id}")
        
        # Let the AI agent plan and execute the testing
        planning_result = await self._autonomous_planning_phase(objectives)
        execution_result = await self._autonomous_execution_phase(planning_result)
        analysis_result = await self._autonomous_analysis_phase(execution_result)
        
        # Save comprehensive results
        session_results = {
            "session_id": session_id,
            "timestamp": datetime.now().isoformat(),
            "objectives": objectives,
            "planning": planning_result,
            "execution": execution_result,
            "analysis": analysis_result
        }
        
        results_file = self.results_dir / f"{session_id}_results.json"
        with open(results_file, 'w') as f:
            json.dump(session_results, f, indent=2)
        
        # Generate human-readable report
        await self._generate_autonomous_report(session_results)
        
        return session_results
    
    async def _autonomous_planning_phase(self, objectives: list) -> dict:
        """Let the AI agent plan the testing approach"""
        
        # Get available guidelines
        guidelines = await self._get_available_guidelines()
        
        # Get available transcripts
        transcripts = await self._get_available_transcripts()
        
        planning_prompt = f"""You are an autonomous AI testing agent for a clinical guidelines system. Your job is to plan a comprehensive testing strategy.

TESTING OBJECTIVES:
{chr(10).join(f"- {obj}" for obj in objectives)}

AVAILABLE RESOURCES:
- {len(guidelines)} clinical guidelines in database
- {len(transcripts)} test transcripts available
- Server API endpoints for testing system responses
- Ability to modify transcripts and analyze results

PLANNING TASK:
Design a testing strategy that will effectively evaluate whether the clinical guidelines system meets the objectives. Consider:

1. Which guidelines to focus on (high-risk areas, common conditions, critical safety elements)
2. What types of test modifications to make (omissions, non-compliance, incorrect advice)
3. How to evaluate system responses (what constitutes success/failure)
4. What metrics to track for meaningful insights

Return your plan as a JSON object with this structure:
{{
  "strategy_overview": "High-level description of testing approach",
  "selected_guidelines": [
    {{
      "guideline_id": "id",
      "guideline_title": "title", 
      "rationale": "Why this guideline is important to test",
      "focus_areas": ["specific safety elements to test"]
    }}
  ],
  "test_scenarios": [
    {{
      "scenario_name": "descriptive name",
      "modification_type": "omission|non_compliance|incorrect_advice",
      "target_safety_element": "what safety element to test",
      "expected_system_response": "what the system should do",
      "success_criteria": "how to measure if test passed"
    }}
  ],
  "evaluation_criteria": {{
    "accuracy_thresholds": "what accuracy levels are acceptable",
    "critical_areas": "which test failures are most concerning",
    "success_metrics": "how to measure overall testing success"
  }}
}}

GUIDELINES SAMPLE (first 3):
{json.dumps(guidelines[:3], indent=2)}

TRANSCRIPTS SAMPLE:
{json.dumps(list(transcripts.keys())[:5], indent=2)}

Design a testing plan that is thorough but practical, focusing on the most important safety aspects."""

        planning_result = await self._call_ai_for_reasoning(planning_prompt)
        
        try:
            return json.loads(planning_result)
        except json.JSONDecodeError:
            self.logger.error("Failed to parse planning result as JSON")
            return {"error": "Planning phase failed", "raw_response": planning_result}
    
    async def _autonomous_execution_phase(self, planning_result: dict) -> dict:
        """Let the AI agent execute the planned tests autonomously"""
        
        if "error" in planning_result:
            return {"error": "Cannot execute - planning phase failed"}
        
        execution_results = []
        
        for scenario in planning_result.get("test_scenarios", []):
            self.logger.info(f"Executing test scenario: {scenario.get('scenario_name')}")
            
            try:
                # Let the AI agent create and execute this specific test
                test_result = await self._execute_autonomous_test_scenario(scenario, planning_result)
                execution_results.append(test_result)
                
                # Small delay between tests
                await asyncio.sleep(2)
                
            except Exception as e:
                self.logger.error(f"Test scenario failed: {e}")
                execution_results.append({
                    "scenario_name": scenario.get('scenario_name'),
                    "status": "failed",
                    "error": str(e)
                })
        
        return {
            "total_scenarios": len(planning_result.get("test_scenarios", [])),
            "completed_scenarios": len([r for r in execution_results if r.get("status") != "failed"]),
            "results": execution_results
        }
    
    async def _execute_autonomous_test_scenario(self, scenario: dict, planning_context: dict) -> dict:
        """Execute a single test scenario autonomously"""
        
        # Get relevant guideline and transcript
        target_guideline = None
        for guideline in planning_context.get("selected_guidelines", []):
            if any(focus in scenario.get("target_safety_element", "") for focus in guideline.get("focus_areas", [])):
                target_guideline = guideline
                break
        
        if not target_guideline:
            # Pick the first available guideline
            target_guideline = planning_context.get("selected_guidelines", [{}])[0]
        
        # Let AI create the test modification
        modification_prompt = f"""You are an autonomous testing agent executing a specific test scenario.

SCENARIO TO EXECUTE:
{json.dumps(scenario, indent=2)}

TARGET GUIDELINE:
{json.dumps(target_guideline, indent=2)}

TASK: Create a realistic clinical transcript modification that tests this scenario.

You need to:
1. Choose an appropriate base transcript for this clinical area
2. Modify it according to the scenario requirements 
3. Ensure the modification is realistic but tests the safety element

Return a JSON object with:
{{
  "base_transcript_chosen": "which transcript type/condition",
  "original_transcript": "the original clinical transcript text",
  "modified_transcript": "the modified transcript with the test issue",
  "modification_description": "what you changed and why",
  "expected_detection": "what the system should identify as problematic"
}}

Make the modification subtle but clear - it should represent a real clinical scenario where guidelines might be missed."""

        modification_result = await self._call_ai_for_reasoning(modification_prompt)
        
        try:
            modification_data = json.loads(modification_result)
        except json.JSONDecodeError:
            return {"status": "failed", "error": "Failed to create test modification"}
        
        # Test the system with the modified transcript
        system_response = await self._test_system_response(
            modification_data.get("modified_transcript"),
            target_guideline.get("guideline_id")
        )
        
        # Let AI evaluate the results
        evaluation_prompt = f"""You are evaluating the results of an autonomous test scenario.

ORIGINAL SCENARIO:
{json.dumps(scenario, indent=2)}

MODIFICATION MADE:
{json.dumps(modification_data, indent=2)}

SYSTEM RESPONSE:
{json.dumps(system_response, indent=2)}

EVALUATION TASK:
Determine if the system correctly identified and addressed the compliance issue.

Consider:
- Did the system detect the problem?
- Was the recommendation appropriate?
- How well did it align with the expected response?

Return a JSON evaluation:
{{
  "test_passed": true/false,
  "accuracy_score": 0.0-1.0,
  "detection_quality": "description of what the system detected",
  "recommendation_quality": "assessment of system recommendations", 
  "areas_for_improvement": ["specific suggestions"],
  "overall_assessment": "summary of test outcome"
}}"""

        evaluation_result = await self._call_ai_for_reasoning(evaluation_prompt)
        
        try:
            evaluation_data = json.loads(evaluation_result)
        except json.JSONDecodeError:
            evaluation_data = {"test_passed": False, "error": "Evaluation failed"}
        
        return {
            "scenario_name": scenario.get("scenario_name"),
            "status": "completed",
            "modification": modification_data,
            "system_response": system_response,
            "evaluation": evaluation_data,
            "timestamp": datetime.now().isoformat()
        }
    
    async def _autonomous_analysis_phase(self, execution_result: dict) -> dict:
        """Let the AI agent analyze all results and generate insights"""
        
        analysis_prompt = f"""You are analyzing the complete results of an autonomous testing session.

EXECUTION RESULTS:
{json.dumps(execution_result, indent=2)}

ANALYSIS TASK:
Provide a comprehensive analysis of the testing session results. Consider:

1. Overall system performance and accuracy
2. Patterns in successes and failures  
3. Areas where the system excels
4. Critical areas needing improvement
5. Specific recommendations for enhancement
6. Risk assessment for patient safety

Return a JSON analysis:
{{
  "overall_performance": {{
    "accuracy_percentage": 0-100,
    "performance_rating": "excellent|good|acceptable|poor",
    "confidence_level": "high|medium|low"
  }},
  "key_findings": [
    "bullet points of main discoveries"
  ],
  "success_patterns": [
    "what the system does well"
  ],
  "failure_patterns": [
    "common areas where system struggles"
  ],
  "risk_assessment": {{
    "high_risk_areas": ["areas with safety implications"],
    "medium_risk_areas": ["areas needing attention"],
    "low_risk_areas": ["minor improvement areas"]
  }},
  "recommendations": [
    {{
      "priority": "high|medium|low",
      "recommendation": "specific action to take",
      "rationale": "why this is important",
      "expected_impact": "what improvement this would bring"
    }}
  ],
  "next_steps": [
    "suggested follow-up actions"
  ]
}}"""

        analysis_result = await self._call_ai_for_reasoning(analysis_prompt)
        
        try:
            return json.loads(analysis_result)
        except json.JSONDecodeError:
            return {"error": "Analysis phase failed", "raw_response": analysis_result}
    
    async def _get_available_guidelines(self) -> list:
        """Get available guidelines from Firestore"""
        try:
            guidelines_ref = self.db.collection('guidelines')
            docs = guidelines_ref.limit(50).stream()  # Limit for manageable analysis
            
            guidelines = []
            for doc in docs:
                data = doc.data()
                guidelines.append({
                    "id": doc.id,
                    "title": data.get("title", ""),
                    "summary": data.get("summary", ""),
                    "organisation": data.get("organisation", ""),
                    "content_length": len(data.get("content", "")),
                    "has_content": bool(data.get("content"))
                })
            
            return guidelines
        except Exception as e:
            self.logger.error(f"Error loading guidelines: {e}")
            return []
    
    async def _get_available_transcripts(self) -> dict:
        """Get available test transcripts"""
        try:
            # Try to load from fake_transcripts.json
            transcripts_file = Path("fake_transcripts.json")
            if transcripts_file.exists():
                with open(transcripts_file, 'r') as f:
                    return json.load(f)
            return {}
        except Exception as e:
            self.logger.error(f"Error loading transcripts: {e}")
            return {}
    
    async def _call_ai_for_reasoning(self, prompt: str) -> str:
        """Call the AI service for autonomous reasoning"""
        try:
            async with aiohttp.ClientSession() as session:
                headers = {'Content-Type': 'application/json'}
                if self.auth_token:
                    headers['Authorization'] = f'Bearer {self.auth_token}'
                
                # Use the server's AI routing
                payload = {
                    'messages': [
                        {
                            'role': 'system', 
                            'content': 'You are an expert autonomous testing agent for clinical systems. Provide detailed, structured responses that help achieve testing objectives.'
                        },
                        {'role': 'user', 'content': prompt}
                    ]
                }
                
                async with session.post(f'{self.server_url}/routeToAI', 
                                      json=payload, headers=headers) as response:
                    if response.status == 200:
                        result = await response.json()
                        return result.get('content', '')
                    else:
                        raise Exception(f"AI service error: {response.status}")
                        
        except Exception as e:
            self.logger.error(f"Error calling AI service: {e}")
            return f"Error: {str(e)}"
    
    async def _test_system_response(self, transcript: str, guideline_id: str) -> dict:
        """Test the system's response to a transcript"""
        try:
            # Call the dynamic advice endpoint
            async with aiohttp.ClientSession() as session:
                headers = {'Content-Type': 'application/json'}
                if self.auth_token:
                    headers['Authorization'] = f'Bearer {self.auth_token}'
                
                payload = {
                    'transcript': transcript,
                    'analysis': 'Autonomous testing analysis',
                    'guidelineId': guideline_id,
                    'guidelineTitle': 'Test Guideline'
                }
                
                async with session.post(f'{self.server_url}/dynamicAdvice', 
                                      json=payload, headers=headers) as response:
                    if response.status == 200:
                        return await response.json()
                    else:
                        return {'error': f'API error: {response.status}'}
                        
        except Exception as e:
            return {'error': str(e)}
    
    async def _generate_autonomous_report(self, session_results: dict):
        """Generate a human-readable report from the autonomous testing session"""
        
        report_prompt = f"""Generate a comprehensive, human-readable report from this autonomous testing session.

SESSION RESULTS:
{json.dumps(session_results, indent=2)}

Create a professional report that includes:
1. Executive Summary
2. Testing Methodology Used
3. Key Findings
4. Performance Metrics
5. Risk Assessment
6. Recommendations
7. Next Steps

Make it suitable for clinical administrators and technical teams."""

        report_content = await self._call_ai_for_reasoning(report_prompt)
        
        report_file = self.results_dir / f"{session_results['session_id']}_report.md"
        with open(report_file, 'w') as f:
            f.write(f"# Autonomous Testing Report\n")
            f.write(f"**Session ID:** {session_results['session_id']}\n")
            f.write(f"**Generated:** {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n\n")
            f.write(report_content)
        
        self.logger.info(f"Report generated: {report_file}")
        print(f"\n📊 Autonomous testing report generated: {report_file}")

async def main():
    """Main function to run the autonomous testing agent"""
    
    parser = argparse.ArgumentParser(description='Autonomous AI Testing Agent for Clinical Guidelines')
    parser.add_argument('--server-url', default='http://localhost:3000', 
                       help='Server URL for the clinical guidelines system')
    parser.add_argument('--auth-token', help='Authentication token for API access')
    parser.add_argument('--firebase-credentials', help='Path to Firebase credentials JSON file')
    parser.add_argument('--objectives', nargs='+', 
                       help='Custom testing objectives (space-separated)')
    parser.add_argument('--log-level', default='INFO', 
                       choices=['DEBUG', 'INFO', 'WARNING', 'ERROR'],
                       help='Logging level')
    
    args = parser.parse_args()
    
    # Configure logging
    logging.basicConfig(
        level=getattr(logging, args.log_level),
        format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
        handlers=[
            logging.FileHandler('autonomous_testing.log'),
            logging.StreamHandler()
        ]
    )
    
    logger = logging.getLogger(__name__)
    logger.info("Starting autonomous testing agent")
    
    try:
        # Initialize the agent
        agent = AutonomousTestingAgent(
            args.server_url, 
            args.firebase_credentials, 
            args.auth_token
        )
        
        # Run autonomous testing session
        results = await agent.run_autonomous_testing_session(args.objectives)
        
        print("\n🤖 Autonomous Testing Complete!")
        print(f"📁 Results saved to: autonomous_test_results/")
        print(f"📊 Session ID: {results.get('session_id')}")
        
        # Print quick summary
        if 'analysis' in results and isinstance(results['analysis'], dict):
            analysis = results['analysis']
            if 'overall_performance' in analysis:
                perf = analysis['overall_performance']
                print(f"🎯 Performance: {perf.get('performance_rating', 'unknown').title()}")
                if 'accuracy_percentage' in perf:
                    print(f"📈 Accuracy: {perf['accuracy_percentage']}%")
        
        logger.info("Autonomous testing completed successfully")
        
    except Exception as e:
        logger.error(f"Autonomous testing failed: {e}")
        raise

if __name__ == "__main__":
    asyncio.run(main()) 