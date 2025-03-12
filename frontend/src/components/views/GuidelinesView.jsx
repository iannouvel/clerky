import { useState } from 'react';
import { useData } from '../../hooks/useData';
import styles from './GuidelinesView.module.css';

export function GuidelinesView() {
  const { guidelines, isLoading } = useData();
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedGuideline, setSelectedGuideline] = useState(null);

  const filteredGuidelines = guidelines?.filter(guideline => 
    (guideline.title || guideline).toLowerCase().includes(searchTerm.toLowerCase())
  );

  if (isLoading.guidelines) {
    return <div className={styles.loading}>Loading guidelines...</div>;
  }

  return (
    <div className={styles.guidelinesView}>
      {/* Search and Filter Section */}
      <div className={styles.searchSection}>
        <input
          type="text"
          placeholder="Search guidelines..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className={styles.searchInput}
        />
      </div>

      {/* Main Content */}
      <div className={styles.content}>
        {/* Guidelines List */}
        <div className={styles.guidelinesList}>
          {filteredGuidelines?.map((guideline, index) => (
            <div
              key={index}
              className={`${styles.guidelineItem} ${
                selectedGuideline === guideline ? styles.selected : ''
              }`}
              onClick={() => setSelectedGuideline(guideline)}
            >
              <h3>{guideline.title || guideline}</h3>
              {guideline.summary && (
                <p className={styles.summary}>{guideline.summary}</p>
              )}
            </div>
          ))}
        </div>

        {/* Guideline Details */}
        <div className={styles.guidelineDetails}>
          {selectedGuideline ? (
            <>
              <h2>{selectedGuideline.title || selectedGuideline}</h2>
              {selectedGuideline.content && (
                <div className={styles.content}>
                  <h3>Content</h3>
                  <div className={styles.contentText}>
                    {selectedGuideline.content}
                  </div>
                </div>
              )}
              {selectedGuideline.recommendations && (
                <div className={styles.recommendations}>
                  <h3>Recommendations</h3>
                  <ul>
                    {selectedGuideline.recommendations.map((rec, index) => (
                      <li key={index}>{rec}</li>
                    ))}
                  </ul>
                </div>
              )}
              {selectedGuideline.references && (
                <div className={styles.references}>
                  <h3>References</h3>
                  <ul>
                    {selectedGuideline.references.map((ref, index) => (
                      <li key={index}>{ref}</li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          ) : (
            <div className={styles.noSelection}>
              Select a guideline to view details
            </div>
          )}
        </div>
      </div>
    </div>
  );
} 