// Helper to escape HTML entities
export function escapeHtml(text) {
    if (!text) return text;
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Helper to unescape HTML entities
export function unescapeHtml(text) {
    if (!text) return text;
    const div = document.createElement('div');
    div.innerHTML = text;
    return div.textContent;
}
