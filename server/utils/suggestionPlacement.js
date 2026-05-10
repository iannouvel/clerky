/**
 * Unified suggestion placement logic for both completeness and guideline suggestions
 * Determines whether a suggestion replaces existing text or adds new text,
 * and identifies all locations where changes should be made
 */

/**
 * Determine how a suggestion should be placed in the note
 * @param {Object} suggestion - Suggestion object (from completeness or guideline check)
 * @param {string} noteContent - Current note content
 * @returns {Object} Structured placement instructions with all affected locations
 */
function determineSuggestionPlacement(suggestion, noteContent) {
    const changes = [];
    let action = 'add'; // default

    // Normalize suggestion structure (handle both completeness and guideline formats)
    const replacePattern = suggestion.replace_pattern || suggestion.originalText;
    const targetSection = suggestion.target_section;
    const suggestedText = suggestion.suggested_content || suggestion.suggestion || suggestion.suggestedText;

    // STEP 1: Check if suggestion should replace existing text or append to an item
    if (replacePattern && noteContent.includes(replacePattern)) {
        // Check if this is supplementary detail (dosing, monitoring, etc.) for an existing item
        // vs a genuine correction of vague text
        const isSupplementaryDetail = (pattern, info) => {
            // If pattern looks like a numbered/bulleted list item (e.g. "1. Start IV abx...")
            const isListItem = /^\d+\.|^[-*]\s/.test(pattern);
            // If missing_info contains keywords suggesting this is detail for the item
            const detailKeywords = ['dosing', 'dose', 'interval', 'monitoring', 'duration', 'frequency', 'threshold', 'rate', 'speed'];
            const hasDetailKeyword = detailKeywords.some(kw => info.toLowerCase().includes(kw));
            return isListItem && hasDetailKeyword;
        };

        if (isSupplementaryDetail(replacePattern, suggestion.missing_info || suggestedText)) {
            // This is supplementary detail — append after the item rather than replace it
            action = 'add';
            changes.push({
                type: 'addition',
                location: 'after_item',
                target_pattern: replacePattern,
                suggested_text: suggestedText,
                position: 'after_item',
                reason: 'Appending supplementary detail (dosing/monitoring) to existing item',
                section: targetSection
            });
        } else {
            // This is a genuine correction/replacement of vague text
            action = 'replace';
            changes.push({
                type: 'replacement',
                location: 'inline',
                find_text: replacePattern,
                replace_with: suggestedText,
                reason: 'Replacing vague/incomplete text with more specific guidance',
                section: targetSection
            });
        }
    }

    // STEP 2: Check if suggestion should be added in a specific section
    // This can happen even if step 1 found a replacement (mixed action)
    if (targetSection && suggestedText && !replacePattern) {
        action = 'add';
        const sectionContent = extractSectionContent(noteContent, targetSection);

        if (sectionContent) {
            // Section exists, append to it
            changes.push({
                type: 'addition',
                target_section: targetSection,
                suggested_text: suggestedText,
                position: 'end_of_section',
                reason: 'Adding new information to appropriate section'
            });
        } else {
            // Section doesn't exist, create it
            changes.push({
                type: 'addition',
                target_section: targetSection,
                suggested_text: suggestedText,
                position: 'new_section',
                reason: `Creating new "${targetSection}" section for this information`
            });
        }
    }

    // STEP 3: Handle mixed actions (some text to replace + new section to add)
    if (changes.length > 1) {
        action = 'mixed';
    }

    // If no changes determined yet, default to appending
    if (changes.length === 0 && suggestedText) {
        action = 'add';
        changes.push({
            type: 'addition',
            target_section: targetSection || 'Management',
            suggested_text: suggestedText,
            position: 'end_of_note',
            reason: 'Adding information to end of note (default placement)'
        });
    }

    return {
        action,  // 'replace', 'add', or 'mixed'
        changes,
        metadata: {
            practice_point_reference: suggestion.practice_point_reference,
            priority: suggestion.priority || suggestion.type || 'medium',
            description: suggestion.missing_info || suggestion.description
        }
    };
}

/**
 * Extract section content from note to check if section exists
 * @param {string} noteContent - Full note content
 * @param {string} sectionName - Name of section to find
 * @returns {Object|null} Section info {content, startIndex, endIndex} or null if not found
 */
function extractSectionContent(noteContent, sectionName) {
    const patterns = [
        new RegExp(`^${sectionName}:`, 'im'),
        new RegExp(`^${sectionName}\\s*$`, 'im'),
        new RegExp(`^${sectionName}\\s*-`, 'im')
    ];

    let sectionStartIndex = -1;
    let matchedPattern = null;

    for (const pattern of patterns) {
        const match = noteContent.match(pattern);
        if (match) {
            sectionStartIndex = match.index;
            matchedPattern = match[0];
            break;
        }
    }

    if (sectionStartIndex === -1) return null;

    const afterSection = noteContent.slice(sectionStartIndex + matchedPattern.length);
    const commonSections = ['Situation', 'Issues', 'Background', 'Assessment', 'Discussion', 'Plan', 'Management', 'Recommendation', 'History', 'Examination', 'Investigations', 'Impression'];
    let nextSectionIndex = -1;

    for (const nextSection of commonSections) {
        if (nextSection === sectionName) continue;
        const match = afterSection.match(new RegExp(`\\n${nextSection}:`, 'i'));
        if (match && (nextSectionIndex === -1 || match.index < nextSectionIndex)) {
            nextSectionIndex = match.index;
        }
    }

    const sectionContent = nextSectionIndex !== -1
        ? afterSection.slice(0, nextSectionIndex)
        : afterSection;

    return {
        content: sectionContent.trim(),
        startIndex: sectionStartIndex + matchedPattern.length,
        endIndex: sectionStartIndex + matchedPattern.length + sectionContent.length
    };
}

/**
 * Apply placement changes to note content
 * @param {string} noteContent - Current note content
 * @param {Object} placement - Placement object from determineSuggestionPlacement
 * @returns {string} Updated note content
 */
function applyPlacementChanges(noteContent, placement) {
    let updatedContent = noteContent;

    // Apply changes in reverse order to maintain indices
    const sortedChanges = [...placement.changes].sort((a, b) => {
        // Sort by position in content to apply from end to beginning
        return (b.find_text?.length || 0) - (a.find_text?.length || 0);
    });

    for (const change of sortedChanges) {
        if (change.type === 'replacement') {
            updatedContent = updatedContent.replace(change.find_text, change.replace_with);
        } else if (change.type === 'addition') {
            if (change.position === 'after_item') {
                // Find the line with target_pattern and insert after it
                const lines = updatedContent.split('\n');
                const idx = lines.findIndex(l => l.includes(change.target_pattern));
                if (idx !== -1) {
                    // Insert formatted detail as indented sub-items after the matched line
                    const indentedText = change.suggested_text
                        .split('\n')
                        .map((line, i) => i === 0 ? `  - ${line}` : `    ${line}`)
                        .join('\n');
                    lines.splice(idx + 1, 0, indentedText);
                    updatedContent = lines.join('\n');
                }
            } else if (change.position === 'new_section') {
                updatedContent += `\n\n${change.target_section}:\n${change.suggested_text}`;
            } else if (change.position === 'end_of_section') {
                const sectionInfo = extractSectionContent(updatedContent, change.target_section);
                if (sectionInfo) {
                    updatedContent = updatedContent.slice(0, sectionInfo.endIndex) + '\n' + change.suggested_text + updatedContent.slice(sectionInfo.endIndex);
                }
            } else {
                // end_of_note or default
                updatedContent += '\n' + change.suggested_text;
            }
        }
    }

    return updatedContent;
}

/**
 * Renumber a list section after items have been added or removed
 * @param {string} content - Note content
 * @param {string} sectionName - Section name (e.g., "Plan")
 * @returns {string} Content with renumbered list items
 */
function renumberListInSection(content, sectionName) {
    const sectionInfo = extractSectionContent(content, sectionName);
    if (!sectionInfo) return content;

    const beforeSection = content.slice(0, sectionInfo.startIndex);
    const sectionContent = content.slice(sectionInfo.startIndex, sectionInfo.endIndex);
    const afterSection = content.slice(sectionInfo.endIndex);

    // Split section into lines and renumber
    const lines = sectionContent.split('\n');
    let itemNumber = 1;
    const renumberedLines = lines.map(line => {
        const match = line.match(/^\d+\.\s+(.+)/);
        if (match) {
            return `${itemNumber}. ${match[1]}`;
        } else if (/^\s{2,}[-*]/.test(line)) {
            // Sub-item (indented bullet/dash) - leave as is
            return line;
        } else if (line.trim() === '') {
            // Blank line
            return line;
        } else {
            // Non-numbered content (section header, etc)
            return line;
        }
    });

    return beforeSection + renumberedLines.join('\n') + afterSection;
}

module.exports = {
    determineSuggestionPlacement,
    extractSectionContent,
    applyPlacementChanges,
    renumberListInSection
};
