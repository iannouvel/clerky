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
      const result = await handleIssues(input);
      // Handle the result as needed
      console.log(result);
    } catch (error) {
      console.error('Error processing input:', error);
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

  const handleRemoveIssue = (issueId, e) => {
    e.stopPropagation(); // Prevent issue selection when clicking remove
    removeIssue(issueId);
    if (selectedIssue?.id === issueId) {
      setSelectedIssue(null);
      setSelectedGuidelines([]);
    }
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
          {issues?.map((issue) => (
            <div
              key={issue.id}
              className={`${styles.issueItem} ${
                selectedIssue?.id === issue.id ? styles.selected : ''
              }`}
              onClick={() => handleIssueClick(issue)}
            >
              <div className={styles.issueContent}>
                <h3>{issue.title}</h3>
                <p>{issue.description}</p>
              </div>
              <button
                className={styles.removeButton}
                onClick={(e) => handleRemoveIssue(issue.id, e)}
                title="Remove issue"
              >
                ×
              </button>
            </div>
          ))}
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