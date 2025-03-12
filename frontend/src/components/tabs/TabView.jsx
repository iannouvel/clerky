import { useState } from 'react';
import { MainView } from '../views/MainView';
import { PromptsView } from '../views/PromptsView';
import { GuidelinesView } from '../views/GuidelinesView';
import { WorkflowsView } from '../views/WorkflowsView';
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
        {activeTab === 'main' && <MainView />}
        {activeTab === 'prompts' && <PromptsView />}
        {activeTab === 'guidelines' && <GuidelinesView />}
        {activeTab === 'workflows' && <WorkflowsView />}
      </div>
    </div>
  );
} 