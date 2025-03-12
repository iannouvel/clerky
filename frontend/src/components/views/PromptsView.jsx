import { useState } from 'react';
import { useData } from '../../hooks/useData';
import useStore from '../../stores/useStore';
import styles from './PromptsView.module.css';

export function PromptsView() {
  const { prompts, isLoading } = useData();
  const [editedPrompts, setEditedPrompts] = useState(prompts || {});

  const handlePromptChange = (key, field, value) => {
    setEditedPrompts(prev => ({
      ...prev,
      [key]: {
        ...prev[key],
        [field]: value
      }
    }));
  };

  if (isLoading.prompts) {
    return <div className={styles.loading}>Loading prompts...</div>;
  }

  return (
    <div className={styles.promptsView}>
      <div className={styles.promptsContainer}>
        {Object.entries(editedPrompts).map(([key, prompt]) => (
          <div key={key} className={styles.promptGroup}>
            <h3>{prompt.title}</h3>
            <div className={styles.promptFields}>
              <div className={styles.field}>
                <label>Description:</label>
                <input
                  type="text"
                  value={prompt.description || ''}
                  onChange={(e) => handlePromptChange(key, 'description', e.target.value)}
                />
              </div>
              <div className={styles.field}>
                <label>Prompt:</label>
                <textarea
                  value={prompt.prompt || ''}
                  onChange={(e) => handlePromptChange(key, 'prompt', e.target.value)}
                  rows={5}
                />
              </div>
            </div>
          </div>
        ))}
      </div>
      <div className={styles.actions}>
        <button className={styles.saveButton}>
          Save Changes
        </button>
        <button 
          className={styles.resetButton}
          onClick={() => setEditedPrompts(prompts)}
        >
          Reset
        </button>
      </div>
    </div>
  );
} 