import { useState, useEffect } from 'react';
import { useData } from '../../hooks/useData';
import styles from './GuidelinesView.module.css';
import { db } from '../../firebase/firebaseConfig';

export function GuidelinesView() {
  const { guidelines: initialGuidelines, isLoading } = useData();
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedGuideline, setSelectedGuideline] = useState(null);
  const [guidelines, setGuidelines] = useState([]);

  useEffect(() => {
    // Load guidelines from Firestore
    const loadGuidelines = async () => {
      try {
        const guidelinesSnapshot = await db.collection('guidelines').get();
        const loadedGuidelines = guidelinesSnapshot.docs.map(doc => ({
          id: doc.id,  // Use document ID
          ...doc.data()
        }));
        setGuidelines(loadedGuidelines);
      } catch (error) {
        console.error('Error loading guidelines:', error);
      }
    };

    loadGuidelines();
  }, []);

  const filteredGuidelines = guidelines?.filter(guideline => 
    guideline.title.toLowerCase().includes(searchTerm.toLowerCase())
  );

  if (isLoading.guidelines) {
    return <div className={styles.loading}>Loading guidelines...</div>;
  }

  return (
    <div className={styles.guidelinesContainer}>
      <div className={styles.searchBar}>
        <input
          type="text"
          placeholder="Search guidelines..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
        />
      </div>
      <div className={styles.guidelinesList}>
        {filteredGuidelines?.map((guideline) => (
          <div
            key={guideline.id}
            className={`${styles.guidelineItem} ${
              selectedGuideline?.id === guideline.id ? styles.selected : ''
            }`}
            onClick={() => setSelectedGuideline(guideline)}
          >
            <h3>{guideline.title}</h3>
            <p>{guideline.summary}</p>
          </div>
        ))}
      </div>
      {selectedGuideline && (
        <div className={styles.guidelineDetail}>
          <h2>{selectedGuideline.title}</h2>
          <div className={styles.content}>
            {selectedGuideline.content}
          </div>
        </div>
      )}
    </div>
  );
} 