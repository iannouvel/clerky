import { useState } from 'react';
import useStore from '../../stores/useStore';
import { useData } from '../../hooks/useData';
import styles from './MainView.module.css';

export function MainView() {
  const [input, setInput] = useState('');
  const [selectedGuidelines, setSelectedGuidelines] = useState([]);
  const { guidelines, handleIssues, isLoading } = useData();

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

      {/* Middle Column - Guidelines */}
      <div className={styles.column}>
        <div className={styles.guidelinesList}>
          {guidelines?.map((guideline, index) => (
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