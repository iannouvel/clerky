import { auth } from '../../firebase-init.js';
import { postAuthenticated } from '../api/client.js';
import { API_ENDPOINTS } from '../api/config.js';
import { getUserInputContent, setUserInputContent, appendToOutputField } from '../utils/editor.js';
import { ensureAnonymisedForOutbound } from './pii.js';
import { updateUser } from '../ui/status.js';
import { initializeSuggestionWizard } from './suggestionWizard.js';

// ---- Analysis Functions ----

export async function checkAgainstGuidelines(suppressHeader = false) {
    const checkGuidelinesBtn = document.getElementById('checkGuidelinesBtn');
    const originalText = checkGuidelinesBtn.textContent;

    try {
        console.log('[DEBUG] Starting checkAgainstGuidelines...');

        const transcript = getUserInputContent();
        if (!transcript) {
            console.log('[DEBUG] No transcript found in userInput');
            alert('Please enter some text first');
            return;
        }
        console.log('[DEBUG] Transcript length:', transcript.length);

        if (!window.relevantGuidelines || window.relevantGuidelines.length === 0) {
            console.log('[DEBUG] No relevant guidelines found in window.relevantGuidelines');
            console.log('[DEBUG] window.relevantGuidelines:', window.relevantGuidelines);
            alert('Please find relevant guidelines first');
            return;
        }
        console.log('[DEBUG] Number of relevant guidelines:', window.relevantGuidelines.length);

        // Set loading state
        checkGuidelinesBtn.classList.add('loading');
        checkGuidelinesBtn.disabled = true;

        // Get user ID token
        const user = auth.currentUser;
        if (!user) {
            console.log('[DEBUG] No authenticated user found');
            alert('Please sign in to use this feature');
            return;
        }
        console.log('[DEBUG] User authenticated:', { email: user.email, uid: user.uid });

        const idToken = await user.getIdToken();
        console.log('[DEBUG] Got ID token');

        // Anonymise silently before outbound calls — no user interaction
        const { anonymisedText: _anonText } = await ensureAnonymisedForOutbound(transcript);
        let anonymisedTranscript = _anonText || transcript;

        // Check if guidelines are loaded in cache
        console.log('[DEBUG] Checking guideline cache status:', {
            hasGlobalGuidelines: !!window.globalGuidelines,
            cacheSize: window.globalGuidelines ? Object.keys(window.globalGuidelines).length : 0,
            cacheKeys: window.globalGuidelines ? Object.keys(window.globalGuidelines) : []
        });

        // Reload guidelines from Firestore to ensure we have the latest data
        try {
            console.log('[DEBUG] Reloading guidelines from Firestore...');
            const guidelines = await window.loadGuidelinesFromFirestore();
            console.log('[DEBUG] Reloaded guidelines from Firestore:', {
                success: !!guidelines,
                count: guidelines?.length || 0
            });
        } catch (error) {
            console.error('[DEBUG] Failed to reload guidelines:', error);
            throw new Error('Failed to load guidelines from Firestore');
        }

        // Initialize the analysis summary (unless called from process workflow)
        let formattedAnalysis = '';
        if (!suppressHeader) {
            formattedAnalysis = '## Analysis Against Guidelines\n\n';
            appendToOutputField(formattedAnalysis, true);
        }

        let successCount = 0;
        let errorCount = 0;

        // Helper function to find guideline by multiple matching criteria
        function findGuidelineInCache(targetGuideline) {
            // Method 1: Direct key lookup (original method)
            let found = window.globalGuidelines[targetGuideline.id];
            if (found) {
                console.log(`[DEBUG] Found guideline by direct ID: ${targetGuideline.id}`);
                return found;
            }

            // Method 2: Search by filename match
            const guidelines = Object.values(window.globalGuidelines);
            found = guidelines.find(g =>
                g.filename === targetGuideline.id ||
                (g.title && g.title === targetGuideline.id)
            );
            if (found) {
                console.log(`[DEBUG] Found guideline by filename match: ${targetGuideline.id} -> ${found.id}`);
                return found;
            }

            // Method 3: Search by title similarity
            const targetTitle = targetGuideline.humanFriendlyTitle || targetGuideline.title || targetGuideline.id;
            if (targetTitle && targetTitle.length > 5) {
                found = guidelines.find(g => {
                    if (!g.title) return false;

                    // Normalize titles for comparison
                    const normalizeTitle = (title) => title.toLowerCase()
                        .replace(/[^a-z0-9\s]/g, ' ')
                        .replace(/\s+/g, ' ')
                        .trim();

                    const normalizedTarget = normalizeTitle(targetTitle);
                    const normalizedGuideline = normalizeTitle(g.title);

                    // Check for exact match first
                    if (normalizedTarget === normalizedGuideline) return true;

                    // Check for substantial overlap (80% match)
                    const targetWords = normalizedTarget.split(' ').filter(w => w.length > 2);
                    const guidelineWords = normalizedGuideline.split(' ').filter(w => w.length > 2);

                    if (targetWords.length === 0 || guidelineWords.length === 0) return false;

                    const matchedWords = targetWords.filter(word =>
                        guidelineWords.some(gWord => gWord.includes(word) || word.includes(gWord))
                    );

                    const similarity = matchedWords.length / Math.max(targetWords.length, guidelineWords.length);
                    return similarity >= 0.6; // 60% word overlap threshold
                });

                if (found) {
                    console.log(`[DEBUG] Found guideline by title similarity: "${targetTitle}" -> "${found.title}" (${found.id})`);
                    return found;
                }
            }

            // Method 4: Search by partial filename match (for cases like "ESHRE - PCOS - 2023.pdf" vs "ESHRE - PCOS - 2023")
            found = guidelines.find(g => {
                if (!g.filename || !targetGuideline.id) return false;

                const normalizeFilename = (filename) => filename.toLowerCase()
                    .replace('.pdf', '')
                    .replace(/[^a-z0-9\s]/g, ' ')
                    .replace(/\s+/g, ' ')
                    .trim();

                const normalizedTarget = normalizeFilename(targetGuideline.id);
                const normalizedFilename = normalizeFilename(g.filename);

                return normalizedTarget.includes(normalizedFilename) ||
                    normalizedFilename.includes(normalizedTarget);
            });

            if (found) {
                console.log(`[DEBUG] Found guideline by partial filename match: ${targetGuideline.id} -> ${found.filename} (${found.id})`);
                return found;
            }

            return null;
        }

        // Get most relevant guidelines (filter by category)
        const mostRelevantGuidelines = window.relevantGuidelines.filter(g => g.category === 'mostRelevant');

        console.log('[DEBUG] Found most relevant guidelines:', {
            total: mostRelevantGuidelines.length,
            guidelines: mostRelevantGuidelines.map(g => ({ id: g.id, title: g.title, relevance: g.relevance }))
        });

        // Determine which guidelines to process
        let guidelinesToProcess = [];
        const MAX_AUTO_PROCESS = 5;

        if (mostRelevantGuidelines.length === 0) {
            throw new Error('No "most relevant" guidelines found. Please ensure guidelines have been properly categorized.');
        } else if (mostRelevantGuidelines.length <= MAX_AUTO_PROCESS) {
            // Auto-process all if 5 or fewer
            guidelinesToProcess = mostRelevantGuidelines;
            console.log(`[DEBUG] Auto-processing all ${guidelinesToProcess.length} most relevant guidelines`);
        } else {
            // Show selection interface if more than 5
            console.log(`[DEBUG] Found ${mostRelevantGuidelines.length} most relevant guidelines, showing selection interface`);

            const selectionMessage = `
                <div class="guideline-auto-selection">
                    <h4>📋 Multiple Relevant Guidelines Found</h4>
                    <p>Found <strong>${mostRelevantGuidelines.length}</strong> highly relevant guidelines. To ensure timely processing, we'll analyze the <strong>top ${MAX_AUTO_PROCESS}</strong> by default.</p>
                    <div class="auto-selected-guidelines">
                        <p><strong>Selected for analysis:</strong></p>
                        <ul>
                            ${mostRelevantGuidelines.slice(0, MAX_AUTO_PROCESS).map(g => {
                const guidelineData = window.globalGuidelines[g.id];
                const displayTitle = guidelineData?.humanFriendlyTitle || guidelineData?.title || g.title || g.id;
                return `<li>${displayTitle} <span class="relevance">(relevance: ${g.relevance || 'N/A'})</span></li>`;
            }).join('')}
                        </ul>
                    </div>
                    <p><em>💡 After this analysis, you can use "Make Advice Dynamic" to select different guidelines or include additional ones.</em></p>
                </div>
                
                <style>
                .guideline-auto-selection {
                    background: #e8f4fd;
                    border: 1px solid #2196f3;
                    border-radius: 6px;
                    padding: 15px;
                    margin: 10px 0;
                }
                .guideline-auto-selection h4 {
                    margin: 0 0 10px 0;
                    color: #1976d2;
                }
                .auto-selected-guidelines {
                    background: white;
                    border-radius: 4px;
                    padding: 10px;
                    margin: 10px 0;
                }
                .auto-selected-guidelines ul {
                    margin: 5px 0 0 0;
                    padding-left: 20px;
                }
                .auto-selected-guidelines li {
                    margin-bottom: 5px;
                    color: #1976d2;
                }
                .relevance {
                    color: #666;
                    font-size: 0.9em;
                }
                </style>
            `;

            appendToOutputField(selectionMessage, true);

            // Use top 5 guidelines
            guidelinesToProcess = mostRelevantGuidelines.slice(0, MAX_AUTO_PROCESS);
        }

        // Update UI to show guidelines being processed (status bar only)
        const processingStatus = `Analysing against ${guidelinesToProcess.length} most relevant guideline${guidelinesToProcess.length > 1 ? 's' : ''}...`;
        updateUser(processingStatus, true);

        // Process guidelines in parallel for better performance
        const guidelinePromises = guidelinesToProcess.map(async (relevantGuideline, index) => {
            const guidelineData = findGuidelineInCache(relevantGuideline);
            const guidelineTitle = guidelineData?.humanFriendlyTitle || guidelineData?.title || relevantGuideline.filename || relevantGuideline.title;

            console.log(`[DEBUG] Processing guideline ${index + 1}/${guidelinesToProcess.length}: ${guidelineTitle}`);

            try {
                if (!guidelineData) {
                    console.error('[DEBUG] Guideline not found in cache:', {
                        title: guidelineTitle,
                        availableGuidelines: Object.keys(window.globalGuidelines)
                    });

                    return {
                        guideline: guidelineTitle,
                        error: 'Guideline not found in cache. Please try finding relevant guidelines again.',
                        analysis: null,
                        success: false
                    };
                }

                // Send to server for analysis
                const response = await fetch(`${window.SERVER_URL}/analyzeNoteAgainstGuideline`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${idToken}`
                    },
                    body: JSON.stringify({
                        transcript: anonymisedTranscript,
                        guideline: guidelineData.id
                    })
                });

                console.log(`[DEBUG] Server response for ${guidelineTitle}:`, {
                    status: response.status,
                    ok: response.ok,
                    statusText: response.statusText
                });

                if (!response.ok) {
                    const errorText = await response.text();
                    console.error('[DEBUG] Server error response:', {
                        status: response.status,
                        statusText: response.statusText,
                        errorText,
                        guideline: guidelineTitle
                    });

                    // Try to parse the error message
                    let errorMessage = 'Server error';
                    try {
                        const errorJson = JSON.parse(errorText);
                        errorMessage = errorJson.error || errorMessage;
                    } catch (e) {
                        errorMessage = errorText || errorMessage;
                    }

                    return {
                        guideline: guidelineTitle,
                        error: errorMessage,
                        analysis: null,
                        success: false
                    };
                }

                const result = await response.json();
                if (!result.success) {
                    return {
                        guideline: guidelineTitle,
                        error: result.error || 'Analysis failed',
                        analysis: null,
                        success: false
                    };
                }

                return {
                    guideline: guidelineTitle,
                    analysis: result.analysis,
                    success: true
                };

            } catch (error) {
                console.error(`[DEBUG] Error processing guideline ${guidelineTitle}:`, error);
                return {
                    guideline: guidelineTitle,
                    error: error.message,
                    analysis: null,
                    success: false
                };
            }
        });

        // Wait for all guidelines to be processed
        console.log('[DEBUG] Waiting for all guideline processing to complete...');
        const results = await Promise.all(guidelinePromises);

        // Process results
        results.forEach(result => {
            if (result.success) {
                const analysisSection = `### ${result.guideline}\n\n${result.analysis}\n\n`;
                formattedAnalysis += analysisSection;
                successCount++;
                appendToOutputField(analysisSection, true);
            } else {
                const errorSection = `### ${result.guideline}\n\n⚠️ Error: ${result.error}\n\n`;
                formattedAnalysis += errorSection;
                errorCount++;
                appendToOutputField(errorSection, true); // Append, don't clear
            }
        });

        // Add summary of results
        console.log('[DEBUG] Analysis summary:', {
            successCount,
            errorCount,
            guidelinesProcessed: guidelinesToProcess.length,
            totalRelevantGuidelines: window.relevantGuidelines.length,
            analyzedMultiple: guidelinesToProcess.length > 1
        });

        const summarySection = `\n## Summary\n\nAnalyzed against ${guidelinesToProcess.length} most relevant guideline${guidelinesToProcess.length > 1 ? 's' : ''}${successCount > 0 ? ' successfully' : ''}.\n`;
        const failureSection = errorCount > 0 ? `${errorCount} analysis failed.\n` : '';
        const additionalInfo = `\n*Note: Found ${window.relevantGuidelines.length} relevant guidelines total, analyzed against the top ${guidelinesToProcess.length} most relevant.*\n`;
        const finalSummary = summarySection + failureSection + additionalInfo;

        formattedAnalysis += finalSummary;
        appendToOutputField(finalSummary, true); // Append, don't clear

        // Store the latest analysis result and guideline data for guideline suggestions
        if (successCount > 0) {
            console.log('[DEBUG] Storing analysis result for guideline suggestions');

            // Store the combined analysis and the guidelines that were processed
            const processedGuidelineData = guidelinesToProcess.map(g => {
                const guidelineData = window.globalGuidelines[g.id];
                return {
                    id: g.id,
                    title: guidelineData?.humanFriendlyTitle || guidelineData?.title || g.title || g.id,
                    relevance: g.relevance || 'N/A'
                };
            });

            window.latestAnalysis = {
                analysis: formattedAnalysis,
                transcript: transcript,
                guidelineId: processedGuidelineData[0].id, // For backward compatibility
                guidelineTitle: processedGuidelineData[0].title, // For backward compatibility
                processedGuidelines: processedGuidelineData,
                multiGuideline: guidelinesToProcess.length > 1,
                analysisResults: results, // Store all results for auto-processing
                timestamp: new Date().toISOString()
            };

            // If multiple guidelines were processed, automatically generate combined suggestions
            if (guidelinesToProcess.length > 1) {
                console.log('[DEBUG] Auto-generating combined suggestions for', successCount, 'successful guidelines');

                // Filter to only successful results
                const successfulResults = results.filter(r => !r.error);

                // Add a small delay to let the analysis display complete
                setTimeout(async () => {
                    try {
                        if (typeof window.generateCombinedInteractiveSuggestions === 'function') {
                            await window.generateCombinedInteractiveSuggestions(successfulResults);
                        } else {
                            // Fallback attempts
                            console.warn("generateCombinedInteractiveSuggestions not found on window, attempting direct call if available via scope or module.");
                            // If this module imports it, call it directly. If it is only on window in script.js, we have an issue.
                            // Assuming for now it will remain in script.js or be moved. If it's in script.js and not exported, we can't call it.
                            // BUT, we are moving logic TO this file.
                            // If generateCombinedInteractiveSuggestions is also moved here or imported, call it.
                            // For now, let's assume it might still be in script.js attached to window.
                            if (window.generateCombinedInteractiveSuggestions) {
                                await window.generateCombinedInteractiveSuggestions(successfulResults);
                            } else {
                                console.error("Critical: generateCombinedInteractiveSuggestions is missing.");
                            }

                        }

                    } catch (error) {
                        console.error('[DEBUG] Error auto-generating combined suggestions:', error);
                        // Show the fallback button if auto-generation fails
                        const makeDynamicAdviceBtn = document.getElementById('makeDynamicAdviceBtn');
                        if (makeDynamicAdviceBtn) {
                            makeDynamicAdviceBtn.style.display = 'inline-block';
                            console.log('[DEBUG] Showed fallback guideline suggestions button');
                        }
                    }
                }, 1000);
            } else {
                // For single guideline, show the "Make Advice Dynamic" button as before
                const makeDynamicAdviceBtn = document.getElementById('makeDynamicAdviceBtn');
                if (makeDynamicAdviceBtn) {
                    makeDynamicAdviceBtn.style.display = 'inline-block';
                    console.log('[DEBUG] Made guideline suggestions button visible for single guideline');
                }
            }
        }

        if (typeof debouncedSaveState === 'function') {
            debouncedSaveState(); // Save state after checking guidelines
        } else if (window.debouncedSaveState) {
            window.debouncedSaveState();
        }

    } catch (error) {
        console.error('[DEBUG] Error in checkAgainstGuidelines:', error);
        alert(`Error checking guidelines: ${error.message}`);
    } finally {
        // Reset button state
        checkGuidelinesBtn.classList.remove('loading');
        checkGuidelinesBtn.disabled = false;
        console.log('[DEBUG] checkAgainstGuidelines completed');
    }
}

export async function runParallelAnalysis(guidelines) {
    console.log('[DEBUG] Starting Parallel Analysis for', guidelines.length, 'guidelines');

    // Set flag to indicate parallel analysis is active
    window.parallelAnalysisActive = true;

    // Hide selection buttons if they exist
    if (typeof window.hideSelectionButtons === 'function') {
        window.hideSelectionButtons();
    }

    // Create a container for the aggregated results
    const containerId = 'parallel-analysis-results-' + Date.now();
    const resultsContainerHtml = `
        <div id="${containerId}" class="parallel-analysis-container" style="max-height: calc(100vh - 250px); overflow-y: auto; padding-right: 10px;">
            <div class="parallel-status" style="margin-bottom: 20px; padding: 15px; background: var(--bg-tertiary); border-radius: 8px; border: 1px solid var(--border-color); color: var(--text-primary);">
                <strong><i class="fas fa-layer-group"></i> Analysis Underway</strong>
                <span id="${containerId}-status-text" style="display: block; margin-top: 5px; font-size: 0.9em; color: var(--text-secondary);"></span>
                <div class="progress-bar-container" style="margin-top: 10px; background: var(--bg-input); height: 8px; border-radius: 4px; overflow: hidden;">
                    <div id="${containerId}-progress" style="width: 0%; height: 100%; background: #4caf50; transition: width 0.3s ease;"></div>
                </div>
            </div>
            <div id="${containerId}-output"></div>
        </div>
    `;

    // Use direct DOM insertion to avoid streaming engine timing issues
    const summary1 = document.getElementById('summary1');
    if (summary1) {
        const wrapper = document.createElement('div');
        wrapper.innerHTML = resultsContainerHtml;
        summary1.appendChild(wrapper.firstElementChild);

        // Ensure summary section is visible
        const summarySection = document.getElementById('summarySection');
        if (summarySection) summarySection.classList.remove('hidden');
    }

    // Wait a tick for DOM to update, then get references
    await new Promise(resolve => setTimeout(resolve, 50));

    const statusText = document.getElementById(`${containerId}-status-text`);
    const progressBar = document.getElementById(`${containerId}-progress`);
    const outputContainer = document.getElementById(`${containerId}-output`);

    let completedCount = 0;
    const total = guidelines.length;

    // Helper for getting title
    function getGuidelineDisplayName(id, g, data) {
        if (data && data.humanFriendlyTitle) return data.humanFriendlyTitle;
        if (data && data.title) return data.title;
        if (g && g.title) return g.title;
        return id;
    }

    // Map guidelines to promises
    const analysisPromises = guidelines.map(async (guideline, index) => {
        try {
            // Get full data
            const guidelineData = window.globalGuidelines[guideline.id];
            const displayName = getGuidelineDisplayName(guideline.id, guideline, guidelineData);

            // Analyze
            // Note: getPracticePointSuggestions is currently in script.js (or will be moved).
            // We need to ensure access. Using window fallback until modularized.
            const suggestions = await window.getPracticePointSuggestions(
                getUserInputContent(),
                guideline.id
            );

            completedCount++;
            if (progressBar) progressBar.style.width = `${(completedCount / total) * 100}%`;
            if (statusText) statusText.textContent = `Analyzed ${completedCount} of ${total}: ${displayName}`;

            return {
                status: 'fulfilled',
                guidelineId: guideline.id,
                displayName: displayName,
                suggestions: suggestions,
                relevance: guideline.relevance || 0,
                originalIndex: index
            };
        } catch (error) {
            console.error(`[DEBUG] Error analyzing guideline ${guideline.id}:`, error);
            completedCount++;
            if (progressBar) progressBar.style.width = `${(completedCount / total) * 100}%`;
            return {
                status: 'rejected',
                guidelineId: guideline.id,
                error: error,
                index: index
            };
        }
    });

    // Wait for all to complete
    const results = await Promise.all(analysisPromises);

    // Filter and Sort Results
    // Note: `r.suggestions` is the full result object from getPracticePointSuggestions
    // which has a `suggestions` array property inside it
    const successfulResults = results
        .filter(r => r.status === 'fulfilled' && r.suggestions && r.suggestions.suggestions && r.suggestions.suggestions.length > 0);

    // Flatten all suggestions from successful results
    let allSuggestions = [];

    // Priority mapping for sorting
    const priorityMap = {
        'critical': 4,
        'high': 3,
        'important': 2,
        'medium': 2,
        'low': 1,
        'info': 1
    };

    if (successfulResults.length > 0) {
        successfulResults.forEach(r => {
            if (r.suggestions && r.suggestions.suggestions) {
                r.suggestions.suggestions.forEach(s => {
                    // Add source guideline info to the suggestion object
                    s.sourceGuidelineName = r.displayName;
                    s.sourceGuidelineId = r.guidelineId;
                    allSuggestions.push(s);
                });
            }
        });

        // Sort suggestions by priority (Critical > High > Medium > Low)
        allSuggestions.sort((a, b) => {
            const pA = priorityMap[(a.type || a.priority || 'info').toLowerCase()] || 0;
            const pB = priorityMap[(b.type || b.priority || 'info').toLowerCase()] || 0;
            return pB - pA; // Descending order
        });
    }

    console.log(`[PARALLEL] Completed. ${successfulResults.length} successful analyses. Found ${allSuggestions.length} total suggestions.`);

    // Update status to show completion
    updateUser(`Analysis complete - ${allSuggestions.length} practice points identified from ${successfulResults.length} guidelines.`, false);

    // Hide the selection interface now that we have results
    const selectionInterface = document.querySelector('.guideline-selection-interface');
    if (selectionInterface) {
        selectionInterface.style.display = 'none';
    }

    // Calculate priority counts for status message
    const priorityCounts = { 'High': 0, 'Medium': 0, 'Low': 0 };
    allSuggestions.forEach(s => {
        const type = (s.type || s.priority || 'info').toLowerCase();
        if (type === 'critical' || type === 'high') priorityCounts['High']++;
        else if (type === 'important' || type === 'medium') priorityCounts['Medium']++;
        else priorityCounts['Low']++;
    });

    // Generate simplified status message
    let statusParts = [];
    if (priorityCounts['High'] > 0) statusParts.push(`${priorityCounts['High']} High`);
    if (priorityCounts['Medium'] > 0) statusParts.push(`${priorityCounts['Medium']} Medium`);

    if (priorityCounts['Low'] > 0) statusParts.push(`${priorityCounts['Low']} Low`);

    let statusSummary = statusParts.length > 0
        ? statusParts.join(', ') + ' priority issues found'
        : 'No specific issues found';

    if (statusText) {
        statusText.innerHTML = `<strong>Analysis Complete</strong><br>${statusSummary}`;
        statusText.parentElement.style.background = 'var(--bg-tertiary)';
        statusText.parentElement.style.border = '1px solid var(--accent-color)';

        // Ephemeral message: Remove after 3 seconds to save vertical space
        setTimeout(() => {
            if (statusText.parentElement) {
                statusText.parentElement.style.transition = 'opacity 0.5s ease-out, height 0.5s ease-out, padding 0.5s ease-out, margin 0.5s ease-out';
                statusText.parentElement.style.opacity = '0';
                statusText.parentElement.style.height = '0';
                statusText.parentElement.style.padding = '0';
                statusText.parentElement.style.margin = '0';
                statusText.parentElement.style.overflow = 'hidden';

                // Remove from DOM after transition
                setTimeout(() => {
                    if (statusText.parentElement) statusText.parentElement.remove();
                }, 500);
            }
        }, 3000);
    }

    // Display Aggregated Results (Sequential Wizard)
    // Re-check the outputContainer in case DOM was modified during async operations
    let finalOutputContainer = outputContainer || document.getElementById(`${containerId}-output`);

    if (!finalOutputContainer) {
        console.error('[PARALLEL] Output container not found - cannot display results');
        return;
    }

    if (allSuggestions.length === 0) {
        finalOutputContainer.innerHTML = '<div class="alert alert-info">Analysis complete, but no specific suggestions were found for the provided clinical text based on these guidelines.</div>';
    } else {
        // Clear container
        finalOutputContainer.innerHTML = '';

        // 1. Sort suggestions by priority
        const priorityScore = {
            'critical': 4,
            'high': 3,
            'important': 2,
            'medium': 2,
            'low': 1,
            'info': 0
        };

        const sortedSuggestions = allSuggestions.sort((a, b) => {
            const pA = (a.type || a.priority || 'info').toLowerCase();
            const pB = (b.type || b.priority || 'info').toLowerCase();
            return (priorityScore[pB] || 0) - (priorityScore[pA] || 0);
        });

        // 2. Initialize Suggestion Wizard
        // Note: we need to pass the window functions if they are not imported
        // But some are available in this module's imports (getUserInputContent, setUserInputContent)
        // determineInsertionPoint and insertTextAtPoint are expected to be on window
        initializeSuggestionWizard(finalOutputContainer, sortedSuggestions, {
            getUserInputContent: getUserInputContent,
            setUserInputContent: setUserInputContent,
            determineInsertionPoint: window.determineInsertionPoint,
            insertTextAtPoint: window.insertTextAtPoint
        });
    }

    // Clear parallel analysis flag
    window.parallelAnalysisActive = false;
    console.log('[DEBUG] Parallel Analysis completed, flag cleared');
}

// Compliance / Scoring

export async function performComplianceScoring(originalTranscript, recommendedChanges, guidelineId, guidelineTitle) {
    try {
        console.log('[DEBUG] performComplianceScoring called', {
            transcriptLength: originalTranscript.length,
            changesLength: recommendedChanges.length,
            guidelineId,
            guidelineTitle
        });

        // Get user authentication
        const user = auth.currentUser;
        if (!user) {
            throw new Error('User not authenticated');
        }
        const idToken = await user.getIdToken();

        // Call the scoring endpoint
        const result = await postAuthenticated(API_ENDPOINTS.SCORE_COMPLIANCE, {
            originalTranscript,
            recommendedChanges,
            guidelineId,
            guidelineTitle
        });

        if (!result.success) {
            throw new Error(result.error || 'Compliance scoring failed');
        }

        console.log('[DEBUG] performComplianceScoring: Success', {
            overallScore: result.scoring.overallScore,
            category: result.scoring.category
        });

        // Display the compliance scoring results
        await displayComplianceScoring(result.scoring, result.guidelineTitle);

    } catch (error) {
        console.error('[DEBUG] performComplianceScoring: Error:', error);
        throw error;
    }
}

export async function displayComplianceScoring(scoring, guidelineTitle) {
    console.log('[DEBUG] displayComplianceScoring called', {
        overallScore: scoring.overallScore,
        category: scoring.category
    });

    // Determine score colour based on category
    const getScoreColour = (category) => {
        switch (category) {
            case 'Excellent': return '#28a745';
            case 'Good': return '#17a2b8';
            case 'Needs Improvement': return '#ffc107';
            case 'Poor': return '#dc3545';
            default: return '#6c757d';
        }
    };

    const scoreColour = getScoreColour(scoring.category);

    // Create the compliance scoring display HTML
    const scoringHtml = `
        <div class="compliance-scoring-results">
            <div class="scoring-header">
                <h3>📊 Compliance Assessment Results</h3>
                <p><em>Assessment against: ${guidelineTitle}</em></p>
            </div>
            
            <div class="overall-score">
                <div class="score-circle" style="border-color: ${scoreColour};">
                    <div class="score-number" style="color: ${scoreColour};">${scoring.overallScore}</div>
                    <div class="score-label">Overall Score</div>
                </div>
                <div class="score-category" style="color: ${scoreColour};">
                    <strong>${scoring.category}</strong>
                </div>
            </div>

            <div class="dimension-scores">
                <h4>📈 Detailed Breakdown</h4>
                <div class="dimensions-grid">
                    <div class="dimension-item">
                        <div class="dimension-name">Completeness</div>
                        <div class="dimension-score">${scoring.dimensionScores.completeness}/100</div>
                        <div class="dimension-weight">(40% weight)</div>
                    </div>
                    <div class="dimension-item">
                        <div class="dimension-name">Accuracy</div>
                        <div class="dimension-score">${scoring.dimensionScores.accuracy}/100</div>
                        <div class="dimension-weight">(35% weight)</div>
                    </div>
                    <div class="dimension-item">
                        <div class="dimension-name">Clinical Appropriateness</div>
                        <div class="dimension-score">${scoring.dimensionScores.clinicalAppropriateness}/100</div>
                        <div class="dimension-weight">(25% weight)</div>
                    </div>
                </div>
            </div>

            ${scoring.strengths && scoring.strengths.length > 0 ? `
                <div class="scoring-section strengths">
                    <h4>✅ Strengths Identified</h4>
                    <ul>
                        ${scoring.strengths.map(strength => `<li>${strength}</li>`).join('')}
                    </ul>
                </div>
            ` : ''}

            ${scoring.improvementAreas && scoring.improvementAreas.length > 0 ? `
                <div class="scoring-section improvements">
                    <h4>🎯 Areas for Improvement</h4>
                    <ul>
                        ${scoring.improvementAreas.map(area => `<li>${area}</li>`).join('')}
                    </ul>
                </div>
            ` : ''}

            <div class="key-findings">
                <h4>🔍 Key Findings</h4>
                ${scoring.keyFindings.wellDocumented && scoring.keyFindings.wellDocumented.length > 0 ? `
                    <div class="findings-group">
                        <strong>Well Documented:</strong>
                        <ul class="findings-list good">
                            ${scoring.keyFindings.wellDocumented.map(item => `<li>${item}</li>`).join('')}
                        </ul>
                    </div>
                ` : ''}
                
                ${scoring.keyFindings.missingElements && scoring.keyFindings.missingElements.length > 0 ? `
                    <div class="findings-group">
                        <strong>Missing Elements:</strong>
                        <ul class="findings-list missing">
                            ${scoring.keyFindings.missingElements.map(item => `<li>${item}</li>`).join('')}
                        </ul>
                    </div>
                ` : ''}
                
                ${scoring.keyFindings.needsRevision && scoring.keyFindings.needsRevision.length > 0 ? `
                    <div class="findings-group">
                        <strong>Needs Revision:</strong>
                        <ul class="findings-list revision">
                            ${scoring.keyFindings.needsRevision.map(item => `<li>${item}</li>`).join('')}
                        </ul>
                    </div>
                ` : ''}
            </div>

            <div class="compliance-insights">
                <h4>💡 Compliance Insights</h4>
                <p>${scoring.complianceInsights}</p>
            </div>
        </div>

        <style>
        .compliance-scoring-results {
            background: var(--bg-secondary);
            border: 2px solid #17a2b8;
            border-radius: 12px;
            padding: 25px;
            margin: 20px 0;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        }

        .scoring-header h3 {
            margin: 0 0 10px 0;
            color: #17a2b8;
            font-size: 1.4em;
        }

        .scoring-header p {
            margin: 0 0 20px 0;
            color: var(--text-secondary);
            font-style: italic;
        }

        .overall-score {
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 30px;
            margin: 25px 0;
            padding: 20px;
            background: var(--bg-primary);
            border-radius: 8px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }

        .score-circle {
            width: 120px;
            height: 120px;
            border: 6px solid;
            border-radius: 50%;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            background: var(--bg-primary);
        }

        .score-number {
            font-size: 2.5em;
            font-weight: bold;
            line-height: 1;
        }

        .score-label {
            font-size: 0.9em;
            color: var(--text-secondary);
            margin-top: 5px;
        }

        .score-category {
            font-size: 1.5em;
            font-weight: bold;
        }

        .dimension-scores {
            margin: 25px 0;
        }

        .dimension-scores h4 {
            margin: 0 0 15px 0;
            color: var(--text-primary);
        }

        .dimensions-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 15px;
        }

        .dimension-item {
            background: var(--bg-primary);
            padding: 15px;
            border-radius: 6px;
            text-align: center;
            box-shadow: 0 1px 3px rgba(0,0,0,0.1);
        }

        .dimension-name {
            font-weight: 600;
            color: var(--text-primary);
            margin-bottom: 5px;
        }

        .dimension-score {
            font-size: 1.2em;
            font-weight: bold;
            color: var(--text-primary);
            margin-bottom: 5px;
        }

        .dimension-weight {
            font-size: 0.8em;
            color: var(--text-secondary);
        }

        .scoring-section {
            margin: 20px 0;
        }

        .scoring-section h4 {
            margin: 0 0 10px 0;
            color: var(--text-primary);
        }

        .scoring-section ul {
            margin: 0;
            padding-left: 20px;
        }

        .scoring-section li {
            margin-bottom: 5px;
            color: var(--text-primary);
        }

        .key-findings {
            margin: 20px 0;
            padding: 15px;
            background: var(--bg-primary);
            border-radius: 6px;
            box-shadow: 0 1px 3px rgba(0,0,0,0.1);
        }

        .key-findings h4 {
            margin: 0 0 15px 0;
            color: var(--text-primary);
        }

        .findings-group {
            margin-bottom: 15px;
        }

        .findings-group strong {
            color: var(--text-primary);
        }

        .findings-list {
            margin: 5px 0 0 0;
            padding-left: 20px;
        }

        .findings-list.good li { color: #28a745; }
        .findings-list.missing li { color: #dc3545; }
        .findings-list.revision li { color: #ffc107; }

        .compliance-insights {
            margin-top: 25px;
            padding: 15px;
            background: rgba(23, 162, 184, 0.1);
            border-radius: 6px;
            border-left: 4px solid #17a2b8;
        }

        .compliance-insights h4 {
            margin: 0 0 10px 0;
            color: #17a2b8;
        }

        .compliance-insights p {
            margin: 0;
            color: var(--text-primary);
            line-height: 1.5;
        }
        </style>
    `;

    appendToOutputField(scoringHtml, false);
}
