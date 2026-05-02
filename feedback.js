// Feedback page script - loads and displays user feedback from Firestore
import { app, db, auth } from './firebase-init.js';
import { collection, getDocs, updateDoc, doc, query, orderBy, onSnapshot } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';

let _feedbackCache = [];
let currentFilter = 'unactioned';

// Initialize on page load
document.addEventListener('DOMContentLoaded', async () => {
  try {
    // Check authentication
    onAuthStateChanged(auth, async (user) => {
      if (!user) {
        console.warn('User not authenticated');
        document.getElementById('feedbackTableBody').innerHTML =
          '<tr><td colspan="6" style="padding:20px;text-align:center;color:var(--text-secondary);">Please log in to view feedback</td></tr>';
        return;
      }

      // Load feedback
      await loadFeedback();

      // Set up event listeners
      document.getElementById('feedbackRefreshBtn')?.addEventListener('click', loadFeedback);
      document.getElementById('feedbackFilter')?.addEventListener('change', (e) => {
        currentFilter = e.target.value;
        renderFeedback();
      });
      document.getElementById('feedbackExportBtn')?.addEventListener('click', exportFeedback);
    });
  } catch (error) {
    console.error('Error initializing feedback page:', error);
  }
});

// Load feedback from Firestore
async function loadFeedback() {
  try {
    const feedbackRef = collection(db, 'feedback');
    const q = query(feedbackRef, orderBy('timestamp', 'desc'));

    // Use onSnapshot for real-time updates
    onSnapshot(q, (snapshot) => {
      _feedbackCache = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));

      console.log(`Loaded ${_feedbackCache.length} feedback items`);
      renderFeedback();
    });
  } catch (error) {
    console.error('Error loading feedback:', error);
    document.getElementById('feedbackTableBody').innerHTML =
      `<tr><td colspan="6" style="padding:20px;text-align:center;color:red;">Error loading feedback: ${error.message}</td></tr>`;
  }
}

// Render feedback based on current filter
function renderFeedback() {
  const tbody = document.getElementById('feedbackTableBody');
  if (!tbody) return;

  let filtered = _feedbackCache;

  if (currentFilter === 'unactioned') {
    filtered = _feedbackCache.filter(f => !f.actioned);
  } else if (currentFilter === 'actioned') {
    filtered = _feedbackCache.filter(f => f.actioned);
  }

  if (filtered.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="6" style="padding:20px;text-align:center;color:var(--text-secondary);">
          No feedback items
        </td>
      </tr>
    `;
    updateFeedbackCount(0, filtered.length);
    return;
  }

  tbody.innerHTML = filtered.map(feedback => {
    const date = feedback.timestamp ? new Date(feedback.timestamp).toLocaleString() : 'Unknown';
    const status = feedback.actioned ? 'Actioned' : 'Open';
    const statusClass = feedback.actioned ? 'status-actioned' : 'status-unactioned';

    return `
      <tr>
        <td>${date}</td>
        <td>${feedback.user || 'Anonymous'}</td>
        <td>${truncate(feedback.feedback || feedback.summary || '', 100)}</td>
        <td style="font-size:12px;color:var(--text-secondary);">${truncate(feedback.context || '', 60)}</td>
        <td><span class="status-badge ${statusClass}">${status}</span></td>
        <td>
          <button class="action-button" onclick="markFeedback('${feedback.id}', ${!feedback.actioned})">
            ${feedback.actioned ? 'Unmark' : 'Mark Done'}
          </button>
        </td>
      </tr>
    `;
  }).join('');

  updateFeedbackCount(filtered.length, filtered.length);
}

// Mark feedback as actioned/unactioned
window.markFeedback = async function(feedbackId, actioned) {
  try {
    const feedbackRef = doc(db, 'feedback', feedbackId);
    await updateDoc(feedbackRef, { actioned });
    console.log(`Updated feedback ${feedbackId}`);
    // Re-render will happen automatically via onSnapshot
  } catch (error) {
    console.error('Error updating feedback:', error);
    alert('Error updating feedback: ' + error.message);
  }
};

// Export feedback as JSON
function exportFeedback() {
  try {
    const jsonString = JSON.stringify(_feedbackCache, null, 2);
    const blob = new Blob([jsonString], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `feedback-export-${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    console.log(`Exported ${_feedbackCache.length} feedback items`);
  } catch (error) {
    console.error('Error exporting feedback:', error);
    alert('Error exporting feedback: ' + error.message);
  }
}

// Update feedback count display
function updateFeedbackCount(shown, total) {
  const countEl = document.getElementById('feedbackCount');
  if (countEl) {
    countEl.textContent = `${shown} of ${total} items`;
  }
}

// Utility function to truncate text
function truncate(text, length) {
  if (!text) return '';
  return text.length > length ? text.substring(0, length) + '...' : text;
}
