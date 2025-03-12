import { useState } from 'react';
import styles from './TabView.module.css';

const TABS = [
  { id: 'main', label: 'Main' },
  { id: 'prompts', label: 'Prompts' },
  { id: 'guidelines', label: 'Guidelines' },
  { id: 'workflows', label: 'Workflows' },
];

export function TabView() {
  const [activeTab, setActiveTab] = useState('main');

  return (
    <div className={styles.tabContainer}>
      <div className={styles.tabs}>
        {TABS.map((tab) => (
          <button
            key={tab.id}
            className={`${styles.tab} ${activeTab === tab.id ? styles.active : ''}`}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className={styles.tabContent}>
        {activeTab === 'main' && (
          <div className={styles.mainView}>
            {/* Add your main view content */}
          </div>
        )}

        {activeTab === 'prompts' && (
          <div className={styles.promptsView}>
            {/* Add your prompts view content */}
          </div>
        )}

        {activeTab === 'guidelines' && (
          <div className={styles.guidelinesView}>
            {/* Add your guidelines view content */}
          </div>
        )}

        {activeTab === 'workflows' && (
          <div className={styles.workflowsView}>
            {/* Add your workflows view content */}
          </div>
        )}
      </div>
    </div>
  );
} 