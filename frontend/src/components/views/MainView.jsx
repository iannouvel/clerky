import { useState } from 'react';
import useStore from '../../stores/useStore';
import { useData } from '../../hooks/useData';
import styles from './MainView.module.css';

export function MainView() {
  const [input, setInput] = useState('');
  const [selectedGuidelines, setSelectedGuidelines] = useState([]);
  const [selectedIssue, setSelectedIssue] = useState(null);
  const { guidelines, issues, handleIssues, isLoading, removeIssue } = useData();

  const handleProcessClick = async () => {
    if (!input.trim()) return;
    
    try {
      await handleIssues(input);
    } catch (error) {
      console.error('Error processing input:', error);
      alert('Error processing input. Please try again.');
    }
  };

  const handleGuidelineClick = (guideline) => {
    setSelectedGuidelines(prev => 
      prev.includes(guideline) 
        ? prev.filter(g => g !== guideline)
        : [...prev, guideline]
    );
  };

  const handleIssueClick = (issue) => {
    setSelectedIssue(issue === selectedIssue ? null : issue);
    // Reset selected guidelines when selecting a new issue
    setSelectedGuidelines([]);
  };

  const handleRemoveIssue = (issue, e) => {
    e.stopPropagation(); // Prevent issue selection when clicking remove
    const issueId = typeof issue === 'string' ? issue : issue.id;
    removeIssue(issueId);
    if (selectedIssue === issue) {
      setSelectedIssue(null);
      setSelectedGuidelines([]);
    }
  };

  // Helper function to format issue for display
  const formatIssue = (issue) => {
    if (typeof issue === 'string') {
      return {
        id: issue,
        title: issue,
        description: ''
      };
    }
    return issue;
  };

  return (
    <div className={styles.mainView}>
      {/* Left Column - Input */}
      <div className={styles.column}>
        <textarea
          className={styles.textarea}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Enter your clinical scenario here..."
        />
        <div className={styles.buttonContainer}>
          <button
            className={styles.processButton}
            onClick={handleProcessClick}
            disabled={isLoading.issues || !input.trim()}
          >
            {isLoading.issues ? 'Processing...' : 'Process'}
          </button>
        </div>
      </div>

      {/* Middle Column - Issues and Guidelines */}
      <div className={styles.column}>
        <div className={styles.guidelinesList}>
          {issues?.map((issue, index) => {
            const formattedIssue = formatIssue(issue);
            return (
              <div
                key={formattedIssue.id || index}
                className={`${styles.issueItem} ${
                  selectedIssue === issue ? styles.selected : ''
                }`}
                onClick={() => handleIssueClick(issue)}
              >
                <div className={styles.issueContent}>
                  <h3>{formattedIssue.title}</h3>
                  {formattedIssue.description && (
                    <p>{formattedIssue.description}</p>
                  )}
                </div>
                <button
                  className={styles.removeButton}
                  onClick={(e) => handleRemoveIssue(issue, e)}
                  title="Remove issue"
                >
                  ×
                </button>
              </div>
            );
          })}
          {selectedIssue && guidelines?.map((guideline, index) => (
            <div
              key={index}
              className={`${styles.guidelineItem} ${
                selectedGuidelines.includes(guideline) ? styles.selected : ''
              }`}
              onClick={() => handleGuidelineClick(guideline)}
            >
              {guideline.title || guideline}
            </div>
          ))}
        </div>
      </div>

      {/* Right Column - Selected Guidelines */}
      <div className={styles.column}>
        <div className={styles.selectedGuidelines}>
          {selectedGuidelines.map((guideline, index) => (
            <div key={index} className={styles.selectedGuidelineItem}>
              <h3>{guideline.title || guideline}</h3>
              <p>{guideline.summary || 'No summary available'}</p>
              <button
                className={styles.removeButton}
                onClick={() => handleGuidelineClick(guideline)}
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
} 