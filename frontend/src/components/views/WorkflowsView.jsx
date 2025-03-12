import { useState } from 'react';
import styles from './WorkflowsView.module.css';

const WORKFLOWS = [
  {
    id: 'processPdf',
    name: 'Process PDF',
    description: 'Process and analyze PDF documents',
  },
  {
    id: 'extractTerms',
    name: 'Extract Terms',
    description: 'Extract key terms from documents',
  },
  {
    id: 'generateSummary',
    name: 'Generate Summary',
    description: 'Generate summaries from documents',
  },
];

export function WorkflowsView() {
  const [activeWorkflow, setActiveWorkflow] = useState(null);
  const [workflowStatus, setWorkflowStatus] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);

  const handleWorkflowClick = async (workflow) => {
    setActiveWorkflow(workflow);
    setWorkflowStatus('');
  };

  const handleRunWorkflow = async () => {
    if (!activeWorkflow) return;

    setIsProcessing(true);
    setWorkflowStatus('Processing...');

    try {
      // Simulate workflow execution
      await new Promise(resolve => setTimeout(resolve, 2000));
      setWorkflowStatus('Workflow completed successfully!');
    } catch (error) {
      setWorkflowStatus(`Error: ${error.message}`);
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className={styles.workflowsView}>
      {/* Workflows List */}
      <div className={styles.workflowsList}>
        <h2>Available Workflows</h2>
        <div className={styles.workflows}>
          {WORKFLOWS.map((workflow) => (
            <div
              key={workflow.id}
              className={`${styles.workflowItem} ${
                activeWorkflow?.id === workflow.id ? styles.selected : ''
              }`}
              onClick={() => handleWorkflowClick(workflow)}
            >
              <h3>{workflow.name}</h3>
              <p>{workflow.description}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Workflow Details */}
      <div className={styles.workflowDetails}>
        {activeWorkflow ? (
          <>
            <h2>{activeWorkflow.name}</h2>
            <p className={styles.description}>{activeWorkflow.description}</p>
            
            <div className={styles.actions}>
              <button
                className={styles.runButton}
                onClick={handleRunWorkflow}
                disabled={isProcessing}
              >
                {isProcessing ? 'Running...' : 'Run Workflow'}
              </button>
            </div>

            {workflowStatus && (
              <div className={`${styles.status} ${
                workflowStatus.includes('Error') ? styles.error : ''
              }`}>
                {workflowStatus}
              </div>
            )}
          </>
        ) : (
          <div className={styles.noSelection}>
            Select a workflow to get started
          </div>
        )}
      </div>
    </div>
  );
} 